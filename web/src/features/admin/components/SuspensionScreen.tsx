import { EmptyState } from '../../../design-system/components/EmptyState'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ContactAction } from '../ceilingLevels'
import styles from './SuspensionScreen.module.css'

export interface SuspensionScreenProps {
  /** Where "contact your operator" leads, or `null` when the box published no address. */
  readonly contact: ContactAction | null
}

/**
 * What a member of a suspended client is told (G2-16 / P3-17; the operator's side of it is
 * `suspendClient`, G2-14 / P3-13).
 *
 * **Not a lock-out.** Suspension freezes writing and leaves reading: the dashboard, the photos
 * and the album export still work, so this is a screen that explains and not a wall in front of
 * the albums. It takes the place of what a suspended host can no longer do (the "new event"
 * action and its form) and sits above what they still can. The server is what refuses (`403
 * client.suspended`); this only says why before they try.
 *
 * Surface: the host's laptop.
 */
export function SuspensionScreen({ contact }: SuspensionScreenProps) {
  const t = useTranslations()

  return (
    <EmptyState
      as="h2"
      role="status"
      className={styles['screen']}
      title={t.clientSpace.suspendedTitle}
      description={t.clientSpace.suspendedBody}
      action={
        contact === null ? (
          <span>{t.clientSpace.contactHint}</span>
        ) : (
          <a href={contact.href}>{t.clientSpace.contactAction}</a>
        )
      }
    />
  )
}
