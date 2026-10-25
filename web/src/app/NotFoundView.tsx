import { Link } from 'react-router-dom'
import { EmptyState } from '../design-system/components/EmptyState'
import { useTranslations } from '../lib/i18n/useTranslations'

/**
 * The 404 view.
 *
 * An unknown address says so, instead of landing on another screen: a host who mistyped an
 * admin URL would take a guest screen for the loss of their event.
 *
 * It reads the active table, so every reader gets their own language: the catch-all lives
 * under the host layout, which takes the reader's language like the guest layout does.
 * What differs is the width — a mistyped `/admin/…` and a stale `/e/…` link are answered at
 * host width and guest width respectively, which is what the `NotFoundView` routes under
 * `GuestLayout` (`/join/*`, `/e/*`, `/g/*`) are for.
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
