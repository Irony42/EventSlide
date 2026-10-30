import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventSettingsPage } from './EventSettingsPage'
import { toLocalInput } from './eventSchedule'
import { DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
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

  it('offers the list of events inside the failure itself, beside the retry', async () => {
    renderPage(
      fakeApi({ getEvent: vi.fn(() => Promise.reject(new ApiError(404, 'event.notFound'))) }),
    )

    await screen.findByRole('alert')

    // The failure's own way out, beside Réessayer and not only in the trail above it: an address
    // that does not exist or an access that was withdrawn is not mended by asking again.
    const failure = screen.getByRole('alert')
    expect(within(failure).getByRole('button', { name: fr.app.retry })).toBeVisible()
    expect(within(failure).getByRole('link', { name: fr.admin.events })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  describe('for a moderator, whose every save the server refuses', () => {
    const asModerator = () =>
      fakeApi({
        getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })),
      })

    it('says only the owner can change the settings, and disables every control', async () => {
      renderPage(asModerator())

      expect(await screen.findByText(fr.admin.settingsOwnerOnly)).toBeVisible()
      expect(screen.getByLabelText(fr.admin.moderationManual)).toBeDisabled()
      expect(screen.getByLabelText(fr.admin.allowCaptions)).toBeDisabled()
      expect(screen.getByRole('button', { name: fr.app.save })).toBeDisabled()
      // Every control of the page, the schedule form's included, and not a sample of them: each is a
      // save the server refuses a moderator.
      const controls = [...document.querySelectorAll('input, select, textarea, button')]
      expect(controls.length).toBeGreaterThan(10)
      for (const control of controls) expect(control).toBeDisabled()
      // Not the archived sentence: the reason is the role, and the event is live.
      expect(screen.queryByText(fr.admin.settingsReadOnly)).toBeNull()
    })

    it('gives the archived reason, not the role one, for an archived event', async () => {
      renderPage(
        fakeApi({
          getEvent: vi.fn(async () => anEventDto({ role: 'moderator', status: 'archived' })),
        }),
      )

      expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
      expect(screen.queryByText(fr.admin.settingsOwnerOnly)).toBeNull()
    })

    it('leaves the form to the owner, who gets no such sentence', async () => {
      renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'owner' })) }))

      expect(await screen.findByLabelText(fr.admin.moderationManual)).toBeEnabled()
      expect(screen.queryByText(fr.admin.settingsOwnerOnly)).toBeNull()
    })
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

  it('lets the live region it sits in announce the warning, with no role of its own', async () => {
    renderPage(fakeApi())
    await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))

    const warning = screen.getByText(fr.admin.moderationAutoWarning)

    // One announcement, by the region the page mounted once: a role on the warning as
    // well would say it twice.
    expect(warning.closest('[aria-live="polite"]')).not.toBeNull()
    expect(warning.closest('[role="alert"], [role="status"]')).toBeNull()
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

  it('turns video on for a gallery that predates it', async () => {
    // The state that matters, and the one no other screen can reach: the persistence
    // fallback reads `allowClips: false` for every event stored before clips shipped, so
    // without this checkbox video is unreachable on exactly the events the feature
    // exists for.
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ allowClips: false }) })),
    })

    renderPage(api)
    const control = await screen.findByLabelText(fr.admin.allowClips)
    expect(control).not.toBeChecked()

    await userEvent.click(control)
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowClips: true }),
    )
  })

  it('saves the event’s look as one theme rather than three loose fields', async () => {
    // Roadmap 2.2. The endpoint refuses half a theme — the legibility rule judges the
    // three together — so the form has to send all of them whichever one the host moved.
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(
      await screen.findByRole('radio', { name: fr.admin.themeAccentNames.rose }),
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({
        theme: {
          accentHue: 345,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'eventslide',
        },
      }),
    )
  })

  it('leaves the console itself in the product’s colours, whatever the event wears', async () => {
    // The most-repeated promise of roadmap 2.2 and, until this test, the one nothing
    // enforced: adding `themeSurfaceProps` to `AppShell` would have broken nothing. The
    // console is one operator's tool across many events, and `--success`/`--danger` in
    // the moderation queue are a working vocabulary rather than decoration.
    //
    // The colour picker's own rows are the deliberate exception: each previews one
    // option's hue on itself, and a row contains a radio and a swatch and nothing else.
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({
          settings: eventSettings({
            theme: {
              accentHue: 345,
              fonts: 'serif',
              frame: 'round',
              ambiance: 'eventslide',
            },
          }),
        }),
      ),
    })

    renderPage(api)
    await screen.findByRole('heading', { name: fr.admin.settings })

    expect(document.querySelectorAll('[data-event-fonts]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-event-frame]')).toHaveLength(0)

    expect(document.querySelectorAll('[data-event-ambiance]')).toHaveLength(0)

    // Nothing carries the event's hue except the picker's own rows — and they carry one
    // option's hue each, which is never the event's. The default row carries none: since
    // ADR 0010 it previews the paper the root already paints.
    const picker = screen.getByTestId('theme-accents')
    const marked = [...document.querySelectorAll('[data-event-accent]')]
    expect(marked).toHaveLength(3)
    for (const row of marked) expect(picker.contains(row)).toBe(true)
    expect(marked.map((row) => row.getAttribute('data-event-accent'))).toEqual([
      '345',
      '250',
      '195',
    ])
  })

  it('dresses the console in the event’s ambiance, and only in that (ADR 0010, 28/10)', async () => {
    // Pierre's call on 28/10: an event in the Riviera is a Riviera in the console too.
    // The accent, the pairing and the frame still stay off the console: the ambiance is the
    // world, the hue is the event's, and the moderation queue's status colours are fixed.
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({
          settings: eventSettings({
            theme: {
              accentHue: 345,
              fonts: 'serif',
              frame: 'round',
              ambiance: 'riviera',
            },
          }),
        }),
      ),
    })

    renderPage(api)
    await screen.findByRole('heading', { name: fr.admin.settings })

    const dressed = [...document.querySelectorAll('[data-event-ambiance]')]
    expect(dressed.map((node) => node.getAttribute('data-event-ambiance'))).toEqual(['riviera'])
    expect(document.querySelectorAll('[data-event-fonts]')).toHaveLength(0)
  })

  it('shows the theme the server already holds', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({
          settings: eventSettings({
            theme: {
              accentHue: 250,
              fonts: 'serif',
              frame: 'square',
              ambiance: 'eventslide',
            },
          }),
        }),
      ),
    })

    renderPage(api)

    expect(
      await screen.findByRole('radio', { name: fr.admin.themeAccentNames.azure }),
    ).toBeChecked()
    expect(screen.getByLabelText(fr.admin.themeFrame)).toHaveValue('square')
  })

  it('says why the switch is off on an older gallery', async () => {
    // A host who finds an unticked box with no explanation reads it as a choice somebody
    // made, not as a default they were never asked about.
    renderPage(fakeApi())

    expect(await screen.findByText(fr.admin.allowClipsHint)).toBeVisible()
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
      expect(await screen.findByText(/Vous terminerez vous-même/)).toBeVisible()
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
      // The sentence and the re-read are one update, but the read is an effect that runs after
      // the commit that shows the sentence, so the second read is waited for.
      await waitFor(() => expect(getEvent.mock.calls.length).toBeGreaterThan(1))
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

    it('says a refresh that failed as a status, and keeps the form it already had', async () => {
      // The page keeps the answer it had rather than blanking, and says so instead of
      // pretending it is current. It is polite: the host is reading, not waiting on it.
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(fakeApi({ getEvent }))
      await screen.findByRole('heading', { name: fr.admin.schedule })
      getEvent.mockRejectedValueOnce(ApiError.network())

      fireEvent(window, new Event('focus'))

      const note = await screen.findByText(fr.errors.network)
      expect(note.closest('[role="status"]')).not.toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('heading', { name: fr.admin.schedule })).toBeVisible()
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

    it('says it politely, as a status the host reads in turn rather than an alert that interrupts', async () => {
      // Nothing has failed that the host must act on now: the fields below are empty
      // because of the sweep, and saving anything clears the note.
      renderPage(
        fakeApi({
          getEvent: vi.fn(async () =>
            anEventDto({ scheduleDiscardedAt: '2026-06-21T02:00:00.000Z' }),
          ),
        }),
      )

      const note = await screen.findByText(/n’a pas pu s’appliquer/)

      expect(note.closest('[role="status"]')).not.toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('says nothing of the sort when no schedule was ever thrown away', async () => {
      renderPage(fakeApi())

      await screen.findByRole('heading', { name: fr.admin.schedule })
      expect(screen.queryByText(/n’a pas pu s’appliquer/)).toBeNull()
    })
  })

  /**
   * The language the projector speaks (roadmap 1.5).
   *
   * This is the only place a host can change it after creation, and the only surface in
   * the product whose language somebody chooses on behalf of other people.
   */
  describe('the wall language', () => {
    it('shows what the event is set to', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ settings: eventSettings({ wallLanguage: 'it' }) }),
        ),
      })

      renderPage(api)

      expect(await screen.findByLabelText(fr.admin.wallLanguage)).toHaveValue('it')
    })

    it('names each language in itself, never translated into the host’s', async () => {
      // Endonyms, like the guest's own picker and for the same reason one step removed:
      // the host is choosing a word the *room* will read, so "Deutsch" is the word that
      // tells them what they are choosing. A French host picking "Allemand" would be
      // reading a label about a language nobody in that room will see.
      renderPage(fakeApi())

      const picker = await screen.findByLabelText(fr.admin.wallLanguage)
      expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
        'Français',
        'Deutsch',
        'English',
        'Español',
        'Italiano',
      ])
    })

    it('saves the language the host chose', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.selectOptions(await screen.findByLabelText(fr.admin.wallLanguage), 'de')
      await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

      expect(api.updateSettings).toHaveBeenCalledWith(
        'camille-et-sacha',
        expect.objectContaining({ wallLanguage: 'de' }),
      )
    })

    it('says what it does not do, because a host will assume it translates their prompts', async () => {
      // The hint is the whole reason this field is called "the language of the screen in
      // the room" rather than "the language of the evening". A host who reads the second
      // wording expects their consignes to come out in it, and they never will.
      renderPage(fakeApi())

      expect(await screen.findByText(fr.admin.wallLanguageHint)).toBeVisible()
    })
  })

  describe('the host’s own photograph of the venue (ADR 0010, decision 8)', () => {
    const URL_PATH = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`
    const guinguette = (groundUrl: string | null, role: EventDto['role'] = 'owner'): EventDto =>
      anEventDto({
        role,
        settings: eventSettings({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'eventslide',
            groundUrl,
          },
        }),
      })

    it('is offered under an ambiance whose ground is a photograph', async () => {
      renderPage(fakeApi({ getEvent: vi.fn(async () => guinguette(null)) }))

      expect(await screen.findByText(fr.admin.venuePhoto)).toBeVisible()
      expect(screen.getByTestId('venue-photo-input')).toBeEnabled()
    })

    it('shows the photograph that is stored', async () => {
      renderPage(fakeApi({ getEvent: vi.fn(async () => guinguette(URL_PATH)) }))

      expect(
        await screen.findByRole('img', { name: fr.admin.venuePhotoPreviewAlt }),
      ).toHaveAttribute('src', URL_PATH)
    })

    it('shows the new photograph as soon as the upload is answered, with no second read', async () => {
      const putVenuePhoto = vi.fn(async () => guinguette(URL_PATH))
      const getEvent = vi.fn(async () => guinguette(null))
      renderPage(fakeApi({ getEvent, putVenuePhoto }))
      await screen.findByText(fr.admin.venuePhoto)
      const reads = getEvent.mock.calls.length

      await userEvent.upload(
        screen.getByTestId('venue-photo-input'),
        new File(['x'], 'lieu.jpg', { type: 'image/jpeg' }),
      )

      expect(
        await screen.findByRole('img', { name: fr.admin.venuePhotoPreviewAlt }),
      ).toHaveAttribute('src', URL_PATH)
      expect(getEvent.mock.calls.length).toBe(reads)
    })

    it('does not throw away what the host typed in the form when a photograph arrives', async () => {
      const getEvent = vi.fn(async () => guinguette(null))
      renderPage(fakeApi({ getEvent, putVenuePhoto: vi.fn(async () => guinguette(URL_PATH)) }))
      await userEvent.selectOptions(await screen.findByLabelText(fr.admin.maxPhotosPerGuest), '25')

      await userEvent.upload(
        screen.getByTestId('venue-photo-input'),
        new File(['x'], 'lieu.jpg', { type: 'image/jpeg' }),
      )
      await screen.findByRole('img', { name: fr.admin.venuePhotoPreviewAlt })

      expect(screen.getByLabelText(fr.admin.maxPhotosPerGuest)).toHaveValue('25')
    })

    it('never sends the photograph’s URL with the settings, which the server would refuse', async () => {
      const api = fakeApi({ getEvent: vi.fn(async () => guinguette(URL_PATH)) })

      renderPage(api)
      await screen.findByText(fr.admin.venuePhoto)
      await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.theme).toEqual({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
      })
    })

    it('is closed to a moderator, who may read but not change', async () => {
      renderPage(fakeApi({ getEvent: vi.fn(async () => guinguette(URL_PATH, 'moderator')) }))

      await screen.findByText(fr.admin.venuePhoto)
      expect(screen.getByTestId('venue-photo-input')).toBeDisabled()
    })
  })

  it('offers the editor of the host’s own ambiance, worded by whether one exists, and not to a moderator', async () => {
    const custom = {
      ...DEFAULT_EVENT_THEME,
      ambiance: 'custom' as const,
      custom: { ground: 'dark' as const, groundHue: 200, faces: 'riviera' as const },
    }
    const first = renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto()) }))
    const create = await screen.findByRole('link', { name: fr.admin.customAmbianceCreate })
    expect(create).toHaveAttribute('href', '/admin/events/camille-et-sacha/settings/ambiance')
    first.unmount()

    const second = renderPage(
      fakeApi({
        getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ theme: custom }) })),
      }),
    )
    expect(await screen.findByRole('link', { name: fr.admin.customAmbianceEdit })).toBeVisible()
    second.unmount()

    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) }))
    await screen.findByRole('heading', { name: fr.admin.settings })
    expect(screen.queryByRole('link', { name: fr.admin.customAmbianceCreate })).toBeNull()
  })
})
