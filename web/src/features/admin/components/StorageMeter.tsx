import { Progress, type ProgressTone } from '../../../design-system/components/Progress'
import { formatBytes } from '../../../lib/format'
import { fr } from '../../../lib/i18n/fr'
import styles from './StorageMeter.module.css'

export interface StorageMeterProps {
  readonly usedBytes: number
  /**
   * `null` when the answer did not carry one: `GET /api/events` returns summaries
   * without a quota, and inventing a ceiling client-side would draw a bar that means
   * nothing. The figure alone is still useful; the bar waits for a real maximum.
   */
  readonly quotaBytes: number | null
}

/**
 * How full the album is.
 *
 * The colour is presentation only — the server enforces the quota and stops accepting
 * uploads on its own (`event.quotaExceeded`). It is there so a host glancing at the
 * dashboard sees "nearly full" before the guests do, and it is never the only signal:
 * the figure below the bar says the same thing in words.
 */
const toneFor = (usedBytes: number, quotaBytes: number): ProgressTone => {
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.9) return 'warning'
  return 'accent'
}

export function StorageMeter({ usedBytes, quotaBytes }: StorageMeterProps) {
  const used = formatBytes(usedBytes)

  if (quotaBytes === null) {
    return <p className={styles['figure']}>{fr.admin.storage(used)}</p>
  }

  return (
    <div className={styles['meter']}>
      <Progress
        value={usedBytes}
        max={quotaBytes}
        label={fr.admin.storageLabel}
        tone={toneFor(usedBytes, quotaBytes)}
      />
      <p className={styles['figure']}>{fr.admin.storageUsed(used, formatBytes(quotaBytes))}</p>
    </div>
  )
}
