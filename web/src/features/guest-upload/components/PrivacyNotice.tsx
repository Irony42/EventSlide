import { forwardRef, useId } from 'react'
import { NewTabLink } from '../../../app/NewTabLink'
import { useAbout } from '../../../app/useAbout'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { noticeSections } from '../noticeWording'
import type { PrivacyNoticeDto, PrivacyNoticeState } from '../../../lib/api/dto'
import styles from './PrivacyNotice.module.css'

/**
 * What happens to a guest's photo, said before they send one (roadmap §5.1).
 *
 * Three pieces, one text. The same four answers are rendered in the card that stands in
 * for the picker until the guest has read them, and in the dialog that reopens them
 * afterwards, so there is one wording of the notice on this screen rather than two that
 * can drift.
 */

/**
 * The four answers, as a definition list, and a fifth line — "Hébergé par", then the name — when
 * the server sent an operator (roadmap G2-17).
 *
 * `<dl>` because that is what this is — a question and its answer, four times — and a
 * screen reader announces it as such: "Qui les voit", then the sentences under it. Each
 * sentence is its own `<dd>`, so a clause the server did not send is absent rather than
 * an empty line.
 */
export function PrivacyNoticeContent({ notice }: { readonly notice: PrivacyNoticeDto }) {
  const t = useTranslations()

  return (
    <dl className={styles['sections']}>
      {noticeSections(notice, t).map((section) => (
        <div key={section.term} className={styles['section']}>
          <dt className={styles['term']}>{section.term}</dt>
          {section.sentences.map((sentence) => (
            <dd key={sentence} className={styles['sentence']}>
              {sentence}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  )
}

/**
 * The operator's privacy policy, as a link, when the operator set `LEGAL_PRIVACY_URL`
 * (roadmap G2-17 / P3-18): the notice says what happens to a photo, and the policy is where
 * the rest of the guest's data is accounted for. A box that set none renders nothing here.
 *
 * **It stands after the button, never before it.** The address arrives from `/api/about`
 * a moment after the card is on screen, and a line that appears above "J'ai compris" pushes
 * the button down by a touch target under the thumb that is about to press it. Below the
 * button the same arrival moves nothing. It opens in a tab of its own, since this card sits
 * on the upload screen and an unmount there aborts every send in flight.
 */
export function PrivacyPolicyLink() {
  const t = useTranslations()
  const { links } = useAbout()

  if (links.privacy === undefined) return null
  return (
    <p className={styles['policy']}>
      <NewTabLink href={links.privacy} className={styles['policyLink']}>
        {t.about.privacyLink}
      </NewTabLink>
    </p>
  )
}

export interface PrivacyNoticeCardProps {
  readonly state: PrivacyNoticeState
  readonly onAcknowledge: () => void
}

/**
 * The notice where the picker will be, until it has been read.
 *
 * **In the composer, not in a modal.** A guest who opened the page only to see their own
 * photos is never stopped: the header, "Vos envois" and the queue all stay where they are,
 * and only the controls that would send something wait behind one tap. A modal on arrival
 * would put the notice in front of the thing it is about.
 *
 * A labelled region, so a screen-reader user landing on the page can jump to it, and one
 * primary button — the only action on the card, sized like "Envoyer" because it is the
 * same thumb in the same place.
 *
 * The heading changes when the notice is back because the host changed a setting, and
 * says so: a notice that reappears unexplained reads as a bug.
 */
export const PrivacyNoticeCard = forwardRef<HTMLElement, PrivacyNoticeCardProps>(
  function PrivacyNoticeCard({ state, onAcknowledge }, ref) {
    const t = useTranslations()
    const titleId = useId()
    const changed = state.acknowledgement === 'outdated'

    return (
      <section
        ref={ref}
        className={styles['card']}
        aria-labelledby={titleId}
        data-testid="privacy-notice"
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles['title']}>
          {changed ? t.upload.noticeChangedTitle : t.upload.noticeTitle}
        </h2>
        {changed ? <p className={styles['hint']}>{t.upload.noticeChangedHint}</p> : null}
        <PrivacyNoticeContent notice={state.notice} />
        <Button variant="primary" size="lg" block onClick={onAcknowledge}>
          {t.upload.noticeAcknowledge}
        </Button>
        <PrivacyPolicyLink />
      </section>
    )
  },
)

export interface PrivacyNoticeDialogProps {
  readonly notice: PrivacyNoticeDto
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * The notice again, after it has been read — "Comment vos photos sont utilisées".
 *
 * The design system's `Dialog`, so focus moves in, Escape closes it and focus returns to
 * the link that opened it. Opaque rather than glass, like every dialog in the product:
 * `docs/DESIGN-SYSTEM.md` §13 measured the glass dialog out. A close button at the
 * bottom as well as the one in the corner, because the corner is the far side of a phone
 * from the thumb that just scrolled to the end.
 */
export function PrivacyNoticeDialog({ notice, open, onClose }: PrivacyNoticeDialogProps) {
  const t = useTranslations()

  return (
    <Dialog
      open={open}
      title={t.upload.noticeLink}
      onClose={onClose}
      footer={
        <Button variant="secondary" block onClick={onClose}>
          {t.app.close}
        </Button>
      }
    >
      <PrivacyNoticeContent notice={notice} />
      <PrivacyPolicyLink />
    </Dialog>
  )
}
