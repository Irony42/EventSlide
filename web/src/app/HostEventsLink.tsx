import { Link } from 'react-router-dom'
import { useTranslations } from '../lib/i18n/useTranslations'
import styles from './HostEventsLink.module.css'

/** Where the host's list of events is: the same address the breadcrumb and the Compte menu use. */
const EVENTS_PATH = '/admin'

/**
 * "Vos évènements" as a link the size of a button, for the places a page has failed and the way
 * out has to be as easy to hit as Réessayer beside it.
 *
 * Surface: the host and the moderator. It is the `secondaryAction` of `LoadFailure` on the event,
 * settings and moderation pages: a slug that does not exist, an access that was withdrawn and a
 * network that dropped all land there, and only the last is mended by asking again.
 */
export function HostEventsLink() {
  const t = useTranslations()
  return (
    <Link className={styles['link']} to={EVENTS_PATH}>
      {t.admin.events}
    </Link>
  )
}
