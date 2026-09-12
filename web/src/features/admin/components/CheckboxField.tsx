import { useId } from 'react'
import styles from './CheckboxField.module.css'

export interface CheckboxFieldProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly hint?: string
  readonly disabled?: boolean
}

/**
 * One boolean setting.
 *
 * The design system has no checkbox primitive, and adding one is not this feature's
 * call — so this stays here, in the only folder that has boolean settings. It is a
 * real `<input type="checkbox">` inside its own `<label>`, which is what makes the
 * whole row clickable and keeps the space bar working without a keydown handler.
 */
export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: CheckboxFieldProps) {
  const hintId = `${useId()}-hint`

  return (
    <div className={styles['field']}>
      <label className={styles['row']}>
        <input
          type="checkbox"
          className={styles['box']}
          checked={checked}
          disabled={disabled}
          // The hint is described, not named: folding it into the label would make a
          // screen reader read the whole sentence every time focus lands on the box.
          {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles['label']}>{label}</span>
      </label>
      {hint === undefined ? null : (
        <p className={styles['hint']} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}
