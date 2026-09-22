import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale } from '../../lib/i18n/locale'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './components/AsyncState'
import { CheckboxField } from './components/CheckboxField'
import { DateTimeField } from './components/DateTimeField'
import { SelectField, type SelectOption } from './components/SelectField'
import { ThemeFieldset } from './components/ThemeFieldset'
import { isMutable } from './eventLifecycle'
import { toInstant, toLocalInput } from './eventSchedule'
// Shared with the create form's template card, so the two screens cannot word the same
// window differently.
import { graceLabel } from './settingsLabels'
import { useEvent } from './hooks/useEventData'
import { useSaveSchedule, useSaveSettings } from './hooks/useEventActions'
import { useRevalidateWhenVisible } from './hooks/useRevalidateWhenVisible'
import styles from './EventSettingsPage.module.css'
import type { EventDto, EventSettingsDto } from '../../lib/api/dto'
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
 * the console in French still picks "Deutsch" for a German-speaking room, because the
 * word they are choosing is the one the room will read. It is the same rule the guest's
 * own picker states, for the same reason, from the same map.
 */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/**
 * The values each select offers, worded in the language the host is reading.
 *
 * Functions of the table rather than constants, because the wording is not known until
 * something renders: the numbers are the fixed part and they are still written once,
 * here, rather than beside the control.
 */
const graceOptions = (text: UiText): readonly SelectOption[] =>
  [0, 60, 300, 900, 3600].map((seconds) => asOption(seconds, graceLabel(seconds, text)))

const retentionOptions = (text: UiText): readonly SelectOption[] => [
  { value: NO_LIMIT, label: text.admin.retentionNever },
  ...[7, 30, 90, 365].map((days) => asOption(days, text.admin.retentionDays(days))),
]

const maxPhotosOptions = (text: UiText): readonly SelectOption[] => [
  { value: NO_LIMIT, label: text.admin.maxPhotosUnlimited },
  ...[10, 25, 50, 100].map((count) => asOption(count, text.admin.photos(count))),
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

/** The two fields of the schedule form, as the `datetime-local` inputs hold them. */
interface ScheduleDraft {
  readonly open: string
  readonly close: string
}

/**
 * Identity for the "reset the form when the server's answer changes" comparisons.
 *
 * **By value, not by reference.** `getEvent` deserialises a fresh object on every read,
 * so an identity check resets the draft on every refetch — which was harmless while the
 * page fetched exactly once, and is not now that it revalidates when the host returns to
 * the tab. Comparing the values means a background refresh discards the host's unsaved
 * typing only when the server's answer genuinely changed underneath them, which is the
 * one case where discarding it is the right thing to do.
 */
const settingsIdentity = (settings: EventSettingsDto): string =>
  [
    settings.moderation,
    settings.allowCaptions,
    settings.allowReactions,
    settings.allowClips,
    settings.allowGuestSelfDelete,
    settings.guestSelfDeleteGraceSeconds,
    settings.retentionDays,
    settings.maxPhotosPerGuest,
    // The theme is four values, so it is flattened here like everything else: without
    // it a host who changed only the colour would have their unsaved choice survive a
    // background refresh that moved it underneath them.
    settings.theme.accentHue,
    settings.theme.fonts,
    settings.theme.frame,
    settings.theme.material,
    // The wall's language (roadmap 1.5). Flattened like the theme, and for the same
    // reason: a host who changed only this would otherwise have their unsaved choice
    // survive a background refresh that moved it underneath them.
    settings.wallLanguage,
  ].join('|')

const scheduleIdentity = (event: EventDto): string =>
  `${event.scheduledOpenAt ?? ''}|${event.scheduledCloseAt ?? ''}`

/**
 * What the host has armed, in their own words. `formatDateTime` answers `null` for a
 * value it cannot read, which falls through to "no schedule" rather than printing
 * something meaningless under the fields.
 */
const scheduleSummary = (event: EventDto, text: UiText): string => {
  const opensAt = event.scheduledOpenAt === null ? null : formatDateTime(event.scheduledOpenAt)
  const closesAt = event.scheduledCloseAt === null ? null : formatDateTime(event.scheduledCloseAt)

  if (opensAt !== null && closesAt !== null) return text.admin.scheduleArmed(opensAt, closesAt)
  if (opensAt !== null) return text.admin.scheduleOpensOnly(opensAt)
  if (closesAt !== null) return text.admin.scheduleClosesOnly(closesAt)
  return text.admin.scheduleNone
}

/** Surface: the host's laptop, before the event rather than during it. */
export function EventSettingsPage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const save = useSaveSettings()
  const saveSchedule = useSaveSchedule()
  const toast = useToast()

  const [draft, setDraft] = useState<EventSettingsDto | null>(null)
  const [syncedFrom, setSyncedFrom] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const [schedule, setSchedule] = useState<ScheduleDraft>({ open: '', close: '' })
  const [syncedSchedule, setSyncedSchedule] = useState<string | null>(null)
  const [scheduleFailure, setScheduleFailure] = useState<string | null>(null)

  /**
   * This page holds an editable draft of state a **background job rewrites**, which no
   * other admin screen does: the sweep opens an event and spends the instant while the
   * host has the form open. Without this, a tab left open from 17:50 still shows an
   * 18:00 opening at 20:30 and offers to save it back.
   */
  useRevalidateWhenVisible(reload)

  // The server's answer is the starting point, and it is also the answer to a save —
  // so the form always shows what is actually stored, never what was typed.
  //
  // Adjusted during render rather than in an effect. An effect would paint the stale
  // draft first and then immediately re-render with the new one, which on a slow laptop
  // is a visible flash of the previous event's settings after `replace()`. React's own
  // guidance for "reset state when a prop changes" is this comparison against the value
  // last synced from; `react-hooks/set-state-in-effect` rejects the effect form.
  if (event !== null && settingsIdentity(event.settings) !== syncedFrom) {
    setSyncedFrom(settingsIdentity(event.settings))
    setDraft(event.settings)
  }

  // The same adjust-during-render pattern for the schedule.
  if (event !== null && scheduleIdentity(event) !== syncedSchedule) {
    setSyncedSchedule(scheduleIdentity(event))
    setSchedule({
      open: toLocalInput(event.scheduledOpenAt),
      close: toLocalInput(event.scheduledCloseAt),
    })
  }

  /**
   * The whole-page states are for when there is **nothing to show**, not for every
   * fetch.
   *
   * This used to return `Pending` whenever `loading` was true, which was fine while the
   * page fetched exactly once. Now that it revalidates when the host returns to the tab,
   * that would blank a form they are typing in and replace it with a spinner for a round
   * trip, every time they switch windows. `useLoader` keeps the previous answer through a
   * refresh — including a failed one — precisely so this can be a data check.
   */
  if (event === null || draft === null) {
    if (loading) return <Pending label={t.admin.eventLoading} />
    return <LoadFailure message={error ?? t.errors.unknown} onRetry={reload} as="h1" />
  }

  const readOnly = !isMutable(event.status)
  const settings = draft

  const update = (patch: Partial<EventSettingsDto>) => setDraft({ ...settings, ...patch })

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    setFailure(null)

    void save.run('save', slug, settings).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      replace(result.value)
      toast.show(t.admin.settingsSaved, { tone: 'success' })
    })
  }

  /**
   * Its own form and its own button: the schedule is not part of `EventSettings`, it is
   * a separate endpoint with its own refusal ("a closing before an opening"), and one
   * submit that fired two requests would leave a host unable to tell which half failed.
   */
  const handleScheduleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    setScheduleFailure(null)

    void saveSchedule
      .run('schedule', slug, {
        scheduledOpenAt: toInstant(schedule.open),
        scheduledCloseAt: toInstant(schedule.close),
      })
      .then((result) => {
        if (!result.ok) {
          setScheduleFailure(result.message)
          // A refusal is the other half of the staleness fix. The likeliest one is
          // "that instant has already gone by", and the likeliest reason is that the
          // sweep moved underneath a form the host has had open for hours — so the
          // sentence is shown *and* the form is re-read, or they would be left arguing
          // with values the server stopped holding.
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
   * A guard rail, not the guard: the form is `noValidate`, so this narrows the native
   * control's affordances rather than blocking a submit, and `Event.reschedule` is what
   * actually refuses a past instant. Read at render from the browser's clock, which is
   * the same clock the fields are expressed in.
   */
  const earliest = toLocalInput(new Date().toISOString())
  const discardedAt =
    event.scheduleDiscardedAt === null ? null : formatDateTime(event.scheduleDiscardedAt)

  const grace = String(settings.guestSelfDeleteGraceSeconds)
  const retention = settings.retentionDays === null ? NO_LIMIT : String(settings.retentionDays)
  const maxPhotos =
    settings.maxPhotosPerGuest === null ? NO_LIMIT : String(settings.maxPhotosPerGuest)

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.admin.settings}</h1>
      <p>
        <Link to={`/admin/events/${event.slug}`}>{event.name}</Link>
      </p>

      {readOnly ? <p className={styles['notice']}>{t.admin.settingsReadOnly}</p> : null}

      {/*
        A refresh that failed while the host was reading. The page keeps the answer it
        already had rather than blanking, and says so instead of pretending it is
        current — `useLoader` holds the previous data for exactly this.
      */}
      {error === null ? null : (
        <p className={styles['warning']} role="status">
          <span className={styles['warningGlyph']}>
            <StatusIcon tone="warning" />
          </span>
          {error}
        </p>
      )}

      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
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
                onChange={() => update({ moderation: mode })}
              />
              {mode === 'manual' ? t.admin.moderationManual : t.admin.moderationAuto}
            </label>
          ))}
        </fieldset>

        {/*
          The region is mounted whatever the choice, so the warning is announced when
          it appears. Publishing without validation is the one setting that can put
          something unwanted on a screen in front of two hundred people, so it says so
          at the moment the host selects it — not in a paragraph they read last week.
        */}
        <div aria-live="polite">
          {settings.moderation === 'auto' ? (
            <p className={styles['warning']}>
              <span className={styles['warningGlyph']}>
                <StatusIcon tone="warning" />
              </span>
              {t.admin.moderationAutoWarning}
            </p>
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
          The host's switch over video, and the reason it carries a hint where
          "Autoriser les réactions" does not: **it reads off on every gallery that
          existed before clips shipped.** The persistence fallback answers `false` for a
          settings blob written without the field — deliberately, because a deploy must
          not start accepting eighty-megabyte uploads on a wedding that is live at that
          moment — so for exactly the events this feature was built for, nothing happens
          until a host comes here and ticks it. Without this control there is no way to
          reach that state from any screen at all.
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

        <SelectField
          label={t.admin.selfDeleteGrace}
          hint={t.admin.selfDeleteGraceHint}
          value={grace}
          options={withCurrent(graceOptions(t), grace, (seconds) => graceLabel(seconds, t))}
          disabled={readOnly || !settings.allowGuestSelfDelete}
          onChange={(value) => update({ guestSelfDeleteGraceSeconds: Number.parseInt(value, 10) })}
        />

        <SelectField
          label={t.admin.retention}
          hint={t.admin.retentionHint}
          value={retention}
          options={withCurrent(retentionOptions(t), retention, t.admin.retentionDays)}
          disabled={readOnly}
          onChange={(value) => update({ retentionDays: numberOrNull(value) })}
        />

        <SelectField
          label={t.admin.maxPhotosPerGuest}
          value={maxPhotos}
          options={withCurrent(maxPhotosOptions(t), maxPhotos, t.admin.photos)}
          disabled={readOnly}
          onChange={(value) => update({ maxPhotosPerGuest: numberOrNull(value) })}
        />

        {/*
          What the room's screen says, and in which language (roadmap 1.5).

          Beside the appearance rather than beside the guest switches, because it is the
          same kind of decision — what the projector looks like — and because it changes
          nothing a guest may do. The options are endonyms and there is no flag: a flag is
          a country and Spanish is not Spain, which is the rule the guest's own picker
          states.
        */}
        <SelectField
          label={t.admin.wallLanguage}
          hint={t.admin.wallLanguageHint}
          value={settings.wallLanguage}
          options={LANGUAGE_OPTIONS}
          disabled={readOnly}
          onChange={(value) => {
            // Parsed rather than cast, exactly as the guest's picker parses its own
            // `<select>`: the value comes back from the DOM as a bare string, and a
            // control an extension rewrote must not be able to send the server a tag
            // nothing has a table for.
            const chosen = parseLocale(value)
            if (chosen !== null) update({ wallLanguage: chosen })
          }}
        />

        {/*
          How the event looks (roadmap 2.2). Last in the form, and the only block here
          that changes nothing about what guests may do — a host scanning for the
          moderation switch should not have to read past three colours to find it.
        */}
        <ThemeFieldset
          theme={settings.theme}
          disabled={readOnly}
          onChange={(theme) => update({ theme })}
        />

        {failure === null ? null : (
          <p className={styles['failure']} role="alert">
            <span className={styles['failureGlyph']}>
              <StatusIcon tone="danger" />
            </span>
            {failure}
          </p>
        )}

        <div className={styles['actions']}>
          <Button type="submit" variant="primary" loading={save.busy} disabled={readOnly}>
            {t.app.save}
          </Button>
        </div>
      </form>

      {/*
        A second form, below the policy settings: this is the one thing on the page that
        changes the event's status on its own, and a host scanning the screen should not
        find it among the checkboxes.
      */}
      <form className={styles['form']} onSubmit={handleScheduleSubmit} noValidate>
        <h2 className={styles['sectionTitle']}>{t.admin.schedule}</h2>
        <p className={styles['sectionHint']}>{t.admin.scheduleHint}</p>

        {/*
          The sweep threw a schedule away while nobody was watching. The fields below
          are empty because of it, and this is the only thing that says so — saving
          anything, the empty schedule included, clears it.
        */}
        {discardedAt === null ? null : (
          <p className={styles['warning']} role="status">
            <span className={styles['warningGlyph']}>
              <StatusIcon tone="warning" />
            </span>
            {t.admin.scheduleDiscarded(discardedAt)}
          </p>
        )}

        <DateTimeField
          label={t.admin.scheduleOpenAt}
          value={schedule.open}
          min={earliest}
          disabled={readOnly}
          onChange={(open) => setSchedule({ ...schedule, open })}
        />

        <DateTimeField
          label={t.admin.scheduleCloseAt}
          hint={t.admin.scheduleCloseAtHint}
          value={schedule.close}
          min={earliest}
          disabled={readOnly}
          onChange={(close) => setSchedule({ ...schedule, close })}
        />

        {/* What is actually armed on the server, not what is typed in the fields. */}
        <p className={styles['notice']}>{scheduleSummary(event, t)}</p>

        {scheduleFailure === null ? null : (
          <p className={styles['failure']} role="alert">
            <span className={styles['failureGlyph']}>
              <StatusIcon tone="danger" />
            </span>
            {scheduleFailure}
          </p>
        )}

        <div className={styles['actions']}>
          <Button type="submit" variant="primary" loading={saveSchedule.busy} disabled={readOnly}>
            {t.admin.scheduleSave}
          </Button>
        </div>
      </form>
    </div>
  )
}
