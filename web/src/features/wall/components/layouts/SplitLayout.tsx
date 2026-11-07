import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { SlideCaption } from '../SlideCaption'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps } from './layoutProps'
import { splitPanes, saysFirstPhoto, nextPhotoUrl } from '../wallLayoutMath'
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
export function SplitLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
  const text = useTranslations()
  const panes = splitPanes(items, slideshow)

  return (
    <div className={styles['split']} style={stageStyleFor(transitionMs)}>
      {panes.map((item, pane) => (
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
        </figure>
      ))}

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
