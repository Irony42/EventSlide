import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { GuestChallengeDto } from '../../../lib/api/dto'
import { useServerCountdown } from '../../../lib/useServerCountdown'
import styles from './ParticipateBox.module.css'

export interface ParticipateBoxProps {
  readonly challenge: GuestChallengeDto
  /** This phone's clock to the server's, from the last read of the checklist. */
  readonly offsetMs: number
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

/**
 * "Je participe au défi", above "Envoyer" while a challenge runs (spec 18).
 *
 * **Checked by default**: the common case is to play, and the one thumb that has just chosen a
 * photograph should not need a second tap to count it. Unchecked, the photograph goes as an
 * ordinary one. It is a native checkbox in a row at least a finger tall, and nothing animates.
 * It goes away, without a sound, when the countdown (against the server's clock) reaches zero,
 * and the page then sends the photographs plain.
 */
export function ParticipateBox({ challenge, offsetMs, checked, onChange }: ParticipateBoxProps) {
  const t = useTranslations()
  const { over } = useServerCountdown(challenge, offsetMs)

  if (over) return null

  return (
    <label className={styles['row']}>
      <input
        type="checkbox"
        className={styles['box']}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles['label']}>{t.challenge.participate}</span>
    </label>
  )
}
