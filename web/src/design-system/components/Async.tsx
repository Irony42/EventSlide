import type { ReactNode } from 'react'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { Button } from './Button'
import { EmptyState, type EmptyStateHeadingLevel } from './EmptyState'
import { Spinner } from './Spinner'
import styles from './Async.module.css'

export interface PendingProps {
  /** Said aloud, so a reader on a screen reader knows the screen is working. */
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
  /** The server's own verdict, in the language the reader is using. */
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
  const t = useTranslations()

  return (
    <EmptyState
      role="alert"
      as={as}
      title={t.app.loadFailed}
      description={message}
      action={
        <Button variant="primary" onClick={onRetry}>
          {t.app.retry}
        </Button>
      }
    />
  )
}

/**
 * What {@link Async} reads from a read: the four fields that decide which screen to show.
 * `LoaderState` has them and more, so a page hands its hook's result over as it is.
 */
export interface AsyncState<T> {
  /** `null` until the first answer arrives. Absence is not emptiness. */
  readonly data: T | null
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

export interface AsyncProps<T> {
  readonly state: AsyncState<T>
  /** What a screen reader hears while waiting. Defaults to the generic "loading". */
  readonly label?: string
  /**
   * What an answer that is an empty list shows. Without it the empty list is handed to
   * `children` like any other answer, for a screen that words its own emptiness.
   */
  readonly empty?: ReactNode
  /** Heading level of the failure, so the page it lands in keeps a correct outline. */
  readonly as?: EmptyStateHeadingLevel
  /** The answer, once there is one and nothing has gone wrong. */
  readonly children: (data: T) => ReactNode
}

/**
 * The four screens every read owes its reader, in the one order they are decided.
 *
 * 1. **Waiting**: a read is in flight. It wins over everything, so a refresh shows the wait
 *    and not the answer it is about to replace.
 * 2. **Failed**, with a retry: it wins over the data a failed refresh left behind, so a
 *    reader is told the refresh failed rather than shown a page that may be out of date.
 * 3. **Empty**: only an answer that is an empty *list*. `null` is "nothing has been asked
 *    yet" and is not empty, which is the confusion 1.0 made: an empty grid for all three,
 *    and a host with a projector waiting cannot tell a working screen from a broken one.
 * 4. **The answer**, handed to `children`.
 *
 * A read that is not waiting, has not failed and has no answer — which `useLoader` never
 * produces — renders nothing rather than a screen that claims something.
 *
 * This is the whole-area switch: a screen that must keep its page on show while a refresh
 * is in flight, or that shows a stale answer beside the failure, reads the same state
 * itself and uses {@link Pending} and {@link LoadFailure} directly.
 */
export function Async<T>({ state, label, empty, as = 'h2', children }: AsyncProps<T>) {
  const t = useTranslations()
  const { data, loading, error, reload } = state

  if (loading) return <Pending label={label ?? t.app.loading} />
  if (error !== null) return <LoadFailure message={error} onRetry={reload} as={as} />
  if (data === null) return null
  if (empty !== undefined && Array.isArray(data) && data.length === 0) return <>{empty}</>
  return <>{children(data)}</>
}
