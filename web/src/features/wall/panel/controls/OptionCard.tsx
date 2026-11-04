import { useId } from 'react'
import { OptionArt, type OptionArtName } from './OptionArt'
import styles from './controls.module.css'

export interface OptionCardProps {
  readonly art: OptionArtName
  readonly label: string
  readonly hint?: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

/**
 * A yes/no option with a picture of what it does on the wall. A real checkbox in a label, drawn as
 * a switch: the card is the target, the name is the label, and the hint describes without renaming.
 */
export function OptionCard({
  art,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: OptionCardProps) {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <label className={styles['card']}>
      <OptionArt name={art} />
      <span className={styles['cardText']}>
        <strong id={`${id}-label`}>{label}</strong>
        {hint === undefined ? null : <small id={hintId}>{hint}</small>}
      </span>
      <input
        type="checkbox"
        className={styles['switch']}
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}
