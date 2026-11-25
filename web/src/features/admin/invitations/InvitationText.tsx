import { useState } from 'react'
import { DateTimeField } from '../../../design-system/components/DateTimeField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField, type SelectOption } from '../../../design-system/components/SelectField'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { timeZoneOptions, zoneName } from '../../../lib/invite/timeZones'
import { Button } from '../../../design-system/components/Button'
import { Disclosure } from './Disclosure'
import { lineCount, type FormField, type InvitationForm } from './invitationFormModel'
import type { InvitationProblem, InvitationSaveState } from './useInvitationAutosave'
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

export interface InvitationTextProps {
  readonly eventName: string
  readonly form: InvitationForm
  readonly onChange: (patch: Partial<InvitationForm>) => void
  readonly problem: InvitationProblem | null
  /** An archived event is a record: the form is read-only. */
  readonly disabled: boolean
}

/**
 * "Le texte": the title, the moment, the place and the host's word, common to every format, saved
 * as it is typed (`useInvitationAutosave`) and on every preview at once.
 *
 * Surface: the host (the owner). The times are typed as a wall clock and **read in the invitation's
 * zone**, which is shown under them and changed only when the host chooses: it is taken from the
 * browser the first time and never again, so editing from another country does not move the hour.
 * Every bound is the server's and comes back as a code the table words; an error is shown **under
 * its field** (which then says it is invalid), and what is about no field is said in the box
 * under the form, with a way to try again.
 */
export function InvitationText({
  eventName,
  form,
  onChange: change,
  problem,
  disabled,
}: InvitationTextProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const { locale } = useLocale()
  const [choosingZone, setChoosingZone] = useState(false)
  /** What the folded group holds: the words that are filled, and the language that is always set. */
  const moreSummary = [
    form.address.trim() === '' ? null : text.moreAddress,
    form.message.trim() === '' ? null : text.moreMessage,
    LOCALE_NAMES[form.language as keyof typeof LOCALE_NAMES] ?? form.language,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')

  /** The message under a field, when the problem is about it. */
  const errorOf = (field: FormField): string | undefined =>
    problem?.field === field ? problem.message : undefined

  return (
    <form
      className={styles['formPanel']}
      onSubmit={(e) => e.preventDefault()}
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
        {'\u00a0·\u00a0'}
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
      <Disclosure
        id="more"
        title={text.moreTitle}
        summary={moreSummary}
        forceOpen={problem?.field === 'address' || problem?.field === 'message'}
      >
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
      </Disclosure>
    </form>
  )
}

export interface InvitationSaveStatusProps {
  readonly state: InvitationSaveState
  readonly problem: InvitationProblem | null
  readonly onRetry: () => void
}

/**
 * The one save indicator of the invitation's text, at the foot of the column or of the panel that
 * is open: "Enregistrement…" then "Enregistré" (a polite live region), the refusal of the whole
 * when it is about no field, and a way to try again.
 */
export function InvitationSaveStatus({ state, problem, onRetry }: InvitationSaveStatusProps) {
  const text = useTranslations().guestInvite.host
  return (
    <div className={styles['saveBlock']}>
      <div className={styles['saveLine']} role="status" aria-live="polite" data-state={state}>
        {state === 'pending' || state === 'saving'
          ? text.saving
          : state === 'saved'
            ? text.savedAuto
            : state === 'failed' || state === 'invalid'
              ? text.saveFailed
              : null}
      </div>
      {problem === null || problem.field !== null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem.message}
        </Notice>
      )}
      {state === 'failed' ? (
        <Button size="sm" onClick={onRetry}>
          {text.saveRetry}
        </Button>
      ) : null}
    </div>
  )
}
