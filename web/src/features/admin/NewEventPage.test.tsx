import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { NewEventPage } from './NewEventPage'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { fr } from '../../lib/i18n/fr'
import {
  aClientLimits,
  anAbout,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'

const EVENT_PAGE = 'Page de l’évènement'

const renderPage = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/admin/events/new" element={<NewEventPage />} />
      <Route path="/admin/events/:slug" element={<p>{EVENT_PAGE}</p>} />
    </Routes>,
    { api, route: '/admin/events/new' },
  )

describe('NewEventPage', () => {
  it('previews the address as the host types the name', async () => {
    renderPage(fakeApi())

    expect(screen.getByText(fr.admin.slugPreviewEmpty)).toBeVisible()

    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')

    expect(screen.getByText('/e/camille-sacha')).toBeVisible()
  })

  /**
   * The same input and the same output as `src/domain/shared/slug.test.ts`.
   *
   * If the two implementations ever diverge, the host sees one address and gets
   * another — and the address is what every QR code and every projector URL is built
   * from.
   */
  it('folds an accented name exactly as the server does', async () => {
    renderPage(fakeApi())

    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha à Lyon')

    expect(screen.getByText('/e/camille-sacha-a-lyon')).toBeVisible()
  })

  it('previews a hand-written address folded the same way, since that is what is stored', async () => {
    renderPage(fakeApi())

    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.type(screen.getByLabelText(fr.admin.slug), 'Fête des Voisins')

    expect(screen.getByText('/e/fete-des-voisins')).toBeVisible()
  })

  it('treats a space in the address box as no address: the preview and the submit follow the name', async () => {
    // A lone space is not an address, so the form sends none and the server derives one from
    // the name. The preview names that same address; it does not fold the space to nothing and
    // announce that there is none over a name that has one.
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.type(screen.getByLabelText(fr.admin.slug), ' ')

    expect(screen.getByText('/e/camille-sacha')).toBeVisible()
    expect(screen.queryByText(fr.admin.slugPreviewEmpty)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Camille & Sacha', wallLanguage: 'fr' })
  })

  it('creates the event from the name alone and opens it', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    // No slug key at all when the field is untouched: the server derives it, and an
    // empty string would be a validation failure instead of an omission.
    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Camille & Sacha', wallLanguage: 'fr' })
    expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
  })

  it('sends the chosen address when the host wrote one', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Noces')
    await userEvent.type(screen.getByLabelText(fr.admin.slug), 'Noces d’Or')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({
      name: 'Noces',
      slug: 'noces-d-or',
      wallLanguage: 'fr',
    })
  })

  it('confirms the creation by name, so the host knows which event opened', async () => {
    const api = fakeApi({
      createEvent: vi.fn(async () => anEventDto({ name: 'Gala annuel', slug: 'gala' })),
    })

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Gala annuel')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(await screen.findByText(fr.admin.eventCreated('Gala annuel'))).toBeVisible()
  })

  it('says an address is taken and keeps the form as it was', async () => {
    const api = fakeApi({
      createEvent: vi.fn(() => Promise.reject(new ApiError(409, 'event.slugUnavailable'))),
    })

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.slugUnavailable'])
    expect(screen.getByLabelText(fr.admin.eventName)).toHaveValue('Camille & Sacha')
    expect(screen.queryByText(EVENT_PAGE)).toBeNull()
  })

  it('says an address is reserved in words the host can act on', async () => {
    const api = fakeApi({
      createEvent: vi.fn(() => Promise.reject(new ApiError(400, 'slug.reserved'))),
    })

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Settings')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['slug.reserved'])
  })

  it('tells the host when a name yields no usable address at all', async () => {
    renderPage(fakeApi())

    await userEvent.type(screen.getByLabelText(fr.admin.eventName), '!!! ???')

    expect(screen.getByText(fr.admin.slugPreviewEmpty)).toBeVisible()
  })

  // ---------------------------------------------------------------- templates --

  it('sends no template when the host picked none, because absence is how it is said', async () => {
    // There is no "no template" value on the wire. A `null` here would be an unexpected
    // key and a `400 request.invalid` on the one form a host meets first.
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Camille & Sacha', wallLanguage: 'fr' })
  })

  it('sends the template the host picked', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.wedding) }),
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({
      name: 'Camille & Sacha',
      template: 'wedding',
      wallLanguage: 'fr',
    })
  })

  it('sends a template alongside a hand-written address', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Séminaire')
    await userEvent.type(screen.getByLabelText(fr.admin.slug), 'Séminaire 2026')
    await userEvent.click(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.conference) }),
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({
      name: 'Séminaire',
      slug: 'seminaire-2026',
      template: 'conference',
      wallLanguage: 'fr',
    })
  })

  it('lets the host change their mind back to no template before creating', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.party) }),
    )
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(fr.admin.templateNone) }))
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Camille & Sacha', wallLanguage: 'fr' })
  })

  it('sends the language the host is reading, as the language the room will read', async () => {
    // The wall has nobody in front of it, so its language is decided here — once — from
    // the one signal that exists: what the person setting the event up is looking at.
    // There is no control for it on this form on purpose; the settings page is where a
    // host changes it, and a fifth decision in front of somebody creating an event at
    // 18:00 is a decision they would make wrongly.
    const api = fakeApi()

    renderWithProviders(<NewEventPage />, { api, route: '/admin/events/new', locale: 'de' })
    await userEvent.type(screen.getByLabelText(de.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: de.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({
      name: 'Camille & Sacha',
      wallLanguage: 'de',
    })
  })
})

/** A client's limits on the new-event form (G2-16 / P3-17). */
describe('NewEventPage: a client’s limits', () => {
  const onBox = (clients: ReturnType<typeof aClientLimits>[]) =>
    fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
      myLimits: vi.fn(async () => ({ clients })),
    })

  it('warns before the form, not after the refusal, when a ceiling is close', async () => {
    const limits = aClientLimits({
      meters: [{ kind: 'events', used: 9, max: 10, level: 'warning' }],
    })

    renderPage(onBox([limits]))

    const banner = await screen.findByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(banner).toHaveTextContent(fr.clientSpace.eventsMeter(9, 10))
    expect(screen.getByLabelText(fr.admin.eventName)).toBeVisible()
  })

  it('disables the create button at the events ceiling, and says why beside it', async () => {
    const limits = aClientLimits({
      meters: [{ kind: 'events', used: 10, max: 10, level: 'reached' }],
    })

    renderPage(onBox([limits]))

    // The form is drawn before the limits arrive, so the button is first enabled.
    const button = screen.getByRole('button', { name: fr.admin.create })
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAccessibleDescription(fr.errors['client.ceilingReached'])
  })

  it('disables it at the per-period ceiling too', async () => {
    const limits = aClientLimits({
      meters: [{ kind: 'eventsPerPeriod', used: 3, max: 3, level: 'reached' }],
    })

    renderPage(onBox([limits]))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: fr.admin.create })).toBeDisabled(),
    )
  })

  it('leaves the button alone when only the storage ceiling is reached, or an events ceiling is merely close', async () => {
    renderPage(
      onBox([
        aClientLimits({
          meters: [
            { kind: 'storage', used: 10, max: 10, level: 'reached' },
            { kind: 'events', used: 9, max: 10, level: 'warning' },
          ],
        }),
      ]),
    )

    // The banner is what says the limits have arrived.
    await screen.findByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(screen.getByRole('button', { name: fr.admin.create })).toBeEnabled()
    expect(screen.queryByText(fr.errors['client.ceilingReached'])).toBeNull()
  })

  it('keeps the button for a host who belongs to a second client that can still create', async () => {
    renderPage(
      onBox([
        aClientLimits({
          id: 'full',
          meters: [{ kind: 'events', used: 4, max: 4, level: 'reached' }],
        }),
        aClientLimits({ id: 'roomy', meters: [{ kind: 'events', used: 1, max: 4, level: 'ok' }] }),
      ]),
    )

    await screen.findByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(screen.getByRole('button', { name: fr.admin.create })).toBeEnabled()
  })

  it('offers no form to a suspended account, and says why', async () => {
    renderPage(onBox([aClientLimits({ suspended: true })]))

    expect(await screen.findByText(fr.clientSpace.suspendedTitle)).toBeVisible()
    expect(screen.queryByLabelText(fr.admin.eventName)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.create })).toBeNull()
  })

  it('is the form it always was on a box with no client space', async () => {
    const api = fakeApi()

    renderPage(api)

    expect(screen.getByLabelText(fr.admin.eventName)).toBeVisible()
    expect(api.myLimits).not.toHaveBeenCalled()
  })
})
