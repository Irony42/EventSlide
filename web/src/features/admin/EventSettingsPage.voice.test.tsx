import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventSettingsPage } from './EventSettingsPage'
import { fr } from '../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventDto, EventSettingsDto } from '../../lib/api/dto'

/** The voice messages section of the settings page (spec 25): switch, secret, "Ouvrir maintenant", warning. */
const voice = (
  patch: Partial<EventSettingsDto['guestbookVoice']>,
): EventSettingsDto['guestbookVoice'] => ({
  enabled: false,
  sealed: false,
  opensAtMs: null,
  ...patch,
})

const eventWith = (
  group: Partial<EventSettingsDto['guestbookVoice']>,
  overrides: Partial<EventDto> = {},
): EventDto =>
  anEventDto({ settings: eventSettings({ guestbookVoice: voice(group) }), ...overrides })

const render = (api: Api) =>
  renderWithProviders(<EventSettingsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/settings',
    path: '/admin/events/:slug/settings',
  })

const stubSecureContext = (secure: boolean): void => {
  vi.stubGlobal('isSecureContext', secure)
}

describe('EventSettingsPage, voice messages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends only the voice key the host changed', async () => {
    stubSecureContext(true)
    const api = fakeApi({ getEvent: vi.fn(async () => eventWith({})) })
    render(api)

    await userEvent.click(await screen.findByLabelText(fr.guestbookVoiceHost.settingsEnabled))
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled())
    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ guestbookVoice: { enabled: true } }),
    )
  })

  it('keeps the secret switch off until the voice switch is on', async () => {
    stubSecureContext(true)
    render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: false })) }))

    expect(await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)).toBeDisabled()
  })

  it('says the secret in the interface’s words, not the code’s', async () => {
    stubSecureContext(true)
    render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: true })) }))

    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(document.body.textContent).not.toMatch(/scell/i)
  })

  it('offers "Ouvrir maintenant" to the owner only while the secret holds, and asks first', async () => {
    stubSecureContext(true)
    const api = fakeApi({
      getEvent: vi.fn(async () => eventWith({ enabled: true, sealed: true })),
    })
    render(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.guestbookVoiceHost.openNow }),
    )
    // Nothing is written by the first press: the dialog is the confirmation.
    expect(api.openGuestbookVoice).not.toHaveBeenCalled()
    expect(screen.getByText(fr.guestbookVoiceHost.openConfirmBody)).toBeVisible()

    await userEvent.click(
      screen.getAllByRole('button', { name: fr.guestbookVoiceHost.openNow }).at(-1) as HTMLElement,
    )

    await waitFor(() => expect(api.openGuestbookVoice).toHaveBeenCalledWith('camille-et-sacha'))
    expect(await screen.findByText(fr.guestbookVoiceHost.opened)).toBeVisible()
  })

  it('does not open anything when the owner cancels the confirmation', async () => {
    stubSecureContext(true)
    const api = fakeApi({
      getEvent: vi.fn(async () => eventWith({ enabled: true, sealed: true })),
    })
    render(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.guestbookVoiceHost.openNow }),
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.openGuestbookVoice).not.toHaveBeenCalled()
  })

  it('shows a moderator no "Ouvrir maintenant": the owner alone lifts the secret', async () => {
    stubSecureContext(true)
    render(
      fakeApi({
        getEvent: vi.fn(async () =>
          eventWith({ enabled: true, sealed: true }, { role: 'moderator' }),
        ),
      }),
    )

    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(screen.queryByRole('button', { name: fr.guestbookVoiceHost.openNow })).toBeNull()
  })

  it('shows no "Ouvrir maintenant" once the secret is open or without a secret', async () => {
    stubSecureContext(true)
    const open = render(
      fakeApi({
        getEvent: vi.fn(async () => eventWith({ enabled: true, sealed: true, opensAtMs: 1 })),
      }),
    )
    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(screen.queryByRole('button', { name: fr.guestbookVoiceHost.openNow })).toBeNull()
    open.unmount()

    render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: true, sealed: false })) }))
    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(screen.queryByRole('button', { name: fr.guestbookVoiceHost.openNow })).toBeNull()
  })

  it('warns the host when the address is not secure and voice is on', async () => {
    stubSecureContext(false)
    render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: true })) }))

    expect(await screen.findByText(fr.guestbookVoiceHost.insecure)).toBeVisible()
  })

  it('does not warn on a secure address, nor when voice is off', async () => {
    stubSecureContext(true)
    const secure = render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: true })) }))
    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(screen.queryByText(fr.guestbookVoiceHost.insecure)).toBeNull()
    secure.unmount()

    stubSecureContext(false)
    render(fakeApi({ getEvent: vi.fn(async () => eventWith({ enabled: false })) }))
    await screen.findByLabelText(fr.guestbookVoiceHost.settingsSealed)
    expect(screen.queryByText(fr.guestbookVoiceHost.insecure)).toBeNull()
  })
})
