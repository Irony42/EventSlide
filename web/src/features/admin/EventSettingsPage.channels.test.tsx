import { describe, expect, it, vi } from 'vitest'
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
import type { ChannelsResponse } from '../../lib/api/dto'

/**
 * The "Messageries" section of the settings page (spec 27): the switch exists only on a box with a bot, is greyed
 * with the reason when the client's plan does not include it, and saves like any other setting.
 */

const channels = (overrides: Partial<ChannelsResponse> = {}): ChannelsResponse => ({
  available: true,
  botUsername: 'EventSlideBot',
  allowed: true,
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

    expect(screen.queryByText(fr.channels.settingsSection)).toBeNull()
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
})
