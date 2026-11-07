import { SlideCaption } from '../SlideCaption'
import { SlideLayer } from '../SlideLayer'
import { type LayoutViewProps } from './layoutProps'
import { saysFirstPhoto } from '../wallLayoutMath'

/** One photo, letterboxed, with its caption and author. The safe default. */
export function SpotlightLayout({
  slideshow,
  kenBurnsDurationMs,
  transitionMs,
  plays,
}: LayoutViewProps) {
  const { current, previous, next, generation } = slideshow

  return (
    <SlideLayer
      current={current}
      previous={previous}
      next={next}
      kenBurnsDurationMs={kenBurnsDurationMs}
      transitionMs={transitionMs}
      // The slideshow's own cadence, never the server's: a zoom timed off a number the
      // wall is not actually running on is the second opinion trap 6 is about. `0` is a
      // wall that is not going to change photo, and it gets a photograph at rest.
      advancing={slideshow.intervalMs > 0}
      generation={generation}
      plays={plays}
      caption={
        current === null ? null : (
          <SlideCaption
            caption={current.caption}
            authorName={current.authorName}
            sentAt={current.createdAt}
            firstFromGuest={saysFirstPhoto(current, slideshow)}
          />
        )
      }
    />
  )
}
