import { useParams } from 'react-router-dom'
import { EmptyState } from '../design-system/components/EmptyState'
import { fr } from '../lib/i18n/fr'

/**
 * Route stand-ins.
 *
 * The router is wired to the real URL set from docs/API.md now, so the shape of the
 * app is fixed before the screens exist and no feature invents its own path. Each
 * placeholder names the feature folder that replaces it; that folder's author swaps
 * the import in `router.tsx` and deletes the placeholder.
 *
 * Every one of them is a real `EmptyState` rather than the word "TODO", because an
 * unfinished route still has to be legible if somebody opens it during a demo.
 */

const Placeholder = ({ title }: { readonly title: string }) => (
  <EmptyState as="h1" title={title} description={fr.shell.comingSoon} />
)

// TODO(feature): replace with features/guest-join/GuestJoinPage.
export function GuestJoinPlaceholder() {
  return <Placeholder title={fr.join.title} />
}

// TODO(feature): replace with features/guest-upload/GuestUploadPage.
export function GuestUploadPlaceholder() {
  return <Placeholder title={fr.upload.title} />
}

// TODO(feature): replace with features/display/WallPage.
export function WallPlaceholder() {
  return <Placeholder title={fr.wall.empty} />
}

// TODO(feature): replace with features/auth/LoginPage.
export function LoginPlaceholder() {
  return <Placeholder title={fr.auth.title} />
}

// TODO(feature): replace with features/auth/ChangePasswordPage.
export function ChangePasswordPlaceholder() {
  return <Placeholder title={fr.auth.changePassword} />
}

// TODO(feature): replace with features/admin-dashboard/DashboardPage.
export function AdminDashboardPlaceholder() {
  return <Placeholder title={fr.admin.events} />
}

// TODO(feature): replace with features/admin-event/CreateEventPage.
export function EventCreatePlaceholder() {
  return <Placeholder title={fr.admin.newEvent} />
}

// TODO(feature): replace with features/admin-event/EventDetailPage.
export function EventDetailPlaceholder() {
  const { slug } = useParams()
  // The slug is echoed so it is obvious which event the route resolved to — the 1.0
  // QR bug was exactly a route that silently resolved to the wrong event.
  return <Placeholder title={slug ?? fr.admin.title} />
}

// TODO(feature): replace with features/moderation/ModerationPage.
export function ModerationPlaceholder() {
  return <Placeholder title={fr.moderation.title} />
}

// TODO(feature): replace with features/admin-event/EventSettingsPage.
export function EventSettingsPlaceholder() {
  return <Placeholder title={fr.admin.settings} />
}
