import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../../design-system/components/Spinner'
import { useSession } from '../../app/useSession'
import { hereAsFrom } from '../../lib/landing'
import { useTranslations } from '../../lib/i18n/useTranslations'
import styles from './MustChangePasswordGate.module.css'

export const CHANGE_PASSWORD_PATH = '/admin/password'

export interface MustChangePasswordGateProps {
  /** Omit it to use the component as a layout route and render an `<Outlet />`. */
  readonly children?: ReactNode
}

/**
 * The second gate on `/admin/**`, inside `RequireAuth`.
 *
 * An account with `mustChangePassword` set — the owner a box creates from
 * `BOOTSTRAP_OWNER_PASSWORD`, a password that sits in a deployment manifest and in shell
 * history — has to replace it first. Until it does, every admin address leads to one
 * screen: an account whose credentials have been through a third party must not be able
 * to publish photos to a room of two hundred people. The server refuses every other route
 * the same way (`auth.passwordChangeRequired`); this is the screen that says why.
 *
 * A session that could not be *asked for* is not a session that must change its
 * password: the page renders. `RequireAuth` above already decides what an
 * unauthenticated or unreachable session means, and locking a host out of their own
 * console because one request failed mid-event would be the worse failure.
 */
export function MustChangePasswordGate({ children }: MustChangePasswordGateProps) {
  const t = useTranslations()
  const { session, loading } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className={styles['pending']}>
        <Spinner size="lg" label={t.shell.sessionChecking} />
      </div>
    )
  }

  const mustChange = session !== null && session.authenticated && session.user.mustChangePassword

  if (mustChange && location.pathname !== CHANGE_PASSWORD_PATH) {
    // Where they were going rides along, so choosing the password returns them there.
    return <Navigate to={CHANGE_PASSWORD_PATH} replace state={{ from: hereAsFrom(location) }} />
  }

  return children === undefined ? <Outlet /> : <>{children}</>
}
