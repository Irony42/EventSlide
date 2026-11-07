import { Link } from 'react-router-dom'
import { Logo } from '../design-system/components/Logo'
import { useTranslations } from '../lib/i18n/useTranslations'
import { useSession } from '../lib/useSession'
import styles from './HostHomeLink.module.css'

/**
 * EventSlide's mark in the host console's header, a link to the host's list of events.
 *
 * Surface: the host and the moderator, signed in. The mark alone, small, because the header is a
 * toolbar and the lockup is for the screens where nothing else says whose product this is. The
 * link's name is the sentence the "not found" and crash pages already use for the same place
 * (« Aller à vos évènements »); the mark inside is decorative so the name is read once.
 */
export function HostHomeLink() {
  const t = useTranslations()
  const { session } = useSession()
  // Only for somebody the server knows: a visitor on a signed-in address is on their way to the
  // sign-in page, and a link home from there would only send them round it. Same rule as the
  // account menu beside it.
  if (session === null || !session.authenticated) return null
  return (
    <Link className={styles['link']} to="/admin" aria-label={`${t.app.name} · ${t.shell.hostHome}`}>
      <Logo variant="mark" size="sm" decorative />
    </Link>
  )
}
