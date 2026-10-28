import { Link } from 'react-router-dom'
import { EmptyState } from '../design-system/components/EmptyState'
import { useTranslations } from '../lib/i18n/useTranslations'
import { useSession } from './useSession'

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
 *
 * **This one is the guest's**: it offers the guest's start and asks the server nothing, so a
 * guest on a dead link pays no request for it. Under the host layout use {@link HostNotFoundView}.
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

/**
 * The 404 under the host layout, which knows who is looking.
 *
 * A signed-in host or moderator is offered **their** home, `/admin`: "back to the start" is the
 * guest's join screen, and a host who mistyped an address took it for the loss of their event
 * (navigation pass H4). Anybody else, and anybody while the answer is still on its way or could
 * not be had, is offered the guest's start exactly as before.
 *
 * The one request it makes is `GET /api/auth/me`, shared with the account menu and the gate when
 * the address is under `/admin`, so it is free there. It lives on the host layout only: the
 * guest layout's own dead ends (`/join/*`, `/e/*`, `/g/*`) use {@link NotFoundView} and never ask.
 * A guest on some other unmatched address (a card printed against an older shape) lands here and
 * does pay that one small request; the guest screens themselves pay none.
 */
export function HostNotFoundView() {
  const t = useTranslations()
  const { session } = useSession()
  const signedIn = session?.authenticated === true

  return (
    <EmptyState
      as="h1"
      title={t.shell.notFoundTitle}
      description={t.shell.notFoundHint}
      action={
        signedIn ? (
          <Link to="/admin">{t.shell.hostHome}</Link>
        ) : (
          <Link to="/">{t.shell.notFoundHome}</Link>
        )
      }
    />
  )
}
