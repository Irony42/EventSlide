import { useId } from 'react'
import { Icon } from './Icon'
import styles from './ChoiceChips.module.css'

export interface ChoiceChip {
  readonly value: string
  readonly label: string
}

export interface ChoiceChipsProps {
  readonly legend: string
  readonly options: readonly ChoiceChip[]
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

/**
 * One choice among a few, as chips: a real radio group, with the inputs hidden and the ring drawn
 * on the chip around them. The chosen chip carries a check glyph and a tinted ground, so the
 * choice never rests on a colour alone. The names are the options' own words, read by role.
 */
export function ChoiceChips({
  legend,
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceChipsProps) {
  const name = useId()

  return (
    <fieldset className={styles['group']} disabled={disabled}>
      <legend className={styles['legend']}>{legend}</legend>
      <div className={styles['chips']}>
        {options.map((option) => (
          <label key={option.value} className={styles['chip']}>
            <input
              type="radio"
              className={styles['input']}
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <Icon name="check" size="sm" className={styles['check']} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
