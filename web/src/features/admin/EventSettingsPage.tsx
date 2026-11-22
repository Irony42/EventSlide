import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { useSharedReplace } from '../../app/eventChrome'
import { HostEventsLink } from '../../app/HostEventsLink'
import { Button } from '../../design-system/components/Button'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Notice } from '../../design-system/components/Notice'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale, type Locale } from '../../lib/i18n/locale'
import { messageForError } from '../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { CheckboxField } from '../../design-system/components/CheckboxField'
import { WallSoundFields } from '../../design-system/components/WallSoundFields'
import { DateTimeField } from '../../design-system/components/DateTimeField'
import { SelectField, type SelectOption } from '../../design-system/components/SelectField'
import { ThemeFieldset } from './components/ThemeFieldset'
import { WallQrControls } from './components/WallQrControls'
import {
  MIXED_SLIDESHOW_STEPS_SECONDS,
  MIXED_WALL_STEPS_SECONDS,
  WALL_UNSET,
  mixedDurationOptions,
  wallLayoutOptions,
  wallRhythmOptions,
} from '../../lib/wallDisplayOptions'
import { useSettingsAutosave, type SettingsSaveState } from '../../lib/useSettingsAutosave'
import { VenuePhotoField } from './components/VenuePhotoField'
import { LogoField } from './components/LogoField'
import { WelcomeMessageField } from './components/WelcomeMessageField'
import { SettingsSection } from './components/SettingsSection'
import { isMutable } from '../../lib/eventLifecycle'
import { settingsChanges } from './settingsPayload'
import { toInstant, toLocalInput } from './eventSchedule'
// Shared with the create form's template card, so the two screens cannot word the same
// window differently.
import { graceLabel } from './settingsLabels'
import { useChannels, useEvent } from './hooks/useEventData'
import { useOpenGuestbookVoice, useSaveSchedule } from './hooks/useEventActions'
import { useRevalidateWhenVisible } from './hooks/useRevalidateWhenVisible'
import styles from './EventSettingsPage.module.css'
import type { EventDto, EventSettingsDto, WallLayout } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

/** `null` in the DTO means "no limit"; the select uses the empty option for it. */
const NO_LIMIT = ''

const numberOrNull = (value: string): number | null =>
  value === NO_LIMIT ? null : Number.parseInt(value, 10)

const asOption = (value: number, label: string): SelectOption => ({ value: String(value), label })

/**
 * The languages the room's screen can speak, each named in itself (roadmap 1.5).
 *
 * A constant rather than a function of the table, unlike every other list on this form,
 * and that is the point: these are **endonyms** and are never translated. A host reading
 * the console in French still picks "Deutsch", because the word they choose is the one
 * the room will read.
 */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/**
 * The values each select offers. Functions of the table rather than constants, because the
 * wording is not known until something renders; the numbers are the fixed part and are
 * still written once, here, rather than beside the control.
 */
const graceOptions = (text: UiText): readonly SelectOption[] =>
  [0, 60, 300, 900, 3600].map((seconds) => asOption(seconds, graceLabel(seconds, text)))

const retentionOptions = (text: UiText): readonly SelectOption[] => [
  { value: NO_LIMIT, label: text.admin.retentionNever },
  ...[7, 30, 90, 365].map((days) => asOption(days, text.admin.retentionDays(days))),
]

const maxPhotosOptions = (text: UiText): readonly SelectOption[] => [
  { value: NO_LIMIT, label: text.admin.maxPhotosUnlimited },
  // 27: the length of a roll, which is what the disposable camera template gives (spec 23).
  ...[10, 25, 27, 50, 100].map((count) => asOption(count, text.admin.photos(count))),
]

/**
 * Keep a value the server already holds, even when it is not one this form offers.
 *
 * Without it, opening the settings of an event configured elsewhere — a seeded demo, a
 * later build with more choices — would quietly rewrite that value to whichever option
 * happened to be first, on a form the host only came to for something else.
 */
const withCurrent = (
  options: readonly SelectOption[],
  current: string,
  label: (value: number) => string,
): readonly SelectOption[] =>
  options.some((option) => option.value === current)
    ? options
    : [...options, { value: current, label: label(Number.parseInt(current, 10)) }]

/** The two fields of the schedule, as the `datetime-local` inputs hold them. */
interface ScheduleDraft {
  readonly open: string
  readonly close: string
}

/**
 * What the host has armed, in their own words. `formatDateTime` answers `null` for a
 * value it cannot read, which falls through to "no schedule" rather than printing
 * something meaningless under the fields.
 */
const scheduleSummary = (event: EventDto, text: UiText, locale: Locale): string => {
  const opensAt =
    event.scheduledOpenAt === null ? null : formatDateTime(event.scheduledOpenAt, locale)
  const closesAt =
    event.scheduledCloseAt === null ? null : formatDateTime(event.scheduledCloseAt, locale)

  if (opensAt !== null && closesAt !== null) return text.admin.scheduleArmed(opensAt, closesAt)
  if (opensAt !== null) return text.admin.scheduleOpensOnly(opensAt)
  if (closesAt !== null) return text.admin.scheduleClosesOnly(closesAt)
  return text.admin.scheduleNone
}

/** The page's groups, in the order they are shown; each id is also the section's anchor. */
const SECTIONS = ['guests', 'guestbook', 'messaging', 'reveal', 'wall', 'look', 'schedule'] as const
type SectionId = (typeof SECTIONS)[number]

const isSection = (value: string): value is SectionId =>
  (SECTIONS as readonly string[]).includes(value)

/** One line per closed section: what it is set to, the first fact first. */
const sectionSummary = (
  id: SectionId,
  settings: EventSettingsDto,
  event: EventDto,
  text: UiText,
): string => {
  const s = text.admin.settingsPage
  const parts = ((): readonly string[] => {
    switch (id) {
      case 'guests':
        return [
          settings.moderation === 'manual' ? s.manual : s.auto,
          settings.allowClips ? s.clipsOn : s.clipsOff,
          settings.allowGuestSave ? s.guestSaveOn : s.guestSaveOff,
        ]
      case 'guestbook':
        return settings.allowGuestbook
          ? [
              s.open,
              ...(settings.guestbookOnWall ? [s.onWall] : []),
              ...(settings.guestbookVoice.enabled ? [s.voice] : []),
            ]
          : [s.closed]
      case 'messaging':
        return [settings.allowTelegram ? text.channels.on : text.channels.off]
      case 'reveal':
        return settings.reveal?.enabled === true
          ? [
              s.on,
              settings.reveal.at === null ? s.byHand : s.timed,
              settings.maxPhotosPerGuest === null
                ? text.admin.maxPhotosUnlimited
                : text.admin.photos(settings.maxPhotosPerGuest),
            ]
          : [s.off]
      case 'wall':
        return [
          settings.wall.layout === null
            ? text.admin.wallDisplay.layoutUnset
            : text.wall.layoutNames[settings.wall.layout],
          settings.wall.qrVisible ? s.qrOn : s.qrOff,
          ...(settings.wall.soundEnabled ? [s.sound] : []),
          LOCALE_NAMES[settings.wallLanguage],
        ]
      case 'look':
        return [
          text.admin.themeAmbianceNames[settings.theme.ambiance],
          ...(settings.theme.groundUrl ? [s.venuePhoto] : []),
          ...(settings.brand?.logoUrl ? [s.logo] : []),
        ]
      case 'schedule':
        return [
          event.scheduledOpenAt === null ? s.opensByHand : s.opensAt,
          event.scheduledCloseAt === null ? s.closesByHand : s.closesAt,
          settings.retentionDays === null ? s.keptForever : s.deletedAfter(settings.retentionDays),
        ]
    }
  })()
  return parts.join(' · ')
}

/** What the line under the title says about the last change. */
const saveStatus = (state: SettingsSaveState, text: UiText): string => {
  switch (state.kind) {
    case 'saving':
      return text.admin.settingsPage.saving
    case 'saved':
      return text.admin.settingsPage.saved
    default:
      return text.admin.settingsPage.autosave
  }
}

/** Surface: the host's laptop, before the event rather than during it. */
export function EventSettingsPage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace: replaceOwn } = useEvent(slug)
  // What a save returns reaches the menu and the ambiance around the page too (eventLayout/).
  const replace = useSharedReplace(replaceOwn)

  /**
   * This page shows state a **background job rewrites**, which no other admin screen does:
   * the sweep opens an event and spends the instant while the host has the page open. Without
   * this, a tab left open from 17:50 still shows an 18:00 opening at 20:30.
   */
  useRevalidateWhenVisible(reload)

  /*
    The whole-page states are for when there is **nothing to show**, not for every fetch:
    `useLoader` keeps the previous answer through a refresh — including a failed one — so a
    host who switches windows does not come back to a spinner in place of the page.
  */
  if (event === null) {
    if (loading) return <Pending label={t.admin.eventLoading} />
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="settings" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  return <SettingsSections event={event} error={error} reload={reload} replace={replace} />
}

interface SettingsSectionsProps {
  readonly event: EventDto
  /** A refresh that failed while the host was reading: the page keeps what it had and says so. */
  readonly error: string | null
  readonly reload: () => void
  readonly replace: (event: EventDto) => void
}

/**
 * The page itself, once there is an event: six sections, one open at a time, and no Save button.
 *
 * Every change is saved as it is made (`useSettingsAutosave`, the same queue as the wall's panel):
 * a click is sent after a short stillness, the control shows the choice at once, and a refusal puts
 * it back to what the server holds and says why. The two choices that change what the room sees at
 * once ask first: publishing without validation, and hiding an evening's photographs behind the
 * disposable camera.
 */
function SettingsSections({ event, error, reload, replace }: SettingsSectionsProps) {
  const t = useTranslations()
  // A date is read differently in each of the five: 20/06/26 and 6/20/26 are the same
  // instant and opposite readings, and this page is where a host confirms a schedule.
  const { locale } = useLocale()
  const location = useLocation()
  const navigate = useNavigate()
  const slug = event.slug
  const autosave = useSettingsAutosave(slug, event, replace)
  const saveSchedule = useSaveSchedule()
  // Whether this box has a bot, and whether the plan includes it (spec 27): the section exists only with a bot.
  const channelsRead = useChannels(slug)
  const channels = channelsRead.data
  const openVoice = useOpenGuestbookVoice()
  const toast = useToast()

  const fromHash = location.hash.slice(1)
  const [openSection, setOpenSection] = useState<SectionId | null>(
    isSection(fromHash) ? fromHash : 'guests',
  )
  const [confirmingOpen, setConfirmingOpen] = useState(false)
  const [confirmingAuto, setConfirmingAuto] = useState(false)
  const [confirmingReveal, setConfirmingReveal] = useState(false)
  const [voiceFailure, setVoiceFailure] = useState<string | null>(null)
  // The page's own reading of "now", taken once and again when the secret is lifted: the render
  // stays pure, and an opening time the server has just written is in the past of this clock.
  const [clockMs, setClockMs] = useState(() => Date.now())

  // Whether the reveal has an hour: the switch is the host's, the hour field beneath it is empty
  // until they pick one, so it cannot be read off the settings alone. `null`: follow the settings.
  const [timedChoice, setTimedChoice] = useState<boolean | null>(null)
  // The hour being typed, saved when the host leaves the field: a half-typed date is not an hour.
  const [revealAtDraft, setRevealAtDraft] = useState(
    toLocalInput(event.settings.reveal?.at ?? null),
  )
  const [syncedRevealAt, setSyncedRevealAt] = useState(event.settings.reveal?.at ?? null)

  const [schedule, setSchedule] = useState<ScheduleDraft>({
    open: toLocalInput(event.scheduledOpenAt),
    close: toLocalInput(event.scheduledCloseAt),
  })
  const [syncedOpen, setSyncedOpen] = useState(event.scheduledOpenAt)
  const [syncedClose, setSyncedClose] = useState(event.scheduledCloseAt)
  const [scheduleFailure, setScheduleFailure] = useState<string | null>(null)

  const settings = autosave.settings

  // The server's answer is the starting point of the two date drafts, and also the answer to their
  // save — adjusted during render, React's pattern for "reset state when a prop changes".
  // Read from the server's answer, not from the pending overlay: a refused hour leaves it where it
  // was, so what the host typed stays in front of them with the reason.
  const serverRevealAt = event.settings.reveal?.at ?? null
  if (serverRevealAt !== syncedRevealAt) {
    setSyncedRevealAt(serverRevealAt)
    setRevealAtDraft(toLocalInput(serverRevealAt))
    setTimedChoice(null)
  }
  // Field by field: the answer to the opening's save must not wipe a closing being typed.
  if (event.scheduledOpenAt !== syncedOpen) {
    setSyncedOpen(event.scheduledOpenAt)
    setSchedule((current) => ({ ...current, open: toLocalInput(event.scheduledOpenAt) }))
  }
  if (event.scheduledCloseAt !== syncedClose) {
    setSyncedClose(event.scheduledCloseAt)
    setSchedule((current) => ({ ...current, close: toLocalInput(event.scheduledCloseAt) }))
  }

  // Two reasons nothing can be changed, and the person is told which: the event is archived, or the
  // viewer is a moderator, for whom the server refuses every settings route (`403`, owner only). A
  // page whose every change fails is worse than none, so the controls are there to read and not to press.
  const archived = !isMutable(event.status)
  const ownerOnly = event.role !== 'owner'
  const readOnly = archived || ownerOnly

  // Every control is disabled while the page is read-only, so nothing calls this then.
  const update = (patch: Partial<EventSettingsDto>) =>
    autosave.save(settingsChanges({ ...settings, ...patch }, settings))
  const updateVoice = (patch: Partial<EventSettingsDto['guestbookVoice']>) =>
    update({ guestbookVoice: { ...settings.guestbookVoice, ...patch } })

  const toggleSection = (id: SectionId) => {
    const next = openSection === id ? null : id
    setOpenSection(next)
    // The address keeps the open section, so a reload or a shared link lands on it.
    void navigate({ ...location, hash: next === null ? '' : `#${next}` }, { replace: true })
  }

  // "Ouvrir maintenant" is the owner's alone, and means something only while the secret holds on a
  // live event (a closed one is already open, derived from its status). The server is the judge:
  // the button is a convenience and a second press is a harmless 200.
  const voice = settings.guestbookVoice
  const voiceOn = settings.allowGuestbook && voice.enabled
  const canOpenVoice =
    event.role === 'owner' &&
    event.status === 'live' &&
    voiceOn &&
    event.settings.guestbookVoice.sealed &&
    !(event.reveal?.enabled === true && event.reveal.revealed) &&
    (event.settings.guestbookVoice.opensAtMs === null ||
      event.settings.guestbookVoice.opensAtMs > clockMs)
  // A box served over plain http on the local network has no microphone to give: a limit of the
  // browser, said to the host who would otherwise find out from a guest.
  const insecure = typeof window !== 'undefined' && !window.isSecureContext

  const handleOpenVoice = () => {
    setConfirmingOpen(false)
    setVoiceFailure(null)
    void openVoice.run('open', slug).then((result) => {
      if (!result.ok) {
        setVoiceFailure(result.message)
        return
      }
      setClockMs(Date.now())
      reload()
      toast.show(t.guestbookVoiceHost.opened, { tone: 'success' })
    })
  }

  /**
   * The schedule is its own endpoint with its own refusal ("a closing before an opening"), saved
   * when the host leaves one of its two fields — a half-typed date is not an instant — and only
   * when what they typed differs from what the server holds.
   */
  const commitSchedule = () => {
    const draft = {
      scheduledOpenAt: toInstant(schedule.open),
      scheduledCloseAt: toInstant(schedule.close),
    }
    if (
      draft.scheduledOpenAt === event.scheduledOpenAt &&
      draft.scheduledCloseAt === event.scheduledCloseAt
    )
      return
    setScheduleFailure(null)
    void saveSchedule.run('schedule', slug, draft).then((result) => {
      if (!result.ok) {
        setScheduleFailure(result.message)
        // A refusal is the other half of the staleness fix. The likeliest one is "that instant
        // has already gone by", and the likeliest reason is that the sweep moved underneath a
        // page the host has had open for hours — so the sentence is shown *and* the event is
        // re-read, or they would be left arguing with values the server stopped holding.
        reload()
        return
      }
      replace(result.value)
      toast.show(t.admin.scheduleSaved, { tone: 'success' })
    })
  }

  /**
   * The earliest minute the picker offers.
   *
   * A guard rail, not the guard: this narrows the native control's affordances, and
   * `Event.reschedule` is what actually refuses a past instant. Read at render from the
   * browser's clock, which is the same clock the fields are expressed in.
   */
  const earliest = toLocalInput(new Date().toISOString())
  const discardedAt =
    event.scheduleDiscardedAt === null ? null : formatDateTime(event.scheduleDiscardedAt, locale)

  const grace = String(settings.guestSelfDeleteGraceSeconds)
  const retention = settings.retentionDays === null ? NO_LIMIT : String(settings.retentionDays)
  const maxPhotos =
    settings.maxPhotosPerGuest === null ? NO_LIMIT : String(settings.maxPhotosPerGuest)

  // The disposable camera (spec 23). An older server sends no group: the mode is then off.
  const reveal = settings.reveal ?? { enabled: false, at: null, film: false }
  const timed = timedChoice ?? reveal.at !== null
  // Revealed already, by the server's word: the hour cannot move any more (`eventSettings.revealDone`).
  // The page says so instead of letting the host find out from a refusal.
  const revealLocked =
    event.reveal?.revealed === true &&
    event.reveal.enabled &&
    event.settings.reveal?.at !== null &&
    event.settings.reveal?.at !== undefined
  // Turning the mode on for an evening that already has photographs on screen hides them until the
  // hour, the moment it is saved: the host confirms first.
  const wouldHideWhatIsShown = event.status === 'live' && event.photoCount > 0
  const updateReveal = (patch: Partial<typeof reveal>) =>
    update({ reveal: { ...reveal, ...patch } })

  const failure =
    autosave.state.kind === 'failed'
      ? `${t.admin.settingsPage.saveFailed} ${messageForError(autosave.state.cause, t)}`
      : null

  const section = (id: SectionId, title: string) => ({
    id,
    title,
    summary: sectionSummary(id, settings, event, t),
    open: openSection === id,
    onToggle: () => toggleSection(id),
  })

  return (
    <div className={styles['page']}>
      {/* Replaces the bare link to the event that stood under the heading: the trail is that link
          and the way to the list. */}
      <HostBreadcrumb
        slug={event.slug}
        page="settings"
        eventName={event.name}
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
      />
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t.admin.settings}</h1>
        {readOnly ? null : (
          <p className={styles['status']} aria-live="polite" data-state={autosave.state.kind}>
            {saveStatus(autosave.state, t)}
          </p>
        )}
      </div>

      {readOnly ? (
        <p className={styles['notice']}>
          {archived ? t.admin.settingsReadOnly : t.admin.settingsOwnerOnly}
        </p>
      ) : null}

      {/*
        A refresh that failed while the host was reading. The page keeps the answer it
        already had rather than blanking, and says so instead of pretending it is
        current — `useLoader` holds the previous data for exactly this.
      */}
      {error === null ? null : (
        <Notice tone="warning" role="status" variant="boxed">
          {error}
        </Notice>
      )}

      {/* A change the server refused: the control is back to what it holds, and this says why. */}
      {failure === null ? null : (
        <Notice tone="danger" role="alert" variant="boxed">
          {failure}
        </Notice>
      )}

      <div className={styles['sections']}>
        <SettingsSection {...section('guests', t.admin.settingsPage.guests)}>
          <fieldset className={styles['group']}>
            <legend className={styles['legend']}>{t.admin.moderationMode}</legend>
            {(['manual', 'auto'] as const).map((mode) => (
              <label key={mode} className={styles['choice']}>
                <input
                  type="radio"
                  className={styles['radio']}
                  name="moderation"
                  value={mode}
                  checked={settings.moderation === mode}
                  disabled={readOnly}
                  onChange={() =>
                    // Publishing without validation is the one setting that can put something
                    // unwanted on a screen in front of two hundred people, and it is saved the
                    // moment it is chosen: the host reads why before it is.
                    mode === 'auto' ? setConfirmingAuto(true) : update({ moderation: mode })
                  }
                />
                {mode === 'manual' ? t.admin.moderationManual : t.admin.moderationAuto}
              </label>
            ))}
          </fieldset>

          {/* Mounted whatever the choice, so the warning is announced when it appears. */}
          <div aria-live="polite">
            {settings.moderation === 'auto' ? (
              <Notice tone="warning" variant="boxed">
                {t.admin.moderationAutoWarning}
              </Notice>
            ) : null}
          </div>

          <CheckboxField
            label={t.admin.allowCaptions}
            checked={settings.allowCaptions}
            disabled={readOnly}
            onChange={(allowCaptions) => update({ allowCaptions })}
          />

          <CheckboxField
            label={t.admin.allowReactions}
            checked={settings.allowReactions}
            disabled={readOnly}
            onChange={(allowReactions) => update({ allowReactions })}
          />

          {/*
            Saving from the feed (spec 24). The hint says what the switch does and what it cannot:
            a photo already saved stays on the phone it was saved to, and the switch is no access
            control (a published photo's display rendition is public anyway).
          */}
          <CheckboxField
            label={t.admin.allowGuestSave}
            hint={t.admin.allowGuestSaveHint}
            checked={settings.allowGuestSave}
            disabled={readOnly}
            onChange={(allowGuestSave) => update({ allowGuestSave })}
          />

          {/*
            The host's switch over video, with a hint because **it reads off on every gallery that
            existed before clips shipped**: the persistence fallback answers `false` for a settings
            blob written without the field, so for exactly the events this feature was built for,
            nothing happens until a host comes here and ticks it.
          */}
          <CheckboxField
            label={t.admin.allowClips}
            hint={t.admin.allowClipsHint}
            checked={settings.allowClips}
            disabled={readOnly}
            onChange={(allowClips) => update({ allowClips })}
          />

          <CheckboxField
            label={t.admin.allowGuestSelfDelete}
            checked={settings.allowGuestSelfDelete}
            disabled={readOnly}
            onChange={(allowGuestSelfDelete) => update({ allowGuestSelfDelete })}
          />

          {/* Only while guests may delete: a delay over nothing is one more line to read past. */}
          {settings.allowGuestSelfDelete ? (
            <SelectField
              label={t.admin.selfDeleteGrace}
              hint={t.admin.selfDeleteGraceHint}
              value={grace}
              options={withCurrent(graceOptions(t), grace, (seconds) => graceLabel(seconds, t))}
              disabled={readOnly}
              onChange={(value) =>
                update({ guestSelfDeleteGraceSeconds: Number.parseInt(value, 10) })
              }
            />
          ) : null}
        </SettingsSection>

        <SettingsSection {...section('guestbook', t.admin.settingsPage.guestbook)}>
          <CheckboxField
            label={t.admin.allowGuestbook}
            hint={t.admin.allowGuestbookHint}
            checked={settings.allowGuestbook}
            disabled={readOnly}
            onChange={(allowGuestbook) => update({ allowGuestbook })}
          />

          {/*
            What only means something while the book is open is shown only then. The voice
            messages (spec 25): the sealed switch is the host's wish about their own listening, so
            it follows the voice switch. The secret is said as "gardé secret" here and never as the
            code's word for it.
          */}
          {settings.allowGuestbook ? (
            <>
              <CheckboxField
                label={t.admin.guestbookOnWall}
                hint={t.admin.guestbookOnWallHint}
                checked={settings.guestbookOnWall}
                disabled={readOnly}
                onChange={(guestbookOnWall) => update({ guestbookOnWall })}
              />
              <CheckboxField
                label={t.guestbookVoiceHost.settingsEnabled}
                hint={t.guestbookVoiceHost.settingsEnabledHint}
                checked={voice.enabled}
                disabled={readOnly}
                onChange={(enabled) => updateVoice({ enabled })}
              />
            </>
          ) : null}

          {voiceOn ? (
            <CheckboxField
              label={
                reveal.enabled
                  ? t.guestbookVoiceHost.settingsSealedReveal
                  : t.guestbookVoiceHost.settingsSealed
              }
              hint={
                reveal.enabled
                  ? t.guestbookVoiceHost.settingsSealedRevealHint
                  : t.guestbookVoiceHost.settingsSealedHint
              }
              checked={voice.sealed}
              disabled={readOnly}
              onChange={(sealed) => updateVoice({ sealed })}
            />
          ) : null}

          {canOpenVoice ? (
            <Button
              type="button"
              variant="secondary"
              loading={openVoice.busy}
              onClick={() => setConfirmingOpen(true)}
            >
              {t.guestbookVoiceHost.openNow}
            </Button>
          ) : null}

          {voiceFailure === null ? null : (
            <Notice tone="danger" role="alert" variant="boxed">
              {voiceFailure}
            </Notice>
          )}

          {voiceOn && insecure ? (
            <Notice tone="warning" role="status" variant="boxed">
              {t.guestbookVoiceHost.insecure}
            </Notice>
          ) : null}
        </SettingsSection>

        {/*
          The disposable camera (spec 23): photographs hidden from the guests and the room until the
          reveal, a roll of poses, a film look on screen. The cap on photographs per guest lives here
          and nowhere else: it is the same setting (`maxPhotosPerGuest`, enforced at upload) and it
          also works with the mode off, which the hint says. "Révéler maintenant" is the console's.
        */}
        {/* Messageries (spec 27): the section is there while the box is being asked (so a #messaging link opens it
            and nothing jumps), says so when the box could not be asked, and is absent once the box says it has no
            bot, so nobody is offered a switch that cannot work. Greyed, with the reason, when the client's plan does
            not include it: a host whose plan was withdrawn can still switch Telegram OFF. */}
        {channels === null || channels.available ? (
          <SettingsSection {...section('messaging', t.channels.settingsSection)}>
            {channels === null ? (
              channelsRead.error === null ? (
                <Pending label={t.app.loading} />
              ) : (
                <Notice tone="danger" variant="boxed">
                  {channelsRead.error}
                </Notice>
              )
            ) : (
              <CheckboxField
                label={t.channels.allowTelegram}
                hint={channels.allowed ? t.channels.allowTelegramHint : t.channels.notAllowed}
                checked={settings.allowTelegram}
                disabled={readOnly || (!channels.allowed && !settings.allowTelegram)}
                onChange={(allowTelegram) => update({ allowTelegram })}
              />
            )}
          </SettingsSection>
        ) : null}

        <SettingsSection {...section('reveal', t.reveal.title)}>
          <p className={styles['sectionHint']}>{t.reveal.hint}</p>
          <CheckboxField
            label={t.reveal.enabled}
            checked={reveal.enabled}
            disabled={readOnly}
            onChange={(enabled) =>
              enabled && wouldHideWhatIsShown
                ? setConfirmingReveal(true)
                : updateReveal({ enabled })
            }
          />
          {reveal.enabled ? (
            <>
              <CheckboxField
                label={t.reveal.timed}
                hint={t.reveal.timedHint}
                checked={timed}
                disabled={readOnly || revealLocked}
                onChange={(on) => {
                  setTimedChoice(on)
                  // Off clears the hour, and that is saved.
                  if (!on) updateReveal({ at: null })
                }}
              />
              {timed ? (
                <DateTimeField
                  label={t.reveal.at}
                  {...(revealLocked ? { hint: t.reveal.atLocked } : {})}
                  value={revealAtDraft}
                  min={earliest}
                  disabled={readOnly || revealLocked}
                  onChange={setRevealAtDraft}
                  onBlur={() => {
                    const at = toInstant(revealAtDraft)
                    if (at !== reveal.at) updateReveal({ at })
                  }}
                />
              ) : null}
              <CheckboxField
                label={t.reveal.film}
                hint={t.reveal.filmHint}
                checked={reveal.film}
                disabled={readOnly}
                onChange={(film) => updateReveal({ film })}
              />
            </>
          ) : null}
          <SelectField
            label={t.reveal.shots}
            hint={t.reveal.shotsHint}
            value={maxPhotos}
            options={withCurrent(maxPhotosOptions(t), maxPhotos, t.admin.photos)}
            disabled={readOnly}
            onChange={(value) => update({ maxPhotosPerGuest: numberOrNull(value) })}
          />
        </SettingsSection>

        {/*
          The room's screen (spec 13), for every screen of the event: the panel on the projected wall
          writes the same group, so only the keys changed here are sent (settingsChanges). The language
          is here because it is the same kind of decision — what the projector says — and the options
          are endonyms with no flag: a flag is a country and Spanish is not Spain.
        */}
        <SettingsSection {...section('wall', t.admin.settingsPage.wall)}>
          <p className={styles['sectionHint']}>{t.admin.wallDisplay.hint}</p>
          <SelectField
            label={t.admin.wallLanguage}
            hint={t.admin.wallLanguageHint}
            value={settings.wallLanguage}
            options={LANGUAGE_OPTIONS}
            disabled={readOnly}
            onChange={(value) => {
              // Parsed rather than cast: the value comes back as a bare string, and a control an
              // extension rewrote must not send the server a tag nothing has a table for.
              const chosen = parseLocale(value)
              if (chosen !== null) update({ wallLanguage: chosen })
            }}
          />
          <SelectField
            label={t.admin.wallDisplay.layout}
            hint={t.admin.wallDisplay.layoutHint}
            value={settings.wall.layout ?? WALL_UNSET}
            options={wallLayoutOptions(t)}
            disabled={readOnly}
            onChange={(value) =>
              update({
                wall: {
                  ...settings.wall,
                  layout: wallLayoutOptions(t).some(
                    (o) => o.value === value && value !== WALL_UNSET,
                  )
                    ? (value as WallLayout)
                    : null,
                },
              })
            }
          />
          <SelectField
            label={t.admin.wallDisplay.interval}
            hint={t.admin.wallDisplay.intervalHint}
            value={
              settings.wall.slideIntervalMs === null
                ? WALL_UNSET
                : String(settings.wall.slideIntervalMs)
            }
            options={wallRhythmOptions(t, settings.wall.slideIntervalMs)}
            disabled={readOnly}
            onChange={(value) =>
              update({ wall: { ...settings.wall, slideIntervalMs: numberOrNull(value) } })
            }
          />
          {/* The mixed wall (spec 09): off until chosen, the two durations only once it is on. */}
          <CheckboxField
            label={t.admin.wallDisplay.mixed}
            hint={t.admin.wallDisplay.mixedHint}
            checked={settings.wall.mixedEnabled}
            disabled={readOnly}
            onChange={(mixedEnabled) => update({ wall: { ...settings.wall, mixedEnabled } })}
          />
          {settings.wall.mixedEnabled ? (
            <>
              <SelectField
                label={t.admin.wallDisplay.mixedWall}
                value={String(settings.wall.mixedWallSeconds)}
                options={mixedDurationOptions(
                  MIXED_WALL_STEPS_SECONDS,
                  settings.wall.mixedWallSeconds,
                )}
                disabled={readOnly}
                onChange={(value) =>
                  update({
                    wall: { ...settings.wall, mixedWallSeconds: Number.parseInt(value, 10) },
                  })
                }
              />
              <SelectField
                label={t.admin.wallDisplay.mixedSlideshow}
                value={String(settings.wall.mixedSlideshowSeconds)}
                options={mixedDurationOptions(
                  MIXED_SLIDESHOW_STEPS_SECONDS,
                  settings.wall.mixedSlideshowSeconds,
                )}
                disabled={readOnly}
                onChange={(value) =>
                  update({
                    wall: { ...settings.wall, mixedSlideshowSeconds: Number.parseInt(value, 10) },
                  })
                }
              />
            </>
          ) : null}
          <CheckboxField
            label={t.admin.wallDisplay.freshLane}
            hint={t.admin.wallDisplay.freshLaneHint}
            checked={settings.wall.freshLane}
            disabled={readOnly}
            onChange={(freshLane) => update({ wall: { ...settings.wall, freshLane } })}
          />
          <CheckboxField
            label={t.admin.wallDisplay.tilt}
            hint={t.admin.wallDisplay.tiltHint}
            checked={settings.wall.tilt}
            disabled={readOnly}
            onChange={(tilt) => update({ wall: { ...settings.wall, tilt } })}
          />
          <CheckboxField
            label={t.admin.wallDisplay.showTime}
            hint={t.admin.wallDisplay.showTimeHint}
            checked={settings.wall.showTime}
            disabled={readOnly}
            onChange={(showTime) => update({ wall: { ...settings.wall, showTime } })}
          />
          {/* Spec 14: the invitation card on the populated wall. */}
          <h3 className={styles['subheading']}>{t.admin.wallDisplay.qrTitle}</h3>
          <WallQrControls
            wall={settings.wall}
            disabled={readOnly}
            onChange={(patch) => update({ wall: { ...settings.wall, ...patch } })}
          />
          {/* Spec 11: « À l'écran ». Both off until the host asks. */}
          <h3 className={styles['subheading']}>{t.admin.wallDisplay.onScreen}</h3>
          <CheckboxField
            label={t.admin.wallDisplay.souvenirCounter}
            hint={t.admin.wallDisplay.souvenirCounterHint}
            checked={settings.wall.souvenirCounter}
            disabled={readOnly}
            onChange={(souvenirCounter) => update({ wall: { ...settings.wall, souvenirCounter } })}
          />
          <CheckboxField
            label={t.admin.wallDisplay.newPhotoSignal}
            hint={t.admin.wallDisplay.newPhotoSignalHint}
            checked={settings.wall.newPhotoSignal}
            disabled={readOnly}
            onChange={(newPhotoSignal) => update({ wall: { ...settings.wall, newPhotoSignal } })}
          />
          <WallSoundFields
            wall={settings.wall}
            disabled={readOnly}
            onChange={(patch) => update({ wall: { ...settings.wall, ...patch } })}
          />
        </SettingsSection>

        {/*
          How the event looks (roadmap 2.2), and the host's own words and images (spec 03). The
          venue photograph (ADR 0010, decision 8a) and the logo are their own requests, answered with
          the event; the welcome message is saved when the host leaves the field.
        */}
        <SettingsSection {...section('look', t.admin.theme)}>
          <ThemeFieldset
            theme={settings.theme}
            customAmbiancePath={`/admin/events/${encodeURIComponent(slug)}/settings/ambiance`}
            disabled={readOnly}
            onChange={(theme) => update({ theme })}
          />
          <VenuePhotoField
            slug={slug}
            groundUrl={event.settings.theme.groundUrl}
            disabled={readOnly}
            onChanged={replace}
          />
          <WelcomeMessageField
            // The server's answer, not the pending overlay: a refused message must not be swapped
            // back into the field over what the host typed.
            value={event.settings.brand?.welcomeMessage ?? null}
            disabled={readOnly}
            onChange={(welcomeMessage) =>
              update({ brand: { welcomeMessage, logoUrl: settings.brand?.logoUrl ?? null } })
            }
          />
          <LogoField
            slug={slug}
            logoUrl={event.settings.brand?.logoUrl}
            disabled={readOnly}
            onChanged={replace}
          />
        </SettingsSection>

        {/*
          The one block that changes the event's status on its own: its own endpoint, saved when the
          host leaves a field, and the retention beside it, which is the other "when".
        */}
        <SettingsSection {...section('schedule', t.admin.settingsPage.schedule)}>
          <p className={styles['sectionHint']}>{t.admin.scheduleHint}</p>

          {/*
            The sweep threw a schedule away while nobody was watching. The fields below are empty
            because of it, and this is the only thing that says so — saving anything, the empty
            schedule included, clears it.
          */}
          {discardedAt === null ? null : (
            <Notice tone="warning" role="status" variant="boxed">
              {t.admin.scheduleDiscarded(discardedAt)}
            </Notice>
          )}

          <DateTimeField
            label={t.admin.scheduleOpenAt}
            value={schedule.open}
            min={earliest}
            disabled={readOnly}
            onChange={(open) => setSchedule({ ...schedule, open })}
            onBlur={commitSchedule}
          />

          <DateTimeField
            label={t.admin.scheduleCloseAt}
            hint={t.admin.scheduleCloseAtHint}
            value={schedule.close}
            min={earliest}
            disabled={readOnly}
            onChange={(close) => setSchedule({ ...schedule, close })}
            onBlur={commitSchedule}
          />

          {/* What is actually armed on the server, not what is typed in the fields. */}
          <p className={styles['notice']}>{scheduleSummary(event, t, locale)}</p>

          {scheduleFailure === null ? null : (
            <Notice tone="danger" role="alert" variant="boxed">
              {scheduleFailure}
            </Notice>
          )}

          <SelectField
            label={t.admin.retention}
            hint={t.admin.retentionHint}
            value={retention}
            options={withCurrent(retentionOptions(t), retention, t.admin.retentionDays)}
            disabled={readOnly}
            onChange={(value) => update({ retentionDays: numberOrNull(value) })}
          />
        </SettingsSection>
      </div>

      <ConfirmDialog
        open={confirmingAuto}
        title={t.admin.settingsPage.confirmAutoTitle}
        description={t.admin.moderationAutoWarning}
        confirmLabel={t.admin.moderationAuto}
        confirmVariant="primary"
        onCancel={() => setConfirmingAuto(false)}
        onConfirm={() => {
          setConfirmingAuto(false)
          update({ moderation: 'auto' })
        }}
      />

      <ConfirmDialog
        open={confirmingReveal}
        title={t.admin.settingsPage.confirmRevealTitle}
        description={t.reveal.liveWarning}
        confirmLabel={t.reveal.enabled}
        confirmVariant="primary"
        onCancel={() => setConfirmingReveal(false)}
        onConfirm={() => {
          setConfirmingReveal(false)
          updateReveal({ enabled: true })
        }}
      />

      <ConfirmDialog
        open={confirmingOpen}
        title={t.guestbookVoiceHost.openConfirmTitle}
        description={t.guestbookVoiceHost.openConfirmBody}
        confirmLabel={t.guestbookVoiceHost.openNow}
        confirmVariant="primary"
        onCancel={() => setConfirmingOpen(false)}
        onConfirm={handleOpenVoice}
      />
    </div>
  )
}
