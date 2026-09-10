import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { useToast } from '../../design-system/components/ToastProvider'
import { fr } from '../../lib/i18n/fr'
import { LoadFailure, Pending } from './components/AsyncState'
import { CheckboxField } from './components/CheckboxField'
import { SelectField, type SelectOption } from './components/SelectField'
import { isMutable } from './eventLifecycle'
import { useEvent } from './hooks/useEventData'
import { useSaveSettings } from './hooks/useEventActions'
import styles from './EventSettingsPage.module.css'
import type { EventSettingsDto } from '../../lib/api/dto'

/** `null` in the DTO means "no limit"; the select uses the empty option for it. */
const NO_LIMIT = ''

const numberOrNull = (value: string): number | null =>
  value === NO_LIMIT ? null : Number.parseInt(value, 10)

const asOption = (value: number, label: string): SelectOption => ({ value: String(value), label })

const graceLabel = (seconds: number): string => {
  if (seconds === 0) return fr.admin.graceNone
  if (seconds < 60) return fr.admin.graceSeconds(seconds)
  if (seconds % 3600 === 0) return fr.admin.graceHours(seconds / 3600)
  return fr.admin.graceMinutes(Math.round(seconds / 60))
}

const GRACE_OPTIONS = [0, 60, 300, 900, 3600].map((seconds) =>
  asOption(seconds, graceLabel(seconds)),
)

const RETENTION_OPTIONS: readonly SelectOption[] = [
  { value: NO_LIMIT, label: fr.admin.retentionNever },
  ...[7, 30, 90, 365].map((days) => asOption(days, fr.admin.retentionDays(days))),
]

const MAX_PHOTOS_OPTIONS: readonly SelectOption[] = [
  { value: NO_LIMIT, label: fr.admin.maxPhotosUnlimited },
  ...[10, 25, 50, 100].map((count) => asOption(count, fr.admin.photos(count))),
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

/** Surface: the host's laptop, before the event rather than during it. */
export function EventSettingsPage() {
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const save = useSaveSettings()
  const toast = useToast()

  const [draft, setDraft] = useState<EventSettingsDto | null>(null)
  const [syncedFrom, setSyncedFrom] = useState<EventSettingsDto | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // The server's answer is the starting point, and it is also the answer to a save —
  // so the form always shows what is actually stored, never what was typed.
  //
  // Adjusted during render rather than in an effect. An effect would paint the stale
  // draft first and then immediately re-render with the new one, which on a slow laptop
  // is a visible flash of the previous event's settings after `replace()`. React's own
  // guidance for "reset state when a prop changes" is this comparison against the value
  // last synced from; `react-hooks/set-state-in-effect` rejects the effect form.
  if (event !== null && event.settings !== syncedFrom) {
    setSyncedFrom(event.settings)
    setDraft(event.settings)
  }

  if (loading) return <Pending label={fr.admin.eventLoading} />
  if (error !== null) return <LoadFailure message={error} onRetry={reload} as="h1" />
  if (event === null || draft === null) {
    return <LoadFailure message={fr.errors.unknown} onRetry={reload} as="h1" />
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
      toast.show(fr.admin.settingsSaved, { tone: 'success' })
    })
  }

  const grace = String(settings.guestSelfDeleteGraceSeconds)
  const retention = settings.retentionDays === null ? NO_LIMIT : String(settings.retentionDays)
  const maxPhotos =
    settings.maxPhotosPerGuest === null ? NO_LIMIT : String(settings.maxPhotosPerGuest)

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{fr.admin.settings}</h1>
      <p>
        <Link to={`/admin/events/${event.slug}`}>{event.name}</Link>
      </p>

      {readOnly ? <p className={styles['notice']}>{fr.admin.settingsReadOnly}</p> : null}

      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
        <fieldset className={styles['group']}>
          <legend className={styles['legend']}>{fr.admin.moderationMode}</legend>
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
              {mode === 'manual' ? fr.admin.moderationManual : fr.admin.moderationAuto}
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
              {fr.admin.moderationAutoWarning}
            </p>
          ) : null}
        </div>

        <CheckboxField
          label={fr.admin.allowCaptions}
          checked={settings.allowCaptions}
          disabled={readOnly}
          onChange={(allowCaptions) => update({ allowCaptions })}
        />

        <CheckboxField
          label={fr.admin.allowReactions}
          checked={settings.allowReactions}
          disabled={readOnly}
          onChange={(allowReactions) => update({ allowReactions })}
        />

        <CheckboxField
          label={fr.admin.allowGuestSelfDelete}
          checked={settings.allowGuestSelfDelete}
          disabled={readOnly}
          onChange={(allowGuestSelfDelete) => update({ allowGuestSelfDelete })}
        />

        <SelectField
          label={fr.admin.selfDeleteGrace}
          hint={fr.admin.selfDeleteGraceHint}
          value={grace}
          options={withCurrent(GRACE_OPTIONS, grace, graceLabel)}
          disabled={readOnly || !settings.allowGuestSelfDelete}
          onChange={(value) => update({ guestSelfDeleteGraceSeconds: Number.parseInt(value, 10) })}
        />

        <SelectField
          label={fr.admin.retention}
          hint={fr.admin.retentionHint}
          value={retention}
          options={withCurrent(RETENTION_OPTIONS, retention, fr.admin.retentionDays)}
          disabled={readOnly}
          onChange={(value) => update({ retentionDays: numberOrNull(value) })}
        />

        <SelectField
          label={fr.admin.maxPhotosPerGuest}
          value={maxPhotos}
          options={withCurrent(MAX_PHOTOS_OPTIONS, maxPhotos, fr.admin.photos)}
          disabled={readOnly}
          onChange={(value) => update({ maxPhotosPerGuest: numberOrNull(value) })}
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
            {fr.app.save}
          </Button>
        </div>
      </form>
    </div>
  )
}
