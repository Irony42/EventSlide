import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { Bubble } from '../arrivals'
import { arrivalLabel } from '../arrivalLabel'
import styles from './NewPhotoSignal.module.css'

export interface NewPhotoSignalProps {
  readonly bubble: Bubble | null
}

/**
 * « Nouvelle photo ajoutée », top centre under the counter. Its own polite live region, mounted
 * once and distinct from the notices. A fade in, nothing else moves.
 */
export function NewPhotoSignal({ bubble }: NewPhotoSignalProps) {
  const text = useTranslations()

  return (
    <div className={styles['region']} aria-live="polite">
      {bubble === null ? null : (
        <p className={styles['signal']} data-testid="new-photo-signal">
          <span className={styles['dot']} aria-hidden="true" />
          {arrivalLabel(text, bubble)}
        </p>
      )}
    </div>
  )
}
