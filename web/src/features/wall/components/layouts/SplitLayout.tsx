import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { SlideCaption } from '../SlideCaption'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps } from './layoutProps'
import { splitPanes, saysFirstPhoto, nextPhotoUrl } from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * Two photos side by side, an older upload beside a newer one.
 *
 * Built for an ultra-wide screen, or two projectors edge-blended, where one letterboxed
 * photo leaves two enormous black bars. Neither pane crops: half of a 21:9 screen is
 * still larger than anything a phone took, so the product promise that nobody's head is
 * cut off survives the split.
 *
 * The panes change alternately, so one half is always still — a wall where both halves
 * cut at once is two slideshows rather than a pairing.
 */
export function SplitLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  const panes = splitPanes(items, slideshow)
  // A medallion on the seam, in a middle column of its own: the two panes stay the same width
  // either side of it, which is what makes them a pair.
  const medallion =
    invite === null ? null : (
      <JoinInvite
        key="invite"
        join={invite.join}
        slot="seam"
        onDismiss={invite.onDismiss}
        className={styles['splitInvite']}
      />
    )

  return (
    <div
      className={styles['split']}
      style={stageStyleFor(transitionMs)}
      data-invite={invite === null ? undefined : 'true'}
    >
      {panes.flatMap((item, pane) => [
        pane === 1 ? medallion : null,
        <figure
          key={pane}
          className={styles['pane']}
          data-testid="wall-slide"
          data-photo-id={item.id}
        >
          <span className={styles['paneWindow']}>
            <WallMedia
              key={item.id}
              item={item}
              plays={plays}
              alt={photoAlt(item, text)}
              className={styles['paneImage']}
            />
          </span>
          <SlideCaption
            caption={item.caption}
            authorName={item.authorName}
            sentAt={item.createdAt}
            firstFromGuest={saysFirstPhoto(item, slideshow)}
            variant="pane"
          />
        </figure>,
      ])}
      {panes.length < 2 ? medallion : null}

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
