import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventSettingsPage } from './EventSettingsPage'
import PAGE_CSS from './EventSettingsPage.module.css?raw'
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

/** The body of the first rule that opens with this selector, so a test reads what the stylesheet says. */
const ruleOf = (selector: string): string => {
  const start = PAGE_CSS.indexOf(`${selector} {`)
  return start < 0 ? '' : PAGE_CSS.slice(start, PAGE_CSS.indexOf('}', start))
}

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

/** The section the page opens on in a block, as a link to `#wall` would; `undefined` is the first. */
let openOn: string | undefined

/** Every test of the block opens the page on `section`, the way the address `…/settings#section` does. */
const opensOn = (section: string) => {
  beforeEach(() => {
    openOn = section
  })
  afterEach(() => {
    openOn = undefined
  })
}

const renderPage = (api: Api, section: string | undefined = openOn) =>
  renderWithProviders(<EventSettingsPage />, {
    api,
    route: `/admin/events/camille-et-sacha/settings${section === undefined ? '' : `#${section}`}`,
    path: '/admin/events/:slug/settings',
  })

/**
 * The page has no Save button: a change is sent after a short stillness. Waits for that first
 * `PATCH` and answers what it named.
 */
const firstSave = async (api: Api) => {
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalled())
  return vi.mocked(api.updateSettings).mock.calls[0]?.[1]
}

/** An API whose settings saves never answer: what the host chose stays pending on screen. */
const neverAnswers = (overrides: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({ ...overrides, updateSettings: vi.fn(() => new Promise<EventDto>(() => {})) })

const toggle = (name: string) => screen.getByRole('button', { name })

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

  describe('the line about the look, which moved to its own page', () => {
    const LOGO = `/api/events/camille-et-sacha/logo/${'cd'.repeat(32)}`
    const wearing = (overrides: Partial<EventDto> = {}) =>
      fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({
            settings: eventSettings({
              theme: { ...DEFAULT_EVENT_THEME, ambiance: 'champs', accentHue: 345 },
              brand: { welcomeMessage: null, logoUrl: LOGO },
            }),
            ...overrides,
          }),
        ),
      })

    it('says what the event wears and leads to the appearance page', async () => {
      renderPage(wearing())

      const title = await screen.findByRole('heading', { name: fr.admin.appearance.title })
      const row = title.closest('section')
      expect(row).not.toBeNull()
      expect(
        within(row as HTMLElement).getByText(
          [
            fr.admin.themeAmbianceNames.champs,
            fr.admin.themeAccentNames.rose,
            fr.admin.appearance.rowWithLogo,
          ].join(' · '),
        ),
      ).toBeVisible()
      expect(
        within(row as HTMLElement).getByRole('link', { name: fr.admin.appearance.rowEditLabel }),
      ).toHaveAttribute('href', '/admin/events/camille-et-sacha/appearance')
    })

    it('says there is no logo, and names no colour for the ambiance’s own', async () => {
      renderPage(fakeApi())

      expect(
        await screen.findByText(
          [fr.admin.themeAmbianceNames.eventslide, fr.admin.appearance.rowWithoutLogo].join(' · '),
        ),
      ).toBeVisible()
    })

    it('keeps the old #look anchor on the row, so an old link lands on it', async () => {
      renderPage(wearing(), 'look')

      const title = await screen.findByRole('heading', { name: fr.admin.appearance.title })
      expect(title.closest('section')).toHaveAttribute('id', 'look')
    })

    it('no longer holds any control of the look, which the appearance page has', async () => {
      renderPage(wearing())
      await screen.findByRole('heading', { name: fr.admin.appearance.title })

      expect(screen.queryByRole('radio', { name: fr.admin.themeAccentNames.rose })).toBeNull()
      expect(screen.queryByLabelText(fr.admin.themeFrame)).toBeNull()
      expect(screen.queryByTestId('logo-input')).toBeNull()
      expect(screen.queryByTestId('venue-photo-input')).toBeNull()
      expect(
        screen.queryByRole('textbox', { name: new RegExp(fr.admin.welcomeMessage) }),
      ).toBeNull()
    })

    it('stays a link for a moderator, who may read the appearance page', async () => {
      renderPage(wearing({ role: 'moderator' }))

      expect(
        await screen.findByRole('link', { name: fr.admin.appearance.rowEditLabel }),
      ).toBeVisible()
    })
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
      // Every control of the page, the schedule's included, and not a sample of them: each is a save
      // the server refuses a moderator. The section toggles only open and close, and stay usable.
      const controls = [
        ...document.querySelectorAll('input, select, textarea, button:not([aria-expanded])'),
      ]
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

  it('offers the two moderation modes as cards that each say what happens in the room', async () => {
    renderPage(fakeApi())

    const manual = await screen.findByRole('radio', { name: fr.admin.moderationManual })
    const auto = screen.getByRole('radio', { name: fr.admin.moderationAuto })
    // The sentence describes the radio without joining its name, and both stay one radio group.
    expect(manual).toHaveAccessibleDescription(fr.admin.moderationManualEffect)
    expect(auto).toHaveAccessibleDescription(fr.admin.moderationAutoEffect)
    expect(manual).toHaveAttribute('name', 'moderation')
    expect(auto).toHaveAttribute('name', 'moderation')
  })

  it('moves between the moderation cards with the arrow keys, and still asks before « automatique »', async () => {
    renderPage(fakeApi())

    const manual = await screen.findByRole('radio', { name: fr.admin.moderationManual })
    manual.focus()
    await userEvent.keyboard('{ArrowDown}')

    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(manual).toBeChecked()
  })

  it('is as wide as the settings token says, and caps its hint lines', () => {
    expect(ruleOf('.page')).toContain('max-inline-size: var(--container-settings)')
    // The chosen card is told apart by its frame, not by the radio alone.
    expect(ruleOf('.card:has(input:checked)')).toContain('border-color: var(--accent)')
    expect(ruleOf('.sections p')).toContain('max-inline-size: var(--measure-prose)')
    expect(PAGE_CSS).toContain('max-inline-size: var(--control-max)')
    // A read-only card is dimmed and shows no pointer, as the ambiance cards do.
    expect(ruleOf('.card:has(input:disabled)')).toContain('opacity: 0.6')
    expect(ruleOf('.radio:disabled')).toContain('cursor: default')
  })

  it('asks before publishing without validation, and saves nothing until the host confirms', async () => {
    const api = fakeApi()
    renderPage(api)

    expect(await screen.findByLabelText(fr.admin.moderationAuto)).not.toBeChecked()
    await userEvent.click(screen.getByLabelText(fr.admin.moderationAuto))

    // The one setting that can put something unwanted on a screen in front of two hundred people,
    // and the page saves what it is given: the host reads why before it is saved, not after.
    const dialog = await screen.findByRole('dialog', {
      name: fr.admin.settingsPage.confirmAutoTitle,
    })
    expect(within(dialog).getByText(fr.admin.moderationAutoWarning)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.moderationManual)).toBeChecked()
    expect(api.updateSettings).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.moderationAuto }))

    // Shown at once, while the request is on its way.
    expect(screen.getByLabelText(fr.admin.moderationAuto)).toBeChecked()
    expect(await firstSave(api)).toEqual({ moderation: 'auto' })
  })

  it('keeps validating each photo when the host cancels the question', async () => {
    const api = fakeApi()
    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText(fr.admin.moderationManual)).toBeChecked()
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('lets the live region it sits in announce the warning, with no role of its own', async () => {
    renderPage(fakeApi())
    await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: fr.admin.moderationAuto,
      }),
    )

    const warning = await screen.findByText(fr.admin.moderationAutoWarning)

    // One announcement, by the region the page mounted once: a role on the warning as
    // well would say it twice.
    expect(warning.closest('[aria-live="polite"]')).not.toBeNull()
    expect(warning.closest('[role="alert"], [role="status"]')).toBeNull()
  })

  it('takes the warning away again when the host goes back to validating each photo', async () => {
    renderPage(fakeApi())

    await userEvent.click(await screen.findByLabelText(fr.admin.moderationAuto))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: fr.admin.moderationAuto,
      }),
    )
    await userEvent.click(screen.getByLabelText(fr.admin.moderationManual))

    expect(screen.queryByText(fr.admin.moderationAutoWarning)).toBeNull()
  })

  it('saves what the host changed, with no button, and says it is saved', async () => {
    const api = fakeApi()

    renderPage(api)
    expect(await screen.findByText(fr.admin.settingsPage.autosave)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.app.save })).toBeNull()
    await userEvent.click(screen.getByLabelText(fr.admin.allowCaptions))

    // Only the field the host moved: a choice made on the wall's panel since the page loaded must
    // not be written back over by one this page never touched.
    expect(await firstSave(api)).toEqual({ allowCaptions: false })
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { allowCaptions: false })
    expect(await screen.findByText(fr.admin.settingsPage.saved)).toBeVisible()
  })

  it('sends two quick choices as one request', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))
    await userEvent.click(screen.getByLabelText(fr.admin.allowReactions))

    expect(await firstSave(api)).toEqual({ allowCaptions: false, allowReactions: false })
    expect(api.updateSettings).toHaveBeenCalledTimes(1)
  })

  it('says it is saving while the request is on its way', async () => {
    renderPage(neverAnswers())

    await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))

    expect(await screen.findByText(fr.admin.settingsPage.saving)).toBeVisible()
  })

  it('sends null for a limit the host turned off, not zero', async () => {
    // `null` is "no limit" in the DTO; `0` would be a different, invalid intent.
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ retentionDays: 30 }) })),
    })

    renderPage(api, 'schedule')
    await userEvent.selectOptions(
      await screen.findByLabelText(fr.admin.retention),
      fr.admin.retentionNever,
    )
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ retentionDays: null }),
    )
  })

  it('keeps a stored value this form does not offer, instead of rewriting it', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ retentionDays: 14 }) })),
    })

    renderPage(api, 'schedule')

    expect(await screen.findByLabelText(fr.admin.retention)).toHaveValue('14')
    expect(screen.getByRole('option', { name: fr.admin.retentionDays(14) })).toBeInTheDocument()
  })

  it('surfaces the server’s refusal of a change, and puts the control back', async () => {
    const api = fakeApi({
      updateSettings: vi.fn(() =>
        Promise.reject(new ApiError(400, 'eventSettings.retentionDaysInvalid')),
      ),
    })

    renderPage(api)
    const captions = await screen.findByLabelText(fr.admin.allowCaptions)
    await userEvent.click(captions)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.admin.settingsPage.saveFailed)
    expect(alert).toHaveTextContent(fr.errors['eventSettings.retentionDaysInvalid'])
    // Back to what the server holds: the screen never shows a choice that was not kept.
    expect(captions).toBeChecked()
  })

  it('freezes the form for an archived event and says why', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) })

    renderPage(api)

    expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.moderationAuto)).toBeDisabled()
    expect(screen.getByLabelText(fr.admin.allowCaptions)).toBeDisabled()
    // Nothing is saved on a page that cannot be changed, so nothing says it would be.
    expect(screen.queryByText(fr.admin.settingsPage.autosave)).toBeNull()
  })

  it('shows the grace delay only while guests may delete their own photos', async () => {
    const api = neverAnswers({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowGuestSelfDelete: false }) }),
      ),
    })

    renderPage(api)
    const box = await screen.findByLabelText(fr.admin.allowGuestSelfDelete)
    expect(screen.queryByLabelText(fr.admin.selfDeleteGrace)).toBeNull()

    await userEvent.click(box)

    expect(screen.getByLabelText(fr.admin.selfDeleteGrace)).toBeVisible()
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
    await firstSave(api)

    expect(await screen.findByText(fr.admin.settingsPage.saved)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.retention)).toHaveValue('365')
    expect(screen.getByLabelText(fr.admin.allowCaptions)).not.toBeChecked()
  })

  it('offers the switch over saving from the feed, with what it can and cannot do', async () => {
    renderPage(fakeApi())

    const box = await screen.findByLabelText(fr.admin.allowGuestSave)

    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(fr.admin.allowGuestSaveHint)
  })

  it('reads an event that predates the feature as unticked, and saves the host’s tick', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowGuestSave: false }) }),
      ),
    })

    renderPage(api)
    const box = await screen.findByLabelText(fr.admin.allowGuestSave)
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowGuestSave: true }),
    )
  })

  it('saves the host’s choice about reactions', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.admin.allowReactions))
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { allowReactions: false })
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
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowClips: true }),
    )
  })

  it('saves the guestbook switches, and shows the wall one only while the book is open', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowGuestbook: false, guestbookOnWall: true }) }),
      ),
    })

    renderPage(api, 'guestbook')
    const open = await screen.findByLabelText(fr.admin.allowGuestbook)
    expect(screen.queryByLabelText(fr.admin.guestbookOnWall)).toBeNull()

    await userEvent.click(open)
    await userEvent.click(screen.getByLabelText(fr.admin.guestbookOnWall))
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ allowGuestbook: true, guestbookOnWall: false }),
    )
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
    await firstSave(api)

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
    await firstSave(api)

    expect(api.updateSettings).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ guestSelfDeleteGraceSeconds: 900 }),
    )
  })

  it('saves a per-guest photo limit as a number', async () => {
    const api = fakeApi()

    renderPage(api, 'reveal')
    await userEvent.selectOptions(await screen.findByLabelText(fr.reveal.shots), '25')
    await firstSave(api)

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

    expect(await screen.findByLabelText(fr.reveal.shots)).toHaveValue('50')
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
    opensOn('schedule')
    const OPENS_AT = '2026-06-20T16:00:00.000Z'
    const CLOSES_AT = '2026-06-21T00:00:00.000Z'

    const openField = () => screen.getByLabelText(new RegExp(fr.admin.scheduleOpenAt))
    const closeField = () => screen.getByLabelText(new RegExp(fr.admin.scheduleCloseAt))
    /** Types a whole value and leaves the field, which is when the schedule is saved. */
    const enter = (field: HTMLElement, value: string) => {
      fireEvent.change(field, { target: { value } })
      fireEvent.blur(field)
    }

    it('shows the schedule the server holds, on the clock the host is looking at', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ scheduledOpenAt: OPENS_AT, scheduledCloseAt: CLOSES_AT }),
        ),
      })

      renderPage(api)

      expect(
        await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule }),
      ).toBeVisible()
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
      expect(await screen.findByText(/Vous terminerez la soirée vous-même/)).toBeVisible()
    })

    it('sends both instants when the host leaves a field, with no button', async () => {
      const api = fakeApi()
      renderPage(api)

      fireEvent.change(await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)), {
        target: { value: toLocalInput(OPENS_AT) },
      })
      // Typing is not saving: a half-typed date is not an instant.
      expect(api.setSchedule).not.toHaveBeenCalled()
      enter(closeField(), toLocalInput(CLOSES_AT))

      await waitFor(() =>
        expect(api.setSchedule).toHaveBeenCalledWith('camille-et-sacha', {
          scheduledOpenAt: OPENS_AT,
          scheduledCloseAt: CLOSES_AT,
        }),
      )
      expect(await screen.findByText(fr.admin.scheduleSaved)).toBeVisible()
    })

    it('keeps a closing being typed when the answer to the opening arrives', async () => {
      const setSchedule = vi.fn(async () => anEventDto({ scheduledOpenAt: OPENS_AT }))
      renderPage(fakeApi({ setSchedule }))

      enter(
        await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)),
        toLocalInput(OPENS_AT),
      )
      fireEvent.change(closeField(), { target: { value: toLocalInput(CLOSES_AT) } })

      expect(await screen.findByText(fr.admin.scheduleSaved)).toBeVisible()
      expect(openField()).toHaveValue(toLocalInput(OPENS_AT))
      expect(closeField()).toHaveValue(toLocalInput(CLOSES_AT))
    })

    it('saves nothing when the host leaves a field they did not change', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () => anEventDto({ scheduledOpenAt: OPENS_AT })),
      })
      renderPage(api)

      fireEvent.blur(await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)))

      expect(api.setSchedule).not.toHaveBeenCalled()
    })

    it('sends null for a field the host emptied, which turns that half off', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({ scheduledOpenAt: OPENS_AT, scheduledCloseAt: CLOSES_AT }),
        ),
      })
      renderPage(api)

      enter(await screen.findByLabelText(new RegExp(fr.admin.scheduleCloseAt)), '')

      await waitFor(() =>
        expect(api.setSchedule).toHaveBeenCalledWith('camille-et-sacha', {
          scheduledOpenAt: OPENS_AT,
          scheduledCloseAt: null,
        }),
      )
    })

    it('does not touch the settings form when the schedule is saved', async () => {
      const api = fakeApi()
      renderPage(api)

      enter(
        await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)),
        toLocalInput(OPENS_AT),
      )

      await waitFor(() => expect(api.setSchedule).toHaveBeenCalled())
      expect(api.updateSettings).not.toHaveBeenCalled()
    })

    it('shows the refusal when the closing comes before the opening', async () => {
      const api = fakeApi({
        setSchedule: vi.fn(async () => {
          throw new ApiError(400, 'event.scheduleOutOfOrder')
        }),
      })
      renderPage(api)

      enter(
        await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)),
        toLocalInput(OPENS_AT),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['event.scheduleOutOfOrder'],
      )
    })

    it('cannot be armed on an archived event, which is read-only', async () => {
      const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) })

      renderPage(api)

      expect(await screen.findByText(fr.admin.settingsReadOnly)).toBeVisible()
      expect(openField()).toBeDisabled()
      expect(closeField()).toBeDisabled()
    })

    it('offers no minute earlier than now in the picker', async () => {
      renderPage(fakeApi())

      // A guide rather than the guard — the form is noValidate and the server refuses a
      // past instant — but it is what keeps the commonest mistake off the first click.
      await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule })
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
      enter(
        await screen.findByLabelText(new RegExp(fr.admin.scheduleOpenAt)),
        toLocalInput(OPENS_AT),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.scheduleInPast'])
      // The sentence and the re-read are one update, but the read is an effect that runs after
      // the commit that shows the sentence, so the second read is waited for.
      await waitFor(() => expect(getEvent.mock.calls.length).toBeGreaterThan(1))
    })

    it('re-reads the event when the host comes back to the tab', async () => {
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(fakeApi({ getEvent }))
      await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule })
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
      await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule })
      getEvent.mockImplementationOnce(pending.promise)

      fireEvent(window, new Event('focus'))

      expect(screen.getByRole('heading', { name: fr.admin.settingsPage.schedule })).toBeVisible()
      expect(screen.queryByText(fr.admin.eventLoading)).toBeNull()
      await waitFor(() => expect(pending.settle(anEventDto())).toBe(true))
    })

    it('says a refresh that failed as a status, and keeps the form it already had', async () => {
      // The page keeps the answer it had rather than blanking, and says so instead of
      // pretending it is current. It is polite: the host is reading, not waiting on it.
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(fakeApi({ getEvent }))
      await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule })
      getEvent.mockRejectedValueOnce(ApiError.network())

      fireEvent(window, new Event('focus'))

      const note = await screen.findByText(fr.errors.network)
      expect(note.closest('[role="status"]')).not.toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('heading', { name: fr.admin.settingsPage.schedule })).toBeVisible()
    })

    it('keeps a choice still on its way when a background refresh changes nothing', async () => {
      // The revalidation above must not be a way to lose an edit in progress: a choice the server
      // has not answered yet stays laid over whatever a refresh brings.
      const getEvent = vi.fn(async () => anEventDto())
      renderPage(neverAnswers({ getEvent }), 'guests')
      await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))
      const reads = getEvent.mock.calls.length

      fireEvent(window, new Event('focus'))

      await waitFor(() => expect(getEvent.mock.calls.length).toBeGreaterThan(reads))
      expect(screen.getByLabelText(fr.admin.allowCaptions)).not.toBeChecked()
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

      await screen.findByRole('heading', { name: fr.admin.settingsPage.schedule })
      expect(screen.queryByText(/n’a pas pu s’appliquer/)).toBeNull()
    })
  })

  describe('the wall sound block (spec 12)', () => {
    opensOn('wall')
    it('shows the sound off, the chime and 50 for an event that never chose', async () => {
      renderPage(fakeApi())

      expect(await screen.findByLabelText(fr.admin.wallSound.enable)).not.toBeChecked()
      expect(screen.getByRole('radio', { name: fr.admin.wallSound.toneNames.chime })).toBeChecked()
      expect(screen.getByLabelText(fr.admin.wallSound.volume)).toHaveValue('50')
    })

    it('sends only the sound keys it changed', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.admin.wallSound.enable))
      await userEvent.click(screen.getByRole('radio', { name: fr.admin.wallSound.toneNames.drop }))
      fireEvent.change(screen.getByLabelText(fr.admin.wallSound.volume), {
        target: { value: '30' },
      })
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.wall).toEqual({ soundEnabled: true, soundTone: 'drop', soundVolume: 30 })
    })

    it('plays the chosen tone on this computer when the host presses Test, after a click', async () => {
      let starts = 0
      class FakeContext {
        state = 'suspended'
        currentTime = 0
        destination = {}
        resume() {
          this.state = 'running'
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
        decodeAudioData() {
          return Promise.resolve({})
        }
        createGain() {
          return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }
        }
        createBufferSource() {
          return {
            connect() {},
            start() {
              starts += 1
            },
          }
        }
      }
      vi.stubGlobal('AudioContext', FakeContext)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(new ArrayBuffer(4))),
      )
      try {
        renderPage(fakeApi())
        const test = await screen.findByRole('button', { name: fr.admin.wallSound.test })
        expect(starts).toBe(0)

        await userEvent.click(test)

        await waitFor(() => expect(starts).toBe(1))
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('the wall display block (spec 13)', () => {
    opensOn('wall')
    it('shows what the event is set to, and the default when nothing is chosen', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({
            settings: eventSettings({
              wall: {
                layout: 'polaroid',
                slideIntervalMs: 12_000,
                freshLane: true,
                tilt: true,
                showTime: false,
              },
            }),
          }),
        ),
      })

      renderPage(api)

      expect(await screen.findByLabelText(fr.admin.wallDisplay.layout)).toHaveValue('polaroid')
      expect(screen.getByLabelText(fr.admin.wallDisplay.interval)).toHaveValue('12000')
    })

    it('shows a rhythm outside the steps as it is, instead of rewriting it', async () => {
      renderPage(
        fakeApi({
          getEvent: vi.fn(async () =>
            anEventDto({
              settings: eventSettings({
                wall: {
                  layout: null,
                  slideIntervalMs: 45_000,
                  freshLane: true,
                  tilt: true,
                  showTime: false,
                },
              }),
            }),
          ),
        }),
      )

      expect(await screen.findByLabelText(fr.admin.wallDisplay.interval)).toHaveValue('45000')
    })

    it('sends only the wall keys it changed, so the wall panel’s own choices are not erased', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.selectOptions(
        await screen.findByLabelText(fr.admin.wallDisplay.layout),
        'mosaic',
      )
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.wall).toEqual({ layout: 'mosaic' })
    })

    it('sends no wall group at all when the host changed none of it', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.selectOptions(await screen.findByLabelText(fr.admin.wallLanguage), 'de')
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent).not.toHaveProperty('wall')
    })

    it('keeps the mixed wall off and its durations hidden until the box is ticked (spec 09)', async () => {
      renderPage(fakeApi())

      const box = await screen.findByLabelText(fr.admin.wallDisplay.mixed)
      expect(box).not.toBeChecked()
      expect(screen.queryByLabelText(fr.admin.wallDisplay.mixedWall)).toBeNull()
      expect(screen.queryByLabelText(fr.admin.wallDisplay.mixedSlideshow)).toBeNull()

      await userEvent.click(box)

      expect(screen.getByLabelText(fr.admin.wallDisplay.mixedWall)).toHaveValue('180')
      expect(screen.getByLabelText(fr.admin.wallDisplay.mixedSlideshow)).toHaveValue('60')
    })

    it('sends only the mixed keys that changed (spec 09)', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.admin.wallDisplay.mixed))
      await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallDisplay.mixedWall), '300')
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.wall).toEqual({ mixedEnabled: true, mixedWallSeconds: 300 })
    })

    it('shows a stored duration outside the steps as it is (spec 09)', async () => {
      renderPage(
        fakeApi({
          getEvent: vi.fn(async () =>
            anEventDto({
              settings: eventSettings({
                wall: {
                  layout: null,
                  slideIntervalMs: null,
                  mixedEnabled: true,
                  mixedWallSeconds: 95,
                  mixedSlideshowSeconds: 45,
                },
              }),
            }),
          ),
        }),
      )

      expect(await screen.findByLabelText(fr.admin.wallDisplay.mixedWall)).toHaveValue('95')
      expect(screen.getByLabelText(fr.admin.wallDisplay.mixedSlideshow)).toHaveValue('45')
    })

    it('sends only the switch the host flipped', async () => {
      const api = fakeApi()

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.admin.wallDisplay.tilt))
      await firstSave(api)

      expect(vi.mocked(api.updateSettings).mock.calls[0]?.[1]?.wall).toEqual({ tilt: false })
    })

    it('shows both « À l’écran » switches off, and sends only the one that was turned on', async () => {
      const api = fakeApi()

      renderPage(api)
      const counter = await screen.findByLabelText(fr.admin.wallDisplay.souvenirCounter)
      expect(counter).not.toBeChecked()
      expect(screen.getByLabelText(fr.admin.wallDisplay.newPhotoSignal)).not.toBeChecked()
      await userEvent.click(counter)
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.wall).toEqual({ souvenirCounter: true })
    })

    it('goes back to nothing chosen, and to the default rhythm', async () => {
      const api = fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({
            settings: eventSettings({
              wall: {
                layout: 'polaroid',
                slideIntervalMs: 12_000,
                freshLane: true,
                tilt: true,
                showTime: false,
              },
            }),
          }),
        ),
      })

      renderPage(api)
      await userEvent.selectOptions(await screen.findByLabelText(fr.admin.wallDisplay.layout), '')
      await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallDisplay.interval), '')
      await firstSave(api)

      const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
      expect(sent?.wall).toEqual({ layout: null, slideIntervalMs: null })
    })
  })

  /**
   * The language the projector speaks (roadmap 1.5).
   *
   * This is the only place a host can change it after creation, and the only surface in
   * the product whose language somebody chooses on behalf of other people.
   */
  describe('the wall language', () => {
    opensOn('wall')
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
      await firstSave(api)

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
})

describe('the sections of the page', () => {
  it('opens on the guests, one section at a time', async () => {
    renderPage(fakeApi())

    expect(
      await screen.findByRole('button', { name: fr.admin.settingsPage.guests }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(toggle(fr.admin.settingsPage.wall)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText(fr.admin.allowCaptions)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.wallDisplay.layout)).not.toBeVisible()

    await userEvent.click(toggle(fr.admin.settingsPage.wall))

    expect(toggle(fr.admin.settingsPage.wall)).toHaveAttribute('aria-expanded', 'true')
    expect(toggle(fr.admin.settingsPage.guests)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText(fr.admin.wallDisplay.layout)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.allowCaptions)).not.toBeVisible()
  })

  it('closes the open section when its heading is pressed again', async () => {
    renderPage(fakeApi())

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.settingsPage.guests }))

    expect(toggle(fr.admin.settingsPage.guests)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText(fr.admin.allowCaptions)).not.toBeVisible()
  })

  it('opens the section the address names', async () => {
    renderPage(fakeApi(), 'schedule')

    expect(
      await screen.findByRole('button', { name: fr.admin.settingsPage.schedule }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(toggle(fr.admin.settingsPage.guests)).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on the guests when the address names no section it knows', async () => {
    renderPage(fakeApi(), 'nowhere')

    expect(
      await screen.findByRole('button', { name: fr.admin.settingsPage.guests }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('says what each closed section holds, as the description of its heading', async () => {
    renderPage(
      fakeApi({
        getEvent: vi.fn(async () =>
          anEventDto({
            settings: eventSettings({ allowGuestbook: false, retentionDays: null }),
          }),
        ),
      }),
    )

    expect(
      await screen.findByRole('button', { name: fr.admin.settingsPage.guestbook }),
    ).toHaveAccessibleDescription(fr.admin.settingsPage.closed)
    expect(toggle(fr.reveal.title)).toHaveAccessibleDescription(fr.admin.settingsPage.off)
    expect(toggle(fr.admin.settingsPage.schedule)).toHaveAccessibleDescription(
      [
        fr.admin.settingsPage.opensByHand,
        fr.admin.settingsPage.closesByHand,
        fr.admin.settingsPage.keptForever,
      ].join(' · '),
    )
  })

  it('updates a summary as soon as the host makes a choice', async () => {
    renderPage(neverAnswers(), 'guestbook')

    await userEvent.click(await screen.findByLabelText(fr.admin.allowGuestbook))

    expect(toggle(fr.admin.settingsPage.guestbook)).toHaveAccessibleDescription(
      fr.admin.settingsPage.closed,
    )
  })

  it('names the moderation, the videos and saving from the feed for the guests', async () => {
    renderPage(fakeApi())

    expect(
      await screen.findByRole('button', { name: fr.admin.settingsPage.guests }),
    ).toHaveAccessibleDescription(
      [
        fr.admin.settingsPage.manual,
        fr.admin.settingsPage.clipsOn,
        fr.admin.settingsPage.guestSaveOn,
      ].join(' · '),
    )
  })
})

describe('the invitation card block (spec 14)', () => {
  opensOn('wall')
  it('shows the defaults, warns about the switch, and sends only what changed', async () => {
    const api = fakeApi()

    renderPage(api)
    expect(await screen.findByLabelText(fr.admin.wallDisplay.qrVisible)).toBeChecked()
    expect(screen.getByText(fr.admin.wallDisplay.qrVisibleHint)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.wallDisplay.qrCorners['bottom-end'])).toBeChecked()

    fireEvent.change(screen.getByLabelText(new RegExp(fr.admin.wallDisplay.qrSize)), {
      target: { value: '1.4' },
    })
    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.qrCorners['top-end']))
    await firstSave(api)

    expect(vi.mocked(api.updateSettings).mock.calls[0]?.[1]?.wall).toEqual({
      qrScale: 1.4,
      qrPlacement: 'top-end',
    })
  })

  it('greys the size and the corner while the card is off', async () => {
    renderPage(fakeApi())

    await userEvent.click(await screen.findByLabelText(fr.admin.wallDisplay.qrVisible))

    expect(screen.getByRole('button', { name: fr.admin.wallDisplay.qrSizeSmall })).toBeDisabled()
    expect(screen.getByLabelText(fr.admin.wallDisplay.qrCorners['top-start'])).toBeDisabled()
  })
})

describe('the disposable camera section (spec 23)', () => {
  const HOUR = '2026-06-20T21:00:00.000Z'
  const withReveal = (reveal: { enabled: boolean; at: string | null; film: boolean }) =>
    fakeApi({
      getEvent: vi.fn(async () => anEventDto({ settings: eventSettings({ reveal }) })),
    })
  const sentReveal = async (api: Api) => (await firstSave(api))?.reveal
  opensOn('reveal')

  /** The section's own element, found by its anchor: the address `#reveal` opens it. */
  const revealSection = async () => {
    await screen.findByRole('button', { name: fr.reveal.title, expanded: true })
    const section = document.getElementById('reveal')
    if (section === null) throw new Error('no #reveal section')
    return within(section)
  }

  it('is one section with its switch, its hour, its cap and its film look', async () => {
    renderPage(neverAnswers())

    const section = await revealSection()

    expect(section.getByLabelText(fr.reveal.enabled)).not.toBeChecked()
    expect(section.getByLabelText(fr.reveal.shots)).toBeInTheDocument()
    expect(section.getByText(fr.reveal.hint)).toBeVisible()

    await userEvent.click(section.getByLabelText(fr.reveal.enabled))

    expect(section.getByLabelText(fr.reveal.timed)).toBeInTheDocument()
    expect(section.getByLabelText(fr.reveal.film)).toBeInTheDocument()
  })

  it('holds the cap on photographs per guest once: moved, not copied', async () => {
    renderPage(fakeApi())

    await revealSection()

    expect(screen.getAllByLabelText(fr.reveal.shots)).toHaveLength(1)
    expect(screen.queryByLabelText(fr.admin.maxPhotosPerGuest)).toBeNull()
  })

  it('keeps the cap usable with the mode off, which is what a conference does', async () => {
    renderPage(fakeApi())

    expect(await screen.findByLabelText(fr.reveal.shots)).toBeEnabled()
  })

  it('offers the twenty-seven poses of a roll', async () => {
    renderPage(fakeApi())

    expect(await screen.findByRole('option', { name: fr.admin.photos(27) })).toBeInTheDocument()
  })

  it('shows the hour and the film look only once the mode is on', async () => {
    renderPage(neverAnswers())

    const enabled = await screen.findByLabelText(fr.reveal.enabled)
    expect(screen.queryByLabelText(fr.reveal.timed)).toBeNull()
    expect(screen.queryByLabelText(fr.reveal.film)).toBeNull()

    await userEvent.click(enabled)

    expect(screen.getByLabelText(fr.reveal.timed)).toBeEnabled()
    expect(screen.getByLabelText(fr.reveal.film)).toBeEnabled()
  })

  it('reveals at the button when no hour is chosen: the switch shows no hour field', async () => {
    renderPage(withReveal({ enabled: true, at: null, film: true }))

    expect(await screen.findByLabelText(fr.reveal.timed)).not.toBeChecked()
    expect(screen.queryByLabelText(new RegExp(fr.reveal.at))).toBeNull()
  })

  it('asks for an hour once the host wants one, and sends it as an instant', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))
    await userEvent.click(screen.getByLabelText(fr.reveal.timed))
    const hour = screen.getByLabelText(new RegExp(fr.reveal.at))
    fireEvent.change(hour, { target: { value: toLocalInput(HOUR) } })
    // Saved when the host leaves the field: a half-typed date is not an hour.
    fireEvent.blur(hour)

    expect(await sentReveal(api)).toEqual({ enabled: true, at: HOUR })
  })

  it('sends only the keys the host changed: the film look alone leaves the hour out', async () => {
    const api = withReveal({ enabled: true, at: HOUR, film: false })

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.reveal.film))

    expect(await sentReveal(api)).toEqual({ film: true })
  })

  it('sends no reveal at all when the host touched something else', async () => {
    const api = withReveal({ enabled: true, at: HOUR, film: true })

    renderPage(api, 'guests')
    await userEvent.click(await screen.findByLabelText(fr.admin.allowCaptions))

    expect(await firstSave(api)).not.toHaveProperty('reveal')
  })

  it('clears the hour when the host goes back to the button', async () => {
    const api = withReveal({ enabled: true, at: HOUR, film: true })

    renderPage(api)
    await userEvent.click(await screen.findByLabelText(fr.reveal.timed))

    expect(await sentReveal(api)).toEqual({ at: null })
  })

  it('says the hour can no longer move once the server says the evening is revealed', async () => {
    const api = fakeApi({
      getEvent: vi.fn(async () =>
        anEventDto({
          settings: eventSettings({ reveal: { enabled: true, at: HOUR, film: true } }),
          reveal: {
            enabled: true,
            revealed: true,
            atMs: Date.parse(HOUR),
            serverNowMs: Date.parse(HOUR) + 60_000,
            film: true,
            readyCount: null,
          },
        }),
      ),
    })

    renderPage(api)

    expect(await screen.findByLabelText(new RegExp(fr.reveal.at))).toBeDisabled()
    expect(screen.getByText(fr.reveal.atLocked)).toBeVisible()
    expect(screen.getByLabelText(fr.reveal.timed)).toBeDisabled()
  })

  it('keeps the hour movable while the evening is still held', async () => {
    renderPage(withReveal({ enabled: true, at: HOUR, film: true }))

    expect(await screen.findByLabelText(new RegExp(fr.reveal.at))).toBeEnabled()
    expect(screen.queryByText(fr.reveal.atLocked)).toBeNull()
  })

  describe('the question for an evening that already shows photographs', () => {
    const live = (overrides: Partial<EventDto> = {}) =>
      fakeApi({
        getEvent: vi.fn(async () => anEventDto({ status: 'live', photoCount: 12, ...overrides })),
      })

    it('is asked before the mode hides a live evening’s photographs, and saved once confirmed', async () => {
      const api = live()

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))

      const dialog = await screen.findByRole('dialog', {
        name: fr.admin.settingsPage.confirmRevealTitle,
      })
      expect(within(dialog).getByText(fr.reveal.liveWarning)).toBeVisible()
      expect(screen.getByLabelText(fr.reveal.enabled)).not.toBeChecked()
      expect(api.updateSettings).not.toHaveBeenCalled()

      await userEvent.click(within(dialog).getByRole('button', { name: fr.reveal.enabled }))

      expect(await sentReveal(api)).toEqual({ enabled: true })
    })

    it('leaves the mode off when the host cancels', async () => {
      const api = live()

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: fr.app.cancel }),
      )

      expect(screen.getByLabelText(fr.reveal.enabled)).not.toBeChecked()
      expect(api.updateSettings).not.toHaveBeenCalled()
    })

    it('is not asked for an evening with no photograph yet', async () => {
      const api = live({ photoCount: 0 })

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await sentReveal(api)).toEqual({ enabled: true })
    })

    it('is not asked for an evening that has not opened', async () => {
      const api = live({ status: 'draft' })

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await sentReveal(api)).toEqual({ enabled: true })
    })

    it('is not asked to turn the mode off', async () => {
      const api = live({
        settings: eventSettings({ reveal: { enabled: true, at: null, film: true } }),
      })

      renderPage(api)
      await userEvent.click(await screen.findByLabelText(fr.reveal.enabled))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await sentReveal(api)).toEqual({ enabled: false })
    })
  })

  it('is read-only for a moderator, whose saves the server refuses', async () => {
    renderPage(fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) }))

    expect(await screen.findByLabelText(fr.reveal.enabled)).toBeDisabled()
    expect(screen.getByLabelText(fr.reveal.shots)).toBeDisabled()
  })
})
