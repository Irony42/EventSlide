import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomAmbiancePage } from './CustomAmbiancePage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
import type { Api } from '../../lib/api/client'
import type { EventDto, EventThemeDto } from '../../lib/api/dto'

const CUSTOM_THEME: EventThemeDto = {
  ...DEFAULT_EVENT_THEME,
  ambiance: 'custom',
  custom: { ground: 'light', groundHue: 40, faces: 'noces' },
}

const eventWith = (theme: EventThemeDto, overrides: Partial<EventDto> = {}): EventDto =>
  anEventDto({ settings: eventSettings({ theme }), ...overrides })

const renderPage = (api: Api) =>
  renderWithProviders(<CustomAmbiancePage />, {
    api,
    route: '/admin/events/camille-et-sacha/settings/ambiance',
    path: '/admin/events/:slug/settings/ambiance',
  })

const wallFrame = () => document.querySelector<HTMLElement>('[data-template-preview="wall"]')
const phoneFrame = () => document.querySelector<HTMLElement>('[data-template-preview="guest"]')

describe('CustomAmbiancePage', () => {
  it('shows the values the event already holds, in the controls and in both frames', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME)) }))

    expect(
      await screen.findByRole('radio', { name: fr.admin.customGroundNames.light }),
    ).toBeChecked()
    expect(screen.getByLabelText(fr.admin.customGroundHue)).toHaveValue('40')
    expect(screen.getByRole('radio', { name: fr.admin.themeAmbianceNames.noces })).toBeChecked()
    for (const frame of [wallFrame(), phoneFrame()]) {
      expect(frame).toHaveAttribute('data-event-ambiance', 'custom')
      expect(frame).toHaveAttribute('data-ambiance-ground', 'light')
      expect(frame).toHaveAttribute('data-ambiance-faces', 'noces')
    }
    expect(wallFrame()?.style.getPropertyValue('--ground-hue')).toBe('40deg')
  })

  it('draws the previews as frames of their own, so the draft never dresses the page', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME)) }))
    await screen.findByRole('heading', { name: fr.admin.customAmbianceTitle })

    expect(wallFrame()).not.toBeNull()
    expect(phoneFrame()).not.toBeNull()
    // Neither frame is announced: they are an illustration of two other screens.
    expect(wallFrame()?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(phoneFrame()).toHaveAttribute('aria-hidden', 'true')
    // The real join card is in the wall frame, with the event's own QR.
    expect(wallFrame()?.querySelector('svg')).not.toBeNull()
  })

  it('moves the previews as soon as the polarity or an angle changes, and saves nothing', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME)) })
    renderPage(api)
    await screen.findByRole('heading', { name: fr.admin.customAmbianceTitle })

    await userEvent.click(screen.getByRole('radio', { name: fr.admin.customGroundNames.dark }))
    fireEvent.change(screen.getByLabelText(fr.admin.customGroundHue), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText(fr.admin.customAccentHue), { target: { value: '120' } })
    await userEvent.click(screen.getByRole('radio', { name: fr.admin.themeAmbianceNames.cabaret }))

    for (const frame of [wallFrame(), phoneFrame()]) {
      expect(frame).toHaveAttribute('data-ambiance-ground', 'dark')
      expect(frame).toHaveAttribute('data-ambiance-faces', 'cabaret')
      expect(frame?.style.getPropertyValue('--ground-hue')).toBe('200deg')
      expect(frame).toHaveAttribute('data-event-accent', '120')
    }
    expect(screen.getByText('200°')).toBeVisible()
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('renders each face in its own display face', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME)) }))
    const cabaret = await screen.findByRole('radio', { name: fr.admin.themeAmbianceNames.cabaret })

    expect(cabaret.parentElement?.querySelector('[data-ambiance-faces="cabaret"]')).not.toBeNull()
  })

  it('saves ambiance custom with its object and the accent, then returns to settings', async () => {
    const updateSettings = vi.fn(async (_slug: string, _settings: unknown) =>
      eventWith(CUSTOM_THEME),
    )
    const api = fakeApi({
      getEvent: vi.fn(async () => eventWith(DEFAULT_EVENT_THEME)),
      updateSettings,
    })
    renderPage(api)
    await screen.findByRole('heading', { name: fr.admin.customAmbianceTitle })

    await userEvent.click(screen.getByRole('radio', { name: fr.admin.customGroundNames.light }))
    fireEvent.change(screen.getByLabelText(fr.admin.customGroundHue), { target: { value: '90' } })
    await userEvent.click(screen.getByRole('radio', { name: fr.admin.themeAmbianceNames.riviera }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    const sent = updateSettings.mock.calls[0]?.[1] as { theme: EventThemeDto }
    expect(sent.theme).toMatchObject({
      ambiance: 'custom',
      accentHue: DEFAULT_EVENT_THEME.accentHue,
      custom: { ground: 'light', groundHue: 90, faces: 'riviera' },
    })
    expect(sent.theme).not.toHaveProperty('groundUrl')
  })

  it('shows a refusal in words next to the button and keeps the draft as it was left', async () => {
    const updateSettings = vi.fn(async () => {
      throw new ApiError(422, 'eventTheme.accentTooCloseToStatus')
    })
    renderPage(fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME)), updateSettings }))
    await screen.findByRole('heading', { name: fr.admin.customAmbianceTitle })

    fireEvent.change(screen.getByLabelText(fr.admin.customAccentHue), { target: { value: '125' } })
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.errors['eventTheme.accentTooCloseToStatus'])
    expect(alert).toHaveTextContent(fr.admin.customKept)
    // Not corrected: the slider and the preview still wear the refused angle.
    expect(screen.getByLabelText(fr.admin.customAccentHue)).toHaveValue('125')
    expect(wallFrame()).toHaveAttribute('data-event-accent', '125')
  })

  it('can be read but not saved by a moderator', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(async () => eventWith(CUSTOM_THEME, { role: 'moderator' })) }),
    )
    await screen.findByRole('heading', { name: fr.admin.customAmbianceTitle })

    expect(screen.getByText(fr.admin.settingsOwnerOnly)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.app.save })).toBeDisabled()
  })
})
