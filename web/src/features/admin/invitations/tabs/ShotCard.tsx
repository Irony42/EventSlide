import type { CSSProperties, RefObject } from 'react'
import { LocaleOverride } from '../../../../lib/i18n/LocaleProvider'
import { translationsFor } from '../../../../lib/i18n/translations'
import { readableLink } from '../../../../lib/invite/cardTexts'
import { dayMonthLabel } from '../../../../lib/invite/inviteTexts'
import { PrintCard } from '../../print/PrintCard'
import { SheetQr } from '../../print/PrintSheet'
import { useFitText } from '../../print/useFitText'
import type { InviteCardView } from './inviteCard'
import type { InviteShot } from './invitePreferences'
import { SHOT_SIZE } from './shotSize'
import styles from './ShotCard.module.css'

/** The card's width on each: its height follows (A6, 1 : √2) and leaves room for what surrounds it. */
const CARD_WIDTH: Readonly<Record<InviteShot, number>> = { square: 640, story: 800 }

export interface ShotCardProps {
  readonly view: InviteCardView
  readonly eventName: string
  /** The invitation's link, with its scheme: the QR leads to it. */
  readonly url: string
  readonly startsAt: string
  readonly shot: InviteShot
  readonly photoUrl: string | null
  /** The photograph, already blurred, behind the card; `null` for a ground of the card's colour. */
  readonly backdropUrl: string | null
  /** The element the image is made from. */
  readonly nodeRef: RefObject<HTMLDivElement | null>
}

/**
 * The invitation card laid on a background, at the size of the image (spec 29): the same card as
 * the paper, in the same design, colour, photo and short word, on a ground of its colour or of the
 * blurred photograph. A story adds what a story is read for above and below the card: who is
 * invited and the day, then where to find the rest (a story's link is not clickable, the card's QR
 * serves from another phone).
 *
 * Drawn at its true size in pixels and scaled by its parent for the preview, so what is shown is
 * what is captured. Its captions are in the language of the invitation.
 */
export function ShotCard({
  view,
  eventName,
  url,
  startsAt,
  shot,
  photoUrl,
  backdropUrl,
  nodeRef,
}: ShotCardProps) {
  const { width, height } = SHOT_SIZE[shot]
  useFitText(
    nodeRef,
    `${shot}|${view.design}|${JSON.stringify(view.invitation)}|${photoUrl === null}`,
  )
  const card = translationsFor(view.lang).guestInvite.card
  const style = {
    inlineSize: `${width}px`,
    blockSize: `${height}px`,
    '--accent-hue': String(view.hue),
    '--pd-color': view.colour,
  } as CSSProperties

  return (
    <div
      ref={nodeRef}
      className={styles['shot']}
      data-invite-shot={shot}
      data-ink="black"
      lang={view.lang}
      style={style}
    >
      <div
        className={styles['ground']}
        style={backdropUrl === null ? undefined : { backgroundImage: `url("${backdropUrl}")` }}
      />
      <div className={styles['veil']} />
      <div className={styles['content']}>
        {shot === 'story' ? (
          <header className={styles['top']}>
            <p className={styles['topLine']}>{card.storyTop}</p>
            <p className={styles['topDay']}>
              {dayMonthLabel(new Date(startsAt), view.lang, view.zone)}
            </p>
          </header>
        ) : null}
        <div className={styles['card']} style={{ inlineSize: `${CARD_WIDTH[shot]}px` }}>
          <LocaleOverride locale={view.lang}>
            <PrintCard
              design={view.design}
              texts={view.texts}
              steps={false}
              photoUrl={photoUrl}
              focusX={view.focusX}
              focusY={view.focusY}
              invitation={view.invitation}
              joinCode=""
              address={null}
              qr={<SheetQr eventName={eventName} joinUrl={url} logoUrl={null} />}
            />
          </LocaleOverride>
        </div>
        {shot === 'story' ? (
          <footer className={styles['bottom']}>
            <p className={styles['bottomLine']}>{card.infos}</p>
            <p className={styles['bottomLink']}>{readableLink(url)}</p>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
