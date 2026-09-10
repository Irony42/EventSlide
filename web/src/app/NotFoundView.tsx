import { Link } from 'react-router-dom'
import { EmptyState } from '../design-system/components/EmptyState'
import { fr } from '../lib/i18n/fr'

/**
 * The 404 view.
 *
 * 1.0 redirected every unmatched path to the guest upload page, so a host who mistyped
 * an admin URL landed on a guest screen with no explanation and assumed their event
 * had been deleted. An unknown address says so.
 */
export function NotFoundView() {
  return (
    <EmptyState
      as="h1"
      title={fr.shell.notFoundTitle}
      description={fr.shell.notFoundHint}
      action={<Link to="/">{fr.shell.notFoundHome}</Link>}
    />
  )
}
