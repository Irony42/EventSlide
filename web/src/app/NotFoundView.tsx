import { Link } from 'react-router-dom'
import { EmptyState } from '../design-system/components/EmptyState'
import { useTranslations } from '../lib/i18n/useTranslations'

/**
 * The 404 view.
 *
 * 1.0 redirected every unmatched path to the guest upload page, so a host who mistyped
 * an admin URL landed on a guest screen with no explanation and assumed their event
 * had been deleted. An unknown address says so.
 *
 * It reads the active table, and on today's route table every reader of it gets their own
 * language: the catch-all lives under the host layout, which is now the reader's language
 * like the guest layout above it. The note this replaces said the catch-all resolved to
 * French and that this was wrong for a guest following a stale link; that half of the
 * problem is gone, and what is left is a width — a mistyped `/admin/…` and a stale
 * `/e/…` link are answered at host width and guest width respectively, which is what the
 * two `NotFoundView` routes under `GuestLayout` are for.
 */
export function NotFoundView() {
  const t = useTranslations()

  return (
    <EmptyState
      as="h1"
      title={t.shell.notFoundTitle}
      description={t.shell.notFoundHint}
      action={<Link to="/">{t.shell.notFoundHome}</Link>}
    />
  )
}
