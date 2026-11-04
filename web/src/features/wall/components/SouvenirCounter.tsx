import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './SouvenirCounter.module.css'

export interface SouvenirCounterProps {
  /** The server's total of souvenirs visible on the wall (spec 11), never `items.length`. */
  readonly count: number
}

/**
 * « 17 souvenirs partagés », top centre. Hidden at zero, where the empty wall already has its
 * own words. The value changes at once: no count-up, no pulse, so it moves nothing in the room.
 * Deliberately outside every `aria-live` region, which would announce each photograph.
 */
export function SouvenirCounter({ count }: SouvenirCounterProps) {
  const text = useTranslations()
  if (count <= 0) return null

  return (
    <p className={styles['counter']} data-testid="souvenir-counter">
      {text.wall.souvenirCount(count)}
    </p>
  )
}
