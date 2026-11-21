import { useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { DateTimeField } from '../../../design-system/components/DateTimeField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField, type SelectOption } from '../../../design-system/components/SelectField'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../../../lib/i18n/locale'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { browserTimeZone, timeZoneOptions } from '../../../lib/invite/timeZones'
import { useApi } from '../../../lib/useApi'
import { formFromInvite, inputFromForm, type InvitationForm } from './invitationFormModel'
import styles from './InvitationsPage.module.css'

/** The word and the title are bounded by the server; the form shows the limit and the server holds it. */
const MESSAGE_MAX = 500
const TITLE_MAX = 80
const VENUE_MAX = 80
const ADDRESS_MAX = 160

const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

export interface InvitationFormProps {
  readonly slug: string
  readonly eventName: string
  readonly invite: GuestInviteDto
  /** The language the host is reading, for an invitation that has none yet. */
  readonly readerLanguage: string
  /** An archived event is a record: the form is read-only. */
  readonly disabled: boolean
  readonly onSaved: (invite: GuestInviteDto) => void
}

/**
 * "Le faire-part": the title, the moment, the place and the host's word, saved on the server.
 *
 * Surface: the host (the owner). The times are typed as a wall clock and **read in the invitation's
 * zone**, which is shown under them and changed only when the host chooses: it is taken from the
 * browser the first time and never again, so editing from another country does not move the hour.
 * Every bound is the server's and comes back as a code the table words.
 */
export function InvitationFormPanel({
  slug,
  eventName,
  invite,
  readerLanguage,
  disabled,
  onSaved,
}: InvitationFormProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const api = useApi()
  const [form, setForm] = useState<InvitationForm>(() =>
    formFromInvite(invite, browserTimeZone(), readerLanguage),
  )
  const [choosingZone, setChoosingZone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const change = (patch: Partial<InvitationForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setSaved(false)
    setProblem(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const built = inputFromForm(form)
    if (!built.ok) {
      setProblem(built.reason === 'nonexistentHour' ? text.nonexistentHour : t.errors.unknown)
      return
    }
    setSaving(true)
    setProblem(null)
    try {
      const answer = await api.saveGuestInvite(slug, built.input)
      setSaved(true)
      onSaved(answer.guestInvite)
    } catch (cause) {
      setProblem(messageForError(cause, t))
    } finally {
      setSaving(false)
    }
  }

  const place = (form.timeZone.split('/').pop() ?? form.timeZone).replace(/_/g, ' ')

  return (
    <form
      className={styles['panel']}
      onSubmit={submit}
      noValidate
      aria-labelledby="invite-form-title"
    >
      <h2 id="invite-form-title" className={styles['panelTitle']}>
        {text.formTitle}
      </h2>

      <Field label={text.titleLabel} hint={text.titleHint(eventName)} optional>
        {(control) => (
          <TextInput
            {...control}
            value={form.title}
            maxLength={TITLE_MAX}
            disabled={disabled}
            onChange={(e) => change({ title: e.target.value })}
          />
        )}
      </Field>

      <div className={styles['two']}>
        <DateTimeField
          label={text.startLabel}
          value={form.start}
          disabled={disabled}
          onChange={(start) => change({ start })}
        />
        <DateTimeField
          label={text.endLabel}
          value={form.end}
          disabled={disabled}
          onChange={(end) => change({ end })}
        />
      </div>
      <p className={styles['zone']}>
        {text.zoneLine(place)}
        {' · '}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled}
          aria-expanded={choosingZone}
          onClick={() => setChoosingZone((open) => !open)}
        >
          {text.zoneChange}
        </button>
      </p>
      {choosingZone ? (
        <SelectField
          label={text.zoneLabel}
          hint={text.zoneHint}
          value={form.timeZone}
          disabled={disabled}
          options={timeZoneOptions(form.timeZone).map((zone) => ({ value: zone, label: zone }))}
          onChange={(timeZone) => change({ timeZone })}
        />
      ) : null}

      <Field label={text.venueLabel} optional>
        {(control) => (
          <TextInput
            {...control}
            value={form.venueName}
            maxLength={VENUE_MAX}
            disabled={disabled}
            onChange={(e) => change({ venueName: e.target.value })}
          />
        )}
      </Field>
      <Field label={text.addressLabel} hint={text.addressHint} optional>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={form.address}
            maxLength={ADDRESS_MAX}
            disabled={disabled}
            onChange={(e) => change({ address: e.target.value })}
          />
        )}
      </Field>
      <Notice tone="warning" variant="inline">
        {text.addressWarning}
      </Notice>

      <Field
        label={text.messageLabel}
        hint={text.messageCount(form.message.length, MESSAGE_MAX)}
        optional
      >
        {(control) => (
          <Textarea
            {...control}
            rows={5}
            value={form.message}
            maxLength={MESSAGE_MAX}
            disabled={disabled}
            onChange={(e) => change({ message: e.target.value })}
          />
        )}
      </Field>

      <SelectField
        label={text.languageLabel}
        hint={text.languageHint}
        value={form.language}
        options={LANGUAGE_OPTIONS}
        disabled={disabled}
        onChange={(language) => change({ language })}
      />

      {problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem}
        </Notice>
      )}
      <div className={styles['row']}>
        <Button type="submit" variant="primary" loading={saving} disabled={disabled}>
          {text.save}
        </Button>
        {saved ? (
          <span role="status" className={styles['saved']}>
            {text.saved}
          </span>
        ) : null}
      </div>
    </form>
  )
}
