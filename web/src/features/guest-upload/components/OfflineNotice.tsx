import { Button } from '../../../design-system/components/Button'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { fr } from '../../../lib/i18n/fr'
import styles from './OfflineNotice.module.css'

/**
 * What the device is still holding, and the promise that it will be sent.
 *
 * The one place on the guest surface that survives a reload, a closed tab and a flat
 * evening of bad Wi-Fi: it reads the outbox rather than this session's upload rows, so
 * a guest who returns an hour later sees the same count they left behind.
 *
 * Rendered as a status region, not an alert. Nothing has gone wrong — the photos are
 * safe — and an `alert` would interrupt whatever a screen-reader user was doing to say
 * so.
 */

export interface OfflineNoticeProps {
  readonly waiting: number
  readonly draining: boolean
  readonly onSendNow: () => void
}

export function OfflineNotice({ waiting, draining, onSendNow }: OfflineNoticeProps) {
  // Rendered only when there is something to say. An empty reassurance sitting above
  // the picker all evening would be noise, and it would push the composer down.
  if (waiting === 0) return null

  return (
    <section className={styles['notice']} role="status" data-testid="offline-notice">
      {/* Wrapped rather than given a className: `styles[...]` is `string | undefined`
          under noUncheckedIndexedAccess, and StatusIcon's optional prop does not accept
          an explicit undefined under exactOptionalPropertyTypes. */}
      <span className={styles['icon']}>
        <StatusIcon tone="warning" />
      </span>

      <div className={styles['body']}>
        <p className={styles['title']} data-testid="offline-waiting">
          {fr.upload.offlineTitle(waiting)}
        </p>
        <p className={styles['hint']}>
          {draining ? fr.upload.offlineSending : fr.upload.offlineHint}
        </p>
      </div>

      {/* A guest who can see a bar of signal should not have to wait for the browser to
          agree. The drain is idempotent, so pressing it while offline costs nothing. */}
      <Button size="sm" variant="secondary" loading={draining} onClick={onSendNow}>
        {fr.upload.offlineRetry}
      </Button>
    </section>
  )
}
