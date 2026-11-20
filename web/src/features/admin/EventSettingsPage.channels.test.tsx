import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventSettingsPage } from './EventSettingsPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ChannelsResponse } from '../../lib/api/dto'

/**
 * The "Messageries" section of the settings page (spec 27): the switch exists only on a box with a bot, is greyed
 * with the reason when the client's plan does not include it, and saves like any other setting.
 */

const channels = (overrides: Partial<ChannelsResponse> = {}): ChannelsResponse => ({
  available: true,
  botUsername: 'EventSlideBot',
  allowed: true,
  readsAllMessages: true,
  bindings: [],
  ...overrides,
})

const renderPage = (api: Api) =>
  renderWithProviders(<EventSettingsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/settings#messaging',
    path: '/admin/events/:slug/settings',
  })

describe('EventSettingsPage: messaging', () => {
  it('offers the Telegram switch on a box with a bot, and saves it', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowTelegram: false }) }),
      ),
      channels: vi.fn(async () => channels()),
    })

    renderPage(api)
    const control = await screen.findByLabelText(fr.channels.allowTelegram)
    expect(control).not.toBeChecked()
    expect(control).toBeEnabled()
    expect(screen.getByText(fr.channels.allowTelegramHint)).toBeInTheDocument()

    await userEvent.click(control)

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { allowTelegram: true }),
    )
  })

  it('has no such section at all on a box without a bot', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto()),
      channels: vi.fn(async () => channels({ available: false, botUsername: null })),
    })

    renderPage(api)
    await screen.findByText(fr.admin.settingsPage.guests)

    // The section is held while the box is asked (a #messaging link must still open it), then withdrawn once the
    // answer says there is no bot: the assertion waits for that answer, which is the moment that matters.
    await waitFor(() => expect(screen.queryByText(fr.channels.settingsSection)).toBeNull())
    expect(screen.queryByLabelText(fr.channels.allowTelegram)).toBeNull()
  })

  it('greys the switch, saying why, when the plan does not include it', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto()),
      channels: vi.fn(async () => channels({ allowed: false })),
    })

    renderPage(api)

    const control = await screen.findByLabelText(fr.channels.allowTelegram)
    expect(control).toBeDisabled()
    expect(screen.getByText(fr.channels.notAllowed)).toBeInTheDocument()
  })

  it('says in the closed section whether Telegram is on', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ allowTelegram: true }) })),
      channels: vi.fn(async () => channels()),
    })

    renderWithProviders(<EventSettingsPage />, {
      api,
      route: '/admin/events/camille-et-sacha/settings#guests',
      path: '/admin/events/:slug/settings',
    })

    expect(await screen.findByText(fr.channels.on)).toBeInTheDocument()
  })

  it('keeps the section in place while the box is being asked, so a link to it still opens it', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto()),
      channels: vi.fn(() => new Promise<ChannelsResponse>(() => {})),
    })

    renderPage(api)

    expect(await screen.findByText(fr.channels.settingsSection)).toBeInTheDocument()
    expect(screen.queryByLabelText(fr.channels.allowTelegram)).toBeNull()
  })

  it('says so, in the section, when the box could not be asked', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto()),
      channels: vi.fn(async () => {
        throw ApiError.network()
      }),
    })

    renderPage(api)

    expect(await screen.findByText(fr.errors.network)).toBeInTheDocument()
  })

  it('lets a host whose plan was withdrawn switch Telegram off, and no longer on', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ allowTelegram: true }) })),
      channels: vi.fn(async () => channels({ allowed: false })),
    })

    renderPage(api)
    const control = await screen.findByLabelText(fr.channels.allowTelegram)
    expect(control).toBeEnabled()

    await userEvent.click(control)

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { allowTelegram: false }),
    )
  })
})
