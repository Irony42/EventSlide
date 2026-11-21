import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { DateTimeField } from '../../../design-system/components/DateTimeField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField, type SelectOption } from '../../../design-system/components/SelectField'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import { ApiError } from '../../../lib/http'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../../../lib/i18n/locale'
import { messageForError } from '../../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { browserTimeZone, timeZoneOptions, zoneName } from '../../../lib/invite/timeZones'
import { useApi } from '../../../lib/useApi'
import {
  fieldOfCode,
  formFromInvite,
  inputFromForm,
  lineCount,
  type FormField,
  type InvitationForm,
} from './invitationFormModel'
import styles from './InvitationsPage.module.css'

/** The word and the title are bounded by the server; the form shows the limit and the server holds it. */
const MESSAGE_MAX = 500
const MESSAGE_ROWS = 8
const ADDRESS_ROWS = 2
const TITLE_MAX = 80
const VENUE_MAX = 80
const ADDRESS_MAX = 160

const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/** What went wrong, and under which field it is shown (`null`: it is about none, and the summary says it). */
interface Problem {
  readonly field: FormField | null
  readonly message: string
}

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
 * Every bound is the server's and comes back as a code the table words; an error is shown **under
 * its field** (which then says it is invalid) and the field is focused, and what is about no field
 * is said in the box above the button.
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
  const { locale } = useLocale()
  const api = useApi()
  const root = useRef<HTMLFormElement>(null)
  const [form, setForm] = useState<InvitationForm>(() =>
    formFromInvite(invite, browserTimeZone(), readerLanguage),
  )
  const [choosingZone, setChoosingZone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  // The first invalid field takes the focus, once the error is on screen (so it is announced there).
  useEffect(() => {
    if (problem?.field === null || problem === null) return
    root.current
      ?.querySelector<HTMLElement>(`[data-field="${problem.field}"] :is(input, textarea, select)`)
      ?.focus()
  }, [problem])

  const change = (patch: Partial<InvitationForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setSaved(false)
    setProblem(null)
  }

  const sentenceFor = (
    field: FormField,
    reason: 'nonexistentHour' | 'invalidTime' | 'tooManyLines',
  ) => {
    if (reason === 'nonexistentHour') return text.nonexistentHour
    if (reason === 'tooManyLines') {
      return field === 'address'
        ? t.errors['guestInvite.addressTooManyLines']
        : t.errors['guestInvite.messageTooManyLines']
    }
    return field === 'end'
      ? t.errors['guestInvite.endsAtInvalid']
      : t.errors['guestInvite.startsAtInvalid']
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Enter in a field submits again while a save is on its way: one request, not two.
    if (saving) return
    const built = inputFromForm(form)
    if (!built.ok) {
      setProblem({ field: built.field, message: sentenceFor(built.field, built.reason) })
      return
    }
    setSaving(true)
    setProblem(null)
    try {
      const answer = await api.saveGuestInvite(slug, built.input)
      setSaved(true)
      onSaved(answer.guestInvite)
    } catch (cause) {
      setProblem({
        field: cause instanceof ApiError ? fieldOfCode(cause.code) : null,
        message: messageForError(cause, t),
      })
    } finally {
      setSaving(false)
    }
  }

  /** The message under a field, when the problem is about it. */
  const errorOf = (field: FormField): string | undefined =>
    problem?.field === field ? problem.message : undefined

  return (
    <form
      ref={root}
      className={styles['panel']}
      onSubmit={submit}
      noValidate
      aria-labelledby="invite-form-title"
    >
      <h2 id="invite-form-title" className={styles['panelTitle']}>
        {text.formTitle}
      </h2>

      <div data-field="title">
        <Field
          label={text.titleLabel}
          hint={text.titleHint(eventName)}
          optional
          {...(errorOf('title') === undefined ? {} : { error: errorOf('title') as string })}
        >
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
      </div>

      <div className={styles['two']}>
        <div data-field="start">
          <DateTimeField
            label={text.startLabel}
            value={form.start}
            disabled={disabled}
            error={errorOf('start')}
            onChange={(start) => change({ start })}
          />
        </div>
        <div data-field="end">
          <DateTimeField
            label={text.endLabel}
            value={form.end}
            disabled={disabled}
            error={errorOf('end')}
            onChange={(end) => change({ end })}
          />
        </div>
      </div>
      <p className={styles['zone']}>
        {text.zoneLine(zoneName(form.timeZone, locale))}
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

      <div data-field="venueName">
        <Field
          label={text.venueLabel}
          optional
          {...(errorOf('venueName') === undefined ? {} : { error: errorOf('venueName') as string })}
        >
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
      </div>
      <div data-field="address">
        <Field
          label={text.addressLabel}
          hint={text.addressHint}
          optional
          {...(errorOf('address') === undefined ? {} : { error: errorOf('address') as string })}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={ADDRESS_ROWS}
              grow={false}
              value={form.address}
              maxLength={ADDRESS_MAX}
              disabled={disabled}
              onChange={(e) => change({ address: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Notice tone="warning" variant="inline">
        {text.addressWarning}
      </Notice>

      <div data-field="message">
        <Field
          label={text.messageLabel}
          hint={`${text.messageCount(form.message.length, MESSAGE_MAX)} · ${text.lineCount(lineCount(form.message), MESSAGE_ROWS)}`}
          optional
          {...(errorOf('message') === undefined ? {} : { error: errorOf('message') as string })}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={MESSAGE_ROWS}
              grow={false}
              value={form.message}
              maxLength={MESSAGE_MAX}
              disabled={disabled}
              onChange={(e) => change({ message: e.target.value })}
            />
          )}
        </Field>
      </div>

      <SelectField
        label={text.languageLabel}
        hint={text.languageHint}
        value={form.language}
        options={LANGUAGE_OPTIONS}
        disabled={disabled}
        onChange={(language) => change({ language })}
      />

      {problem === null || problem.field !== null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem.message}
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
