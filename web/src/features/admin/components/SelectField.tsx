import { Field } from '../../../design-system/components/Field'
import styles from './SelectField.module.css'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectFieldProps {
  readonly label: string
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly onChange: (value: string) => void
  readonly hint?: string
  readonly disabled?: boolean
}

/**
 * One setting chosen from a list.
 *
 * A closed set rather than a number box on purpose: the acceptable range for a
 * retention delay or a per-guest cap is the server's, published nowhere the client can
 * read, so a free-text number would mean restating bounds here and drifting from them.
 * Every option offered is one the server accepts.
 *
 * `Field` owns the label, the hint and the id wiring, so the label always points at
 * this control.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  disabled = false,
}: SelectFieldProps) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <select
          {...control}
          className={styles['select']}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}
