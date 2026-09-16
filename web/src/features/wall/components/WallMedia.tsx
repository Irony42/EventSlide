import { useCallback, useEffect, useRef, useState } from 'react'
import type { WallItemDto } from '../../../lib/api/dto'
import styles from './WallMedia.module.css'

/**
 * One item of the playlist, as the room sees it: a photograph, a clip's poster frame, or
 * a clip actually playing.
 *
 * Every layout renders through this, including the four that never play video, and that
 * is the point. Whether a clip plays is one decision, taken in
 * `src/domain/slideshow/wallLayout.ts` and mirrored in `wallLayoutPlayback.ts`; passing it
 * in as `plays` is what keeps it one decision rather than six `className` checks.
 *
 * For everything that is not a playing clip this renders **exactly the `<img>` the wall
 * has always rendered**, with the same attributes. That is deliberate: a clip's
 * `displayUrl` already points at its poster, so a layout that does not play one needs no
 * branch of its own and the pixels do not move.
 *
 * ## The unattended failure
 *
 * A projector runs for eight hours with nobody in front of it. A clip that will not
 * decode — a codec this box does not have, a file served half-written, an autoplay policy
 * nobody predicted — must become its poster frame rather than a black rectangle in the
 * middle of a wedding. So the element reports every way it can fail and each one falls
 * back to the still. It never falls forward: once degraded, this item stays a photograph
 * for as long as it is on screen, because a video that re-attempts every render is a wall
 * that flickers.
 */

export interface WallMediaProps {
  readonly item: WallItemDto
  /**
   * Whether this layout plays a clip, from `wallLayoutPlaysVideo`. Never a literal at a
   * call site: the layout's spec is the only thing allowed to answer this.
   */
  readonly plays: boolean
  /**
   * Hold this clip still, without giving up its element.
   *
   * The spotlight's outgoing layer, and nothing else today. Those two layers are
   * permanent and the one behind keeps its item for a whole slide after the crossfade —
   * so a clip left running there is a second decoder for eight seconds on a layout whose
   * budget is one, every slide, all evening.
   *
   * Pausing rather than dropping to the poster is what makes it free: a paused `<video>`
   * shows the frame it stopped on, so the dissolve fades out the picture the room was
   * actually watching. Swapping the element for the poster would snap it back to the
   * first frame at the instant the fade begins, which is visible on a three-metre screen.
   */
  readonly paused?: boolean
  /** The accessible name. `photoAlt` words it for a photograph and for a clip alike. */
  readonly alt: string
  readonly className?: string
}

export function WallMedia({ item, plays, paused = false, alt, className }: WallMediaProps) {
  const video = useRef<HTMLVideoElement | null>(null)
  /**
   * The last element this component mounted, kept past React nulling the ref.
   *
   * The release below runs at unmount, and by then React has already detached the node
   * and set `video.current` to `null` — so the cleanup has to have kept its own hold on
   * what it is releasing.
   */
  const mounted = useRef<HTMLVideoElement | null>(null)
  const [degraded, setDegraded] = useState(false)

  const attach = useCallback((element: HTMLVideoElement | null) => {
    video.current = element
    if (element !== null) mounted.current = element
  }, [])

  const degrade = useCallback(() => setDegraded(true), [])

  /**
   * The decoder, let go of when the slide is.
   *
   * Eight hours is about a thousand slides, and a `<video>` that still points at a source
   * keeps the platform's decoder attached to it whether or not React has taken the node
   * out of the document. `probeClipDuration` says the same thing and does the same thing;
   * this is the surface where it would otherwise accumulate, on the box least able to
   * afford it.
   *
   * At unmount and nowhere else. Releasing on any dependency would fire **after** React
   * has written the next `src` onto a recycled element — the spotlight's two layers are
   * permanent — and would strip the source the wall is about to play.
   */
  useEffect(
    () => () => {
      const element = mounted.current
      if (element === null) return
      element.pause()
      element.removeAttribute('src')
      element.load()
    },
    [],
  )

  /**
   * Autoplay, attempted rather than assumed.
   *
   * A muted video is allowed to start itself in every browser that ships today — but
   * "allowed" is a policy, policies change, and this one is enforced by the user agent
   * rather than by anything in this codebase. So the promise is checked: if the browser
   * refuses, the slot degrades to the poster instead of sitting black behind a play
   * button nobody in the room can press.
   *
   * The `autoPlay` attribute is set as well, and the two are not redundant: the attribute
   * covers the element's own first load, and this covers a source that changes under a
   * recycled element — which is what the spotlight's two permanent layers do all evening.
   *
   * **`AbortError` is not a refusal, and filtering it is load-bearing.** Calling `pause()`
   * rejects a `play()` that has not settled, and pausing is exactly what the effect does
   * on its next run when a slide advances. So on any connection slow enough that the
   * first decode outlasts a slide — which is the connection this product is built for —
   * the unfiltered version degraded the clip to its poster at the instant the dissolve
   * began, producing the snap-back this component exists to prevent. `SwipeCard` filters
   * the same rejection for the same reason.
   */
  useEffect(() => {
    const element = video.current
    if (element === null) return
    if (paused) {
      element.pause()
      return
    }
    void element.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      degrade()
    })
  }, [degrade, item.videoUrl, paused])

  const playable = plays && item.kind === 'clip' && item.videoUrl !== null && !degraded

  if (!playable || item.videoUrl === null) {
    return (
      <img
        className={className}
        src={item.displayUrl}
        alt={alt}
        width={item.width}
        height={item.height}
        decoding="async"
      />
    )
  }

  return (
    <video
      ref={attach}
      className={[className, styles['video']].filter(Boolean).join(' ')}
      src={item.videoUrl}
      // The first frame, on screen before a byte of video has been decoded. Without it
      // the slot is black for as long as the network takes, which on a venue's Wi-Fi is
      // the difference between a wall and a fault.
      poster={item.displayUrl}
      // **Muted is load-bearing twice over.** A wall that asks for sound in a room with a
      // DJ is a wall nobody hears, and an unmuted video is one no browser will start by
      // itself — so the silence is what makes the autoplay work at all.
      muted
      // Without it iOS takes the video fullscreen, over the wall, on a screen nobody is
      // standing at.
      playsInline
      // Not on a layer that is on its way out: `autoplay` would start it again the
      // moment the element mounted, before the effect above could pause it.
      autoPlay={!paused}
      // For the slide's duration: a clip is a few seconds and a slide is eight, so it
      // runs round rather than freezing on its last frame for the rest of the slot.
      loop
      // A `<video>` has no `alt`. Read on the laptop a host sets the projector up from,
      // which is the only place this screen meets a keyboard.
      aria-label={alt}
      width={item.width}
      height={item.height}
      // Every way the element can tell us it has given up. `error` covers a refused
      // source and a decode failure; `stalled` is deliberately **not** here, because a
      // clip that is merely slow over venue Wi-Fi recovers on its own and degrading it
      // would turn a pause into a permanent still.
      onError={degrade}
    />
  )
}
