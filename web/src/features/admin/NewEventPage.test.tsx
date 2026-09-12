import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { NewEventPage } from './NewEventPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { anEventDto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
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

  it('creates the event from the name alone and opens it', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    // No slug key at all when the field is untouched: the server derives it, and an
    // empty string would be a validation failure instead of an omission.
    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Camille & Sacha' })
    expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
  })

  it('sends the chosen address when the host wrote one', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Noces')
    await userEvent.type(screen.getByLabelText(fr.admin.slug), 'Noces d’Or')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(api.createEvent).toHaveBeenCalledWith({ name: 'Noces', slug: 'noces-d-or' })
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
      createEvent: vi.fn(() => Promise.reject(new ApiError(409, 'event.slugTaken'))),
    })

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.admin.eventName), 'Camille & Sacha')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.create }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.slugTaken'])
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
})
