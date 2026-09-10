import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Button } from '../design-system/components/Button'
import { EmptyState } from '../design-system/components/EmptyState'
import { Spinner } from '../design-system/components/Spinner'
import { fr } from '../lib/i18n/fr'
import { useSession } from './useSession'
import styles from './RequireAuth.module.css'

export interface RequireAuthProps {
  /** Omit it to use the component as a layout route and render an `<Outlet />`. */
  readonly children?: ReactNode
}

/**
 * The gate in front of `/admin/**`.
 *
 * While the session is resolving it renders a wait, never the protected page: a flash
 * of the moderation console followed by a redirect is both a privacy leak in a room
 * where the laptop is on a table and a guaranteed double-fetch of the queue.
 *
 * A failure to *ask* is not a failure to authenticate. The retry keeps the host on the
 * page instead of bouncing them to the login form and making them find their password
 * at a wedding.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { session, loading, error, refresh } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className={styles['pending']}>
        <Spinner size="lg" label={fr.shell.sessionChecking} />
      </div>
    )
  }

  if (error !== null) {
    return (
      <EmptyState
        as="h1"
        title={fr.shell.crashTitle}
        description={fr.shell.sessionFailed}
        action={
          <Button variant="primary" onClick={refresh}>
            {fr.app.retry}
          </Button>
        }
      />
    )
  }

  if (session === null || !session.authenticated) {
    // `state` carries where the host was going, so the login form can return them
    // there instead of dropping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children === undefined ? <Outlet /> : <>{children}</>
}
