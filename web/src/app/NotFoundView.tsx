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
 * It reads the active table rather than the French one, and on today's route table that
 * resolves to French: the catch-all lives under the host layout, which is a
 * `FrenchSurface`. That is the right default for a mistyped `/admin/...`, and it is the
 * wrong one for a guest following a stale link — moving the catch-all is a route-shape
 * change this point did not ask for, so it is written down here instead of done.
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
