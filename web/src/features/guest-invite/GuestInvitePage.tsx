import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { GuestInvitation } from '../../app/GuestInvitation'
import styles from '../../app/GuestInvitation.module.css'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Icon } from '../../design-system/components/Icon'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import { useAnnounceLocale } from '../../lib/i18n/deferredLocale'
import { parseLocale } from '../../lib/i18n/locale'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useGuestInvite } from './hooks/useGuestInvite'

/**
 * The invitation a guest opens from a link or a QR code (spec 29). `/i/:token`.
 *
 * Surface: the guest's, before the party. Nobody signs in and nothing is asked: no cookie of its
 * own, no count of visits. **One page, four screens, and the server picks** (`state`): before the
 * party, during it (a big button into the wall), after it (the date and no address, no word), and
 * "not available", one sentence for every way a link can die.
 *
 * It is read in **the invitation's language**, not the browser's: the host chose the language the
 * invitation speaks, and a guest opening it in another is the reason it has one. The host's
 * title, place and word are content, shown exactly as written, never as a link; the one outgoing
 * link, the directions, is built here with the address encoded.
 *
 * `<meta name="robots">` on every screen, hoisted to the head by React: the server already sends
 * `X-Robots-Tag`, and a crawler that reads only markup is told the same thing.
 */

const Robots = () => <meta name="robots" content="noindex,nofollow" />

export function GuestInvitePage() {
  const t = useTranslations().guestInvite.page
  const { token = '' } = useParams()
  const state = useGuestInvite(token)
  const announce = useAnnounceLocale()
  // The language the page is in is the invitation's; until it is known, the surface's own.
  const language = state.page === null ? null : parseLocale(state.page.language)
  // `null` takes the announcement back: an invitation that has gone (read again, and refused) is
  // the reader's to read, not still in the language of a page that no longer exists.
  useEffect(() => {
    announce(language)
  }, [announce, language])

  if (state.phase === 'loading') {
    return (
      <div className={styles['centered']}>
        <Robots />
        <Spinner size="lg" label={t.loading} />
      </div>
    )
  }

  if (state.phase === 'failed') {
    return (
      <div className={styles['page']}>
        <Robots />
        <Notice tone="danger" variant="boxed" role="alert">
          {state.busy ? t.busy : t.failed}
        </Notice>
        <Button variant="secondary" size="lg" block onClick={state.retry}>
          {t.retry}
        </Button>
      </div>
    )
  }

  if (state.phase === 'unavailable' || state.page === null) {
    return (
      <div className={styles['page']}>
        <Robots />
        <EmptyState
          as="h1"
          icon={<Icon name="mail-off" />}
          title={t.gone}
          description={t.goneSub}
        />
        <div className={styles['foot']}>
          <span>{t.madeWith}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <Robots />
      <GuestInvitation page={state.page} token={token} readAt={state.readAt} />
    </>
  )
}
