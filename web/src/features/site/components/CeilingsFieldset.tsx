import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { CheckboxField } from '../adminShared'
import type { CeilingField, CeilingFields } from '../ceilingsForm'
import styles from './CeilingsFieldset.module.css'

export interface CeilingsFieldsetProps {
  readonly fields: CeilingFields
  readonly onChange: (fields: CeilingFields) => void
  /** The text boxes whose content is not a number, named by the form model. */
  readonly invalid?: readonly CeilingField[]
  /** The "renew the period" switch: it moves a client's period, and a new client has none. */
  readonly renewable?: boolean
  readonly disabled?: boolean
}

type TextField = Exclude<CeilingField, 'clipsAllowed' | 'liveAllowed' | 'renewPeriod'>

/**
 * The nine ceilings of a client, as the console edits them.
 *
 * An empty box is "no ceiling", and says so beside the box rather than leaving the operator to
 * guess what blank means. A box that is not a number is refused here, by name; whether the number
 * is in bounds is the server's to say, with its own sentence, once it is sent.
 *
 * Surface: the operator's laptop; used by the form that opens a client and by the editor on a
 * client's own page.
 */
export function CeilingsFieldset({
  fields,
  onChange,
  invalid = [],
  renewable = false,
  disabled = false,
}: CeilingsFieldsetProps) {
  const t = useTranslations()

  const labels: Readonly<Record<TextField, string>> = {
    maxEvents: t.site.maxEvents,
    maxEventsPerPeriod: t.site.maxEventsPerPeriod,
    maxTotalGigabytes: t.site.maxTotalGigabytes,
    maxEventQuotaGigabytes: t.site.maxEventQuotaGigabytes,
    maxRetentionDays: t.site.maxRetentionDays,
    maxLiveDays: t.site.maxLiveDays,
  }
  const order: readonly TextField[] = [
    'maxEvents',
    'maxEventsPerPeriod',
    'maxTotalGigabytes',
    'maxEventQuotaGigabytes',
    'maxRetentionDays',
    'maxLiveDays',
  ]

  return (
    <fieldset className={styles['fieldset']} disabled={disabled}>
      <legend className={styles['legend']}>{t.site.ceilingsLegend}</legend>
      <div className={styles['grid']}>
        {order.map((name) => (
          <Field
            key={name}
            label={labels[name]}
            hint={t.site.emptyMeansNone}
            {...(invalid.includes(name) ? { error: t.site.notANumber } : {})}
          >
            {(control) => (
              <TextInput
                {...control}
                name={name}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={fields[name]}
                onChange={(event) => onChange({ ...fields, [name]: event.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      <CheckboxField
        label={t.site.clipsAllowed}
        checked={fields.clipsAllowed}
        onChange={(clipsAllowed) => onChange({ ...fields, clipsAllowed })}
      />
      <CheckboxField
        label={t.site.liveAllowed}
        checked={fields.liveAllowed}
        onChange={(liveAllowed) => onChange({ ...fields, liveAllowed })}
      />
      {renewable ? (
        <CheckboxField
          label={t.site.renewPeriod}
          hint={t.site.renewPeriodHint}
          checked={fields.renewPeriod}
          onChange={(renewPeriod) => onChange({ ...fields, renewPeriod })}
        />
      ) : null}
    </fieldset>
  )
}
