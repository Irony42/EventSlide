import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { WelcomePage } from './WelcomePage'
import buttonStyles from '../../design-system/components/Button.module.css'
import { fr } from '../../lib/i18n/fr'
import { classesOf, cls } from '../../testing/classesOf'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventDto } from '../../lib/api/dto'

/**
 * The screen a new event opens on: the logo is asked for once, early, and can be left for later.
 *
 * What it promises: it names the event it has just made, it reuses the logo control and its endpoint,
 * « Plus tard » is the quiet way out and « Continuer » replaces it as the primary one once a logo is
 * there, and only the owner of an event that can still change is shown it.
 */

const LOGO = `/api/events/camille-et-sacha/logo/${'ab'.repeat(32)}`
const EVENT_PAGE = 'Page de l’évènement'

/** What a host has just made: only a draft is shown the screen. */
const aDraft = (overrides: Partial<EventDto> = {}): EventDto =>
  anEventDto({ status: 'draft', ...overrides })

const withLogo = (): EventDto =>
  aDraft({ settings: eventSettings({ brand: { welcomeMessage: null, logoUrl: LOGO } }) })

const renderPage = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/admin/events/:slug/welcome" element={<WelcomePage />} />
      <Route path="/admin/events/:slug" element={<p>{EVENT_PAGE}</p>} />
    </Routes>,
    { api, route: '/admin/events/camille-et-sacha/welcome' },
  )

const apiFor = (event: EventDto, overrides: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({ getEvent: vi.fn(async () => event), ...overrides })

// Testing Library folds every run of white space, the non-breaking one included, in what it reads.
const spaced = (value: string) => value.replace(/\s/g, ' ')
const text = (value: string) => (content: string) => spaced(content) === spaced(value)

describe('WelcomePage', () => {
  it('says which event was created, by its own name', async () => {
    renderPage(apiFor(aDraft({ name: 'Camille & Sacha' })))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: fr.admin.welcome.title('Camille & Sacha'),
      }),
    ).toBeVisible()
    expect(screen.getByText(text(fr.admin.welcome.lead))).toBeVisible()
    expect(screen.getByText(text(fr.admin.welcome.findLater))).toBeVisible()
  })

  it('offers « Plus tard » as a secondary button while there is no logo, and leaves for the event', async () => {
    renderPage(apiFor(aDraft()))

    const later = await screen.findByRole('button', { name: fr.admin.welcome.later })
    // Secondary: the primary button is reserved for the step that moves the host forward.
    expect(classesOf(later)).not.toContain(cls(buttonStyles, 'primary'))
    expect(classesOf(later)).toContain(cls(buttonStyles, 'secondary'))
    expect(screen.queryByRole('button', { name: fr.admin.welcome.continue })).toBeNull()

    await userEvent.click(later)

    expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
  })

  it('uploads the logo through the same control as the Apparence page, then offers « Continuer » as the primary button', async () => {
    const answered = withLogo()
    const api = apiFor(aDraft(), { putEventLogo: vi.fn(async () => answered) })
    renderPage(api)
    const file = new File(['pixels'], 'logo.png', { type: 'image/png' })

    await userEvent.upload(await screen.findByTestId('logo-input'), file)

    await waitFor(() => expect(api.putEventLogo).toHaveBeenCalledWith('camille-et-sacha', file))
    const next = await screen.findByRole('button', { name: fr.admin.welcome.continue })
    expect(classesOf(next)).toContain(cls(buttonStyles, 'primary'))
    expect(screen.queryByRole('button', { name: fr.admin.welcome.later })).toBeNull()

    await userEvent.click(next)

    expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
  })

  it('shows « Continuer » at once when the event already has a logo', async () => {
    renderPage(apiFor(withLogo()))

    expect(await screen.findByRole('button', { name: fr.admin.welcome.continue })).toBeVisible()
  })

  it('sends a moderator to the event’s page: the logo is the owner’s', async () => {
    renderPage(apiFor(aDraft({ role: 'moderator' })))

    expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
    expect(screen.queryByTestId('logo-input')).toBeNull()
  })

  it.each(['live', 'closed', 'archived'] as const)(
    'sends the host to the event’s page when the event is %s: « est créé » is only true of a draft',
    async (status) => {
      renderPage(apiFor(anEventDto({ status })))

      expect(await screen.findByText(EVENT_PAGE)).toBeVisible()
      expect(screen.queryByTestId('logo-input')).toBeNull()
    },
  )

  it('holds the way out while the logo is on its way, so the host cannot leave mid-upload', async () => {
    let finish: (event: EventDto) => void = () => undefined
    const api = apiFor(aDraft(), {
      putEventLogo: vi.fn(() => new Promise<EventDto>((resolve) => (finish = resolve))),
    })
    renderPage(api)

    await userEvent.upload(
      await screen.findByTestId('logo-input'),
      new File(['pixels'], 'logo.png', { type: 'image/png' }),
    )

    expect(await screen.findByRole('button', { name: fr.admin.welcome.later })).toBeDisabled()

    act(() => finish(withLogo()))

    expect(await screen.findByRole('button', { name: fr.admin.welcome.continue })).toBeEnabled()
  })

  it('says the event could not be read and lets the host retry', async () => {
    const getEvent = vi
      .fn<Api['getEvent']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(aDraft())
    renderPage(fakeApi({ getEvent }))

    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('button', { name: fr.admin.welcome.later })).toBeVisible()
  })

  it('waits for the event before showing anything', () => {
    renderPage(fakeApi({ getEvent: vi.fn(() => new Promise<EventDto>(() => {})) }))

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.eventLoading)
  })
})
