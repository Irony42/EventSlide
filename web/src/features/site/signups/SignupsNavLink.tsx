import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { usePendingSignups } from './pendingSignupsContext'

export interface SignupsNavLinkProps {
  readonly className: string
  readonly current: boolean
  /**
   * Whether the count may be asked for: the console's second-factor gate is satisfied. Before that
   * every `/api/site` route answers 403, so the entry is shown without a number and asks nothing;
   * it counts as soon as the gate opens.
   */
  readonly counted: boolean
}

/**
 * The console's "Signups" entry, with the number of requests waiting for an operator: « Inscriptions
 * (2) ».
 *
 * Mounted only on a box where signing up is on. The layout stays mounted from one console page to
 * the next, so the count is read once, and again only when a page settles a request (`refresh`).
 * A failed read shows the entry without a number: the page behind it says what went wrong.
 */
export function SignupsNavLink({ className, current, counted }: SignupsNavLinkProps) {
  return counted ? (
    <Counted className={className} current={current} />
  ) : (
    <Entry className={className} current={current} waiting={0} />
  )
}

function Counted({ className, current }: Omit<SignupsNavLinkProps, 'counted'>) {
  const api = useApi()
  const { stamp } = usePendingSignups()
  const load = useCallback(
    (signal: AbortSignal) => {
      void stamp
      return api.siteSignups('pending', { limit: 1 }, signal)
    },
    [api, stamp],
  )
  const { data } = useLoader(load)
  return <Entry className={className} current={current} waiting={data?.pendingCount ?? 0} />
}

function Entry({
  className,
  current,
  waiting,
}: Omit<SignupsNavLinkProps, 'counted'> & { readonly waiting: number }) {
  const t = useTranslations()
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
