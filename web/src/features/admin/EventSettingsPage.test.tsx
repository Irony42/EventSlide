import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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
import type { EventDto } from '../../lib/api/dto'

const renderPage = (api: Api) =>
  renderWithProviders(<EventSettingsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/settings',
    path: '/admin/events/:slug/settings',
  })

describe('EventSettingsPage', () => {
  it('says it is working while the event loads', () => {
    const api = fakeApi({ getEvent: vi.fn(() => new Promise<EventDto>(() => {})) })

    renderPage(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.eventLoading)
  })

  it('names the failure and offers a retry', async () => {
    const getEvent = vi.fn(async () => anEventDto())
    getEvent.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ getEvent })

    renderPage(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('heading', { name: fr.admin.settings })).toBeVisible()
  })

  it('shows the settings the server sent', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({
          settings: eventSettings({ allowReactions: false, retentionDays: 30 }),
        }),
      ),
    })

    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.moderationManual)).toBeChecked()
    expect(screen.getByLabelText(fr.admin.allowCaptions)).toBeChecked()
    expect(screen.getByLabelText(fr.admin.allowReactions)).not.toBeChecked()
    expect(screen.getByLabelText(fr.admin.retention)).toHaveValue('30')
  })

  it('warns about automatic publishing only once that option is chosen', async () => {
    renderPage(fakeApi())

    expect(await screen.findByLabelText(fr.admin.moderationAuto)).not.toBeChecked()
    expect(screen.queryByText(fr.admin.moderationAutoWarning)).toBeNull()

    await userEvent.click(screen.getByLabelText(fr.admin.moderationAuto))

    // The one setting that can put something unwanted on a screen in front of two
    // hundred people. It must not be a casual toggle.
    expect(screen.getByText(fr.admin.moderationAutoWarning)).toBeVisible()
  })

  it('takes the warning away again when the host goes back to validating each photo', async () => {
    renderPage(fakeApi())

    await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))
    await userEvent.click(screen.getByLabelText(fr.admin.moderationManual))

    expect(screen.queryByText(fr.admin.moderationAutoWarning)).toBeNull()
  })

  it('saves what the host changed and confirms it', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))
    await userEvent.selectOptions(screen.getByLabelText(fr.admin.retention), '90')
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      ...eventSettings(),
      allowCaptions: false,
      retentionDays: 90,
    })
    expect(await screen.findByText(fr.admin.settingsSaved)).toBeVisible()
  })

  it('sends null for a limit the host turned off, not zero', async () => {
    // `null` is "no limit" in the DTO; `0` would be a different, invalid intent.
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ retentionDays: 30 }) })),
    })

    renderPage(api)
    await userEvent.selectOptions(
      await screen.findByLabelText(fr.admin.retention),
      fr.admin.retentionNever,
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ retentionDays: null }),
    )
  })

  it('keeps a stored value this form does not offer, instead of rewriting it', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ retentionDays: 14 }) })),
    })

    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.retention)).toHaveValue('14')
    expect(screen.getByRole('option', { name: fr.admin.retentionDays(14) })).toBeInTheDocument()
  })

  it('surfaces the server’s refusal of a settings change', async () => {
    const api = fakeApi({
      updateSettings: vi.fn(() =>
        Promise.reject(new ApiError(400, 'eventSettings.retentionDaysInvalid')),
      ),
    })

    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.app.save }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['eventSettings.retentionDaysInvalid'],
    )
  })

  it('freezes the form for an archived event and says why', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) })

    renderPage(api)

    expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.moderationAuto)).toBeDisabled()
    expect(screen.getByLabelText(fr.admin.allowCaptions)).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.app.save })).toBeDisabled()
  })

  it('leaves the grace delay inert while guests cannot delete their own photos', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowGuestSelfDelete: false }) }),
      ),
    })

    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.selfDeleteGrace)).toBeDisabled()
  })
})
