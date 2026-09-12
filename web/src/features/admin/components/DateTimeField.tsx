import { Field } from '../../../design-system/components/Field'
import styles from './DateTimeField.module.css'

export interface DateTimeFieldProps {
  readonly label: string
  /** `YYYY-MM-DDTHH:mm` in the browser's own zone, or `''` for "not set". */
  readonly value: string
  readonly onChange: (value: string) => void
  readonly hint?: string
  /** Earliest offerable value, same `YYYY-MM-DDTHH:mm` shape. A guide, not a guard. */
  readonly min?: string
  readonly disabled?: boolean
}

/**
 * A date and a time, in the browser's own timezone.
 *
 * A native `datetime-local` rather than two selects or a hand-rolled picker: the host is
 * on a laptop, the platform control already knows their locale and their calendar, and
 * the value it yields is exactly the wall-clock string `../eventSchedule.ts` converts.
 *
 * Always optional — an empty field means "I will do this myself", which is the default
 * for every event — so `Field` marks it as such rather than leaving the host to guess
 * whether a blank is allowed.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  hint,
  min,
  disabled = false,
}: DateTimeFieldProps) {
  return (
    <Field label={label} optional {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <input
          {...control}
          type="datetime-local"
          className={styles['input']}
          value={value}
          // Narrows what the native picker offers. It is not the guard — the form is
          // `noValidate` and a host can still type an earlier value — so the server
          // refusal is what actually holds, and this only stops the obvious mistake
          // from being one click away.
          {...(min === undefined ? {} : { min })}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
