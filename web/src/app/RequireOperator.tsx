import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { Spinner } from '../design-system/components/Spinner'
import { useTranslations } from '../lib/i18n/useTranslations'
import { useSession } from './useSession'
import styles from './RequireAuth.module.css'

export interface RequireOperatorProps {
  /**
   * What an account that does not operate the box is shown: the not-found screen, so that the
   * console's address answers a stranger exactly as an address nobody wrote does, and says
   * nothing about there being a console behind it.
   */
  readonly fallback: ReactNode
}

/**
 * The gate in front of `/admin/site`, inside `RequireAuth`.
 *
 * It asks one question of the shared session: **may this account operate the box**
 * (`canOperateSite` on `GET /api/auth/me`, read from storage on that request, so an account
 * demoted since it signed in stops being offered the console on its next read). It grants nothing:
 * every route under `/api/site` is judged by the server's own gate (`requireOperator`) and a
 * client that skipped this one would meet `403 auth.forbidden` on every read. What this gate is
 * for is not **showing** a console to somebody who cannot use it.
 *
 * The routes are registered only where the box has a console (`features.siteAdmin`), which is a
 * different question and a different place: the two flags answer different things, and the
 * operator of a box with `SITE_ADMIN=off` still reads `canOperateSite: true` (docs/API.md §5).
 * Neither is an authorisation; both only decide what to offer.
 */
export function RequireOperator({ fallback }: RequireOperatorProps) {
  const t = useTranslations()
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className={styles['pending']}>
        <Spinner size="lg" label={t.shell.sessionChecking} />
      </div>
    )
  }

  if (session === null || !session.authenticated || !session.user.canOperateSite) {
    return <>{fallback}</>
  }

  return <Outlet />
}
