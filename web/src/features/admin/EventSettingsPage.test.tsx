import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventSettingsPage } from './EventSettingsPage'
import { toLocalInput } from './eventSchedule'
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

/**
 * A read whose completion the test decides.
 *
 * The resolver is captured and settled inside this object's own methods rather than in
 * the test body, because TypeScript's control-flow analysis narrows a `let` assigned
 * only inside a callback to `null` at every later use in the same scope.
 */
const deferredEvent = () => {
  let release: ((event: EventDto) => void) | null = null
  return {
    promise: (): Promise<EventDto> =>
      new Promise<EventDto>((resolve) => {
        release = resolve
      }),
    /** `false` until the page has actually asked, which is what `waitFor` polls on. */
    settle: (value: EventDto): boolean => {
      if (release === null) return false
      release(value)
      release = null
      return true
    },
  }
}

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

  it('shows the form what the server stored after a save, not what was typed', async () => {
    // The draft is re-synced from the answer during render, against the settings object
    // last synced from — deliberately not in an effect. An effect painted the previous
    // event's settings for one frame after a save, which on a slow laptop reads as the
    // save having been lost. The observable half of that is this: a value the host never
    // touched, changed by the server as part of the save, is on screen straight after.
    const api = fakeApi({
      updateSettings: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowCaptions: false, retentionDays: 365 }) }),
      ),
    })

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(await screen.findByText(fr.admin.settingsSaved)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.retention)).toHaveValue('365')
    expect(screen.getByLabelText(fr.admin.allowCaptions)).not.toBeChecked()
  })

  it('saves the host’s choice about reactions', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowReactions))
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowReactions: false, allowCaptions: true }),
    )
  })

  it('saves the host’s choice about guests deleting their own photos', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowGuestSelfDelete))
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowGuestSelfDelete: false }),
    )
  })

  it('saves the grace delay as a number of seconds', async () => {
    // The DTO carries seconds. A select value is a string, and sending "900" would be
    // rejected by the server's schema rather than silently coerced.
    const api = fakeApi()

    renderPage(api)
    await userEvent.selectOptions(await screen.findByLabelText(fr.admin.selfDeleteGrace), '900')
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ guestSelfDeleteGraceSeconds: 900 }),
    )
  })

  it('saves a per-guest photo limit as a number', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.selectOptions(await screen.findByLabelText(fr.admin.maxPhotosPerGuest), '25')
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ maxPhotosPerGuest: 25 }),
    )
  })

  it('shows the per-guest photo limit the server already holds', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ maxPhotosPerGuest: 50 }) }),
      ),
    })

    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.maxPhotosPerGuest)).toHaveValue('50')
  })

  it('labels a grace delay under a minute in seconds', async () => {
    // Seconds are not one of the offered delays, so this value can only have come from
    // a seed or a later build. Labelling it "0,5 minutes" would be worse than keeping it.
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ guestSelfDeleteGraceSeconds: 30 }) }),
      ),
    })

    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.selfDeleteGrace)).toHaveValue('30')
    expect(screen.getByRole('option', { name: fr.admin.graceSeconds(30) })).toBeInTheDocument()
  })

  /**
   * The host's half of "opens at 18:00, closes at 02:00" (docs/ROADMAP.md §3.4).
   *
   * Every instant here goes through `toLocalInput`, never through a hardcoded local
   * string: the fields hold wall-clock time in the runner's own zone, and an expectation
   * of `18:00` would pass in Paris and fail in CI.
   */
  describe('the scheduled opening and closing', () => {
    const OPENS_AT = '2026-06-20T16:00:00.000Z'
    const CLOSES_AT = '2026-06-21T00:00:00.000Z'

    const openField = () => screen.getByLabelText(new RegExp(fr.admin.scheduleOpenAt))
    const closeField = () => screen.getByLabelText(new RegExp(fr.admin.scheduleCloseAt))
    const saveButton = () => screen.getByRole('button', { name: fr.admin.scheduleSave })

    it('shows the schedule the server holds, on the clock the host is looking at', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ scheduledOpenAt: OPENS_AT, scheduledCloseAt: CLOSES_AT }),
        ),
      })

      renderPage(api)

      expect(await screen.findByRole('heading', { name: fr.admin.schedule })).toBeVisible()
      expect(openField()).toHaveValue(toLocalInput(OPENS_AT))
      expect(closeField()).toHaveValue(toLocalInput(CLOSES_AT))
    })

    it('says plainly when nothing is scheduled, so an empty field is not ambiguous', async () => {
      renderPage(fakeApi())

      expect(await screen.findByText(fr.admin.scheduleNone)).toBeVisible()
      expect(openField()).toHaveValue('')
    })

    it('summarises what is armed on the server, not what is typed in the fields', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () => anEventDto({ scheduledOpenAt: OPENS_AT })),
      })

      renderPage(api)

      // Only the opening is set, so the host is told they still close it themselves.
      expect(await screen.findByText(/Vous clôturerez vous-même/)).toBeVisible()
    })

    it('sends both instants when the host saves', async () => {
      const api = fakeApi()
      renderPage(api)

      fireEvent.change(await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)), {
        target: { value: toLocalInput(OPENS_AT) },
      })
      fireEvent.change(closeField(), { target: { value: toLocalInput(CLOSES_AT) } })
      await userEvent.click(saveButton())

      expect(api.setSchedule).toHaveBeenCalledWith('camille-et-sacha', {
        scheduledOpenAt: OPENS_AT,
        scheduledCloseAt: CLOSES_AT,
      })
    })

    it('sends null for a field the host emptied, which turns that half off', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ scheduledOpenAt: OPENS_AT, scheduledCloseAt: CLOSES_AT }),
        ),
      })
      renderPage(api)

      fireEvent.change(await screen.findByLabelText(new RegExp(fr.admin.scheduleCloseAt)), {
        target: { value: '' },
      })
      await userEvent.click(saveButton())

      expect(api.setSchedule).toHaveBeenCalledWith('camille-et-sacha', {
        scheduledOpenAt: OPENS_AT,
        scheduledCloseAt: null,
      })
    })

    it('does not touch the settings form when the schedule is saved', async () => {
      const api = fakeApi()
      renderPage(api)

      await userEvent.click(await screen.findByRole('button', { name: fr.admin.scheduleSave }))

      expect(api.updateSettings).not.toHaveBeenCalled()
    })

    it('shows the refusal when the closing comes before the opening', async () => {
      const api = fakeApi({
        setSchedule: vi.fn(async () => {
          throw new ApiError(400, 'event.scheduleOutOfOrder')
        }),
      })
      renderPage(api)

      await userEvent.click(await screen.findByRole('button', { name: fr.admin.scheduleSave }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['event.scheduleOutOfOrder'],
      )
    })

    it('cannot be armed on an archived event, which is read-only', async () => {
      const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) })

      renderPage(api)

      expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
      expect(openField()).toBeDisabled()
      expect(saveButton()).toBeDisabled()
    })

    it('offers no minute earlier than now in the picker', async () => {
      renderPage(fakeApi())

      // A guide rather than the guard — the form is noValidate and the server refuses a
      // past instant — but it is what keeps the commonest mistake off the first click.
      await screen.findByRole('heading', { name: fr.admin.schedule })
      expect(openField()).toHaveAttribute('min', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
      expect(closeField()).toHaveAttribute('min', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    })

    it('re-reads the event when a save is refused, so the form stops showing stale values', async () => {
      // The refusal a stale form provokes is "that instant has already gone by", and
      // the reason is usually that the sweep moved underneath a tab left open for
      // hours. Showing the sentence without re-reading leaves the host arguing with
      // values the server stopped holding.
      const getEvent = vi.fn(async () => anEventDto())
      const api = fakeApi({
        getEvent,
        setSchedule: vi.fn(async () => {
          throw new ApiError(400, 'event.scheduleInPast')
        }),
      })
      renderPage(api)
      await userEvent.click(await screen.findByRole('button', { name: fr.admin.scheduleSave }))

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.scheduleInPast'])
      expect(getEvent.mock.calls.length).toBeGreaterThan(1)
    })

    it('re-reads the event when the host comes back to the tab', async () => {
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(fakeApi({ getEvent }))
      await screen.findByRole('heading', { name: fr.admin.schedule })
      const readsOnLoad = getEvent.mock.calls.length

      fireEvent(document, new Event('visibilitychange'))

      await waitFor(() => expect(getEvent.mock.calls.length).toBeGreaterThan(readsOnLoad))
    })

    it('does not blank the form to a spinner while it revalidates', async () => {
      // Revalidating on focus would otherwise replace a form the host is typing in with
      // a loading state for a round trip, every time they switch windows.
      const pending = deferredEvent()
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(fakeApi({ getEvent }))
      await screen.findByRole('heading', { name: fr.admin.schedule })
      getEvent.mockImplementationOnce(pending.promise)

      fireEvent(window, new Event('focus'))

      expect(screen.getByRole('heading', { name: fr.admin.schedule })).toBeVisible()
      expect(screen.queryByText(fr.admin.eventLoading)).toBeNull()
      await waitFor(() => expect(pending.settle(anEventDto())).toBe(true))
    })

    it('keeps what the host has typed when a background refresh changes nothing', async () => {
      // The revalidation above must not be a way to lose an edit in progress. The draft
      // is compared by value, so it is reset only when the server's answer really moved.
      const api = fakeApi()
      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))

      fireEvent(window, new Event('focus'))

      await waitFor(() => expect(screen.getByLabelText(fr.admin.moderationAuto)).toBeChecked())
    })

    it('says the sweep threw a schedule away, which is the only record that it existed', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ scheduleDiscardedAt: '2026-06-21T02:00:00.000Z' }),
        ),
      })

      renderPage(api)

      expect(await screen.findByText(/n’a pas pu s’appliquer/)).toBeVisible()
    })

    it('says nothing of the sort when no schedule was ever thrown away', async () => {
      renderPage(fakeApi())

      await screen.findByRole('heading', { name: fr.admin.schedule })
      expect(screen.queryByText(/n’a pas pu s’appliquer/)).toBeNull()
    })
  })
})
