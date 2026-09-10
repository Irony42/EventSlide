import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../../design-system/components/Spinner'
import { useSession } from '../../app/useSession'
import { fr } from '../../lib/i18n/fr'
import styles from './MustChangePasswordGate.module.css'

export const CHANGE_PASSWORD_PATH = '/admin/password'

export interface MustChangePasswordGateProps {
  /** Omit it to use the component as a layout route and render an `<Outlet />`. */
  readonly children?: ReactNode
}

/**
 * The second gate on `/admin/**`, inside `RequireAuth`.
 *
 * A moderator invited by a host arrives with a password somebody else chose and sent
 * them. Until they replace it, every admin address leads to one screen: an account
 * whose credentials have been through a third party must not be able to publish photos
 * to a room of two hundred people.
 *
 * A session that could not be *asked for* is not a session that must change its
 * password: the page renders. `RequireAuth` above already decides what an
 * unauthenticated or unreachable session means, and locking a host out of their own
 * console because one request failed mid-event would be the worse failure.
 */
export function MustChangePasswordGate({ children }: MustChangePasswordGateProps) {
  const { session, loading } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className={styles['pending']}>
        <Spinner size="lg" label={fr.shell.sessionChecking} />
      </div>
    )
  }

  const mustChange = session !== null && session.authenticated && session.user.mustChangePassword

  if (mustChange && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />
  }

  return children === undefined ? <Outlet /> : <>{children}</>
}
