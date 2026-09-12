import { Button } from '../../../design-system/components/Button'
import {
  EmptyState,
  type EmptyStateHeadingLevel,
} from '../../../design-system/components/EmptyState'
import { Spinner } from '../../../design-system/components/Spinner'
import { fr } from '../../../lib/i18n/fr'
import styles from './AsyncState.module.css'

export interface PendingProps {
  /** Said aloud, so a host on a screen reader knows the screen is working. */
  readonly label: string
}

/** The wait. A `Spinner` with a label is already a `role="status"`. */
export function Pending({ label }: PendingProps) {
  return (
    <div className={styles['pending']}>
      <Spinner size="lg" label={label} />
    </div>
  )
}

export interface LoadFailureProps {
  /** The server's own verdict, in French. */
  readonly message: string
  readonly onRetry: () => void
  readonly as?: EmptyStateHeadingLevel
}

/**
 * The read failed.
 *
 * A named failure with a retry, never an empty list: those two are indistinguishable
 * on screen, and 1.0 rendered the same nothing for both — so a host with a projector
 * waiting reloaded, then rebooted.
 */
export function LoadFailure({ message, onRetry, as = 'h2' }: LoadFailureProps) {
  return (
    <EmptyState
      role="alert"
      as={as}
      title={fr.admin.loadFailed}
      description={message}
      action={
        <Button variant="primary" onClick={onRetry}>
          {fr.app.retry}
        </Button>
      }
    />
  )
}
