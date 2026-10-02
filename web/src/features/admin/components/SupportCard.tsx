import { useState } from 'react'
import { NewTabLink } from '../../../app/NewTabLink'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  rememberSupportCardDismissal,
  wasSupportCardDismissed,
} from '../../../lib/support/supportCardDismissal'
import styles from './SupportCard.module.css'

export interface SupportCardProps {
  /** The event it was shown for: the answer to "closed it?" is remembered per event. */
  readonly eventId: string
  /** `links.donate` from `GET /api/about`, already an https address. */
  readonly donateUrl: string
  /** `links.budget`, when the operator keeps a public ledger. */
  readonly budgetUrl?: string | undefined
}

/**
 * The one mention of the project's funding a host meets, on the page of an event that has
 * just been closed (roadmap G4-02). Surface: the host's laptop, and nobody else's.
 *
 * **What it is not**, because each of these is a pattern this card is built to avoid:
 *
 * - *Not modal.* It is a card in the page. Nothing is blocked, focus is not moved, and
 *   there is no overlay to get past on the way to the album.
 * - *Not repeated.* Closing it is remembered for this event on this device
 *   ({@link wasSupportCardDismissed}); nothing re-opens it on a timer, a status change or a
 *   later visit, and there is no counter, no "last chance" and no pre-ticked amount.
 * - *Not a price.* It asks for support for the **open-source project**, not for the event
 *   that was just served, and says in as many words that **a donation unlocks nothing**:
 *   no tier, no badge, no priority, the same service for everyone. A card that read as
 *   "pay what you think the evening was worth" would be a price, and the plan keeps this
 *   from becoming one (G4-02, and G4-01 for what the instance promises).
 *
 * Mounted by `EventPage` only for a closed event on an instance that set `DONATION_URL`; it
 * never appears on a guest screen or on the wall, which is `router.test.tsx`'s to guard.
 */
export function SupportCard({ eventId, donateUrl, budgetUrl }: SupportCardProps) {
  const t = useTranslations()
  // This page load's own answer, so the card goes at once even where storage cannot keep it.
  // It names the **event** it was closed for rather than being a bare flag: one card
  // instance can be handed another event (the route parameter changed under a mounted
  // page), and a flag would carry the first event's "closed" over to an event that is owed
  // its own mention.
  const [closedFor, setClosedFor] = useState<string | null>(null)

  if (closedFor === eventId || wasSupportCardDismissed(eventId)) return null

  const close = () => {
    rememberSupportCardDismissal(eventId)
    setClosedFor(eventId)
  }

  return (
    <section className={styles['card']} aria-labelledby="support-card-title">
      <div className={styles['body']}>
        <p className={styles['title']} id="support-card-title">
          {t.about.supportTitle}
        </p>
        <p className={styles['hint']}>{t.about.supportIntro}</p>
        <p className={styles['hint']}>{t.about.supportNoCounterpart}</p>
        <div className={styles['links']}>
          <NewTabLink href={donateUrl} className={styles['link']}>
            {t.about.supportLink}
          </NewTabLink>
          {budgetUrl === undefined ? null : (
            <NewTabLink href={budgetUrl} className={styles['link']}>
              {t.about.budgetLink}
            </NewTabLink>
          )}
        </div>
      </div>

      <IconButton aria-label={t.about.supportDismiss} icon={<CloseIcon />} onClick={close} />
    </section>
  )
}
