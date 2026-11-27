import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { usePendingSignups } from './pendingSignupsContext'

export interface SignupsNavLinkProps {
  readonly className: string
  readonly current: boolean
}

/**
 * The console's "Signups" entry, with the number of requests waiting for an operator: « Inscriptions
 * (2) ».
 *
 * Mounted only on a box where signing up is on, because it is the one entry that asks the server
 * something (`GET /api/site/signups?status=pending`, for the count). A failed read shows the entry
 * without a number rather than a refusal in the middle of the navigation: the page behind it says
 * what went wrong. Read again whenever the page behind it settles a request (`refresh`).
 */
export function SignupsNavLink({ className, current }: SignupsNavLinkProps) {
  const t = useTranslations()
  const api = useApi()
  const { stamp } = usePendingSignups()
  const load = useCallback(
    (signal: AbortSignal) => {
      void stamp
      return api.siteSignups('pending', signal)
    },
    [api, stamp],
  )
  const { data } = useLoader(load)
  const waiting = data?.pendingCount ?? 0

  return (
    <Link
      to="/admin/site/signups"
      className={className}
      {...(current ? { 'aria-current': 'page' as const } : {})}
    >
      {waiting > 0 ? t.siteSignups.navPending(waiting) : t.siteSignups.nav}
    </Link>
  )
}
