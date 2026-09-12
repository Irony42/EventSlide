import { useId, type ReactNode } from 'react'
import { StatusIcon } from './StatusIcon'
import { fr } from '../../lib/i18n/fr'
import styles from './Field.module.css'

/**
 * The attributes the control must carry, ready to spread.
 *
 * Handing the caller a bag of attributes rather than cloning its child keeps the
 * control a plain `<input>` the caller still owns: 1.0 wired ids by hand and half the
 * inputs ended up with a `<label>` that pointed at nothing.
 */
export interface FieldControlProps {
  readonly id: string
  readonly 'aria-describedby'?: string
  readonly 'aria-invalid'?: boolean
}

export interface FieldProps {
  readonly label: string
  /** Format, limits, or what the value is used for. Read before the guest types. */
  readonly hint?: string
  /** Present means invalid: it drives both `aria-invalid` and the visible message. */
  readonly error?: string
  /** Marks the field as skippable. A guest's display name genuinely is. */
  readonly optional?: boolean
  readonly className?: string
  readonly children: (control: FieldControlProps) => ReactNode
}

/**
 * Label + control + hint + error, with the id wiring done once.
 *
 * A placeholder is never a label: it disappears on the first keystroke, is invisible
 * to a screen reader as a name, and fails contrast on every phone in sunlight.
 */
export function Field({ label, hint, error, optional = false, className, children }: FieldProps) {
  const generated = useId()
  const hintId = `${generated}-hint`
  const errorId = `${generated}-error`

  // Hint first, then the error: the format is context for the correction that follows.
  const describedBy = [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
    .filter(Boolean)
    .join(' ')

  const control: FieldControlProps = {
    id: generated,
    ...(describedBy.length > 0 ? { 'aria-describedby': describedBy } : {}),
    ...(error === undefined ? {} : { 'aria-invalid': true }),
  }

  const classes = [styles['field'], className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <label className={styles['label']} htmlFor={generated}>
        {label}
        {optional ? <span className={styles['optional']}>{fr.ui.optional}</span> : null}
      </label>
      {children(control)}
      {hint === undefined ? null : (
        <p className={styles['hint']} id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        // role="alert" so a validation failure is announced when it appears, without
        // the guest having to move focus back into the field to discover it.
        <p className={styles['error']} id={errorId} role="alert">
          <StatusIcon tone="danger" />
          {error}
        </p>
      )}
    </div>
  )
}
