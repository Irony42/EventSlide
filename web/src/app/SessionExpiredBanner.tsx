import { Link, useLocation } from 'react-router-dom'
import { Notice } from '../design-system/components/Notice'
import { useTranslations } from '../lib/i18n/useTranslations'
import { useSessionExpired } from './useSession'
import styles from './SessionExpiredBanner.module.css'

/**
 * "Your session has expired: sign in again", over a page that stays as it was.
 *
 * Surface: **the host and the moderator**, on `/admin/**`. A moderator at 21:00 whose session
 * ended used to be left on a 401 message with a Retry that could never work; a redirect to the
 * form would have lost the screen and any unsaved form. The banner keeps both and offers the
 * way back in.
 *
 * The link carries where the host is, path **and query**, in the navigation state under `from`:
 * that is the contract `RequireAuth` already uses and `LoginPage` already reads (`redirectTarget`),
 * so signing in returns them here, with the same filter and the same page of results.
 *
 * Mounted by `HostLayout` on the signed-in area only. It reads `useSessionExpired`, which
 * `SessionProvider` raises when any request is answered `401 auth.required`.
 */
export function SessionExpiredBanner() {
  const t = useTranslations()
  const expired = useSessionExpired()
  const { pathname, search } = useLocation()

  if (!expired) return null

  return (
    <div className={styles['banner']}>
      <Notice tone="warning" variant="boxed" role="alert">
        {t.shell.sessionExpired}{' '}
        <Link to="/login" state={{ from: `${pathname}${search}` }}>
          {t.shell.sessionExpiredAction}
        </Link>
      </Notice>
    </div>
  )
}
