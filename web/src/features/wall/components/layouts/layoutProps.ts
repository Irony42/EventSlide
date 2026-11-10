import type { CSSProperties } from 'react'
import type { WallItemDto } from '../../../../lib/api/dto'
import type { WallInvitation } from '../../wallChrome'
import type { Slideshow } from '../../hooks/useSlideshow'

export type StageStyle = CSSProperties & { readonly '--wall-transition': string }
export type TiltStyle = CSSProperties & { readonly '--wall-tilt': string }
export type DriftStyle = CSSProperties & { readonly '--wall-drift-duration': string }

/**
 * The invitation a layout draws in its own flow (`joinSlot.ts`), or `null` while there is none
 * to draw: put away, switched off, the evening closed, or the layout keeps it in a corner.
 */
export interface LayoutInvite {
  readonly join: WallInvitation
  readonly onDismiss: () => void
}

export interface LayoutViewProps {
  readonly items: readonly WallItemDto[]
  readonly slideshow: Slideshow
  /** From the wall response. Only the spotlight animates. */
  readonly kenBurnsDurationMs: number
  readonly transitionMs: number | null
  /** The host's switch for the lean of prints (spec 13). Off: angle 0. Default on. */
  readonly tilt?: boolean
  /** Print the time a photo was sent in its caption (spec 13). Off by default. */
  readonly showTime?: boolean
  /**
   * Whether a clip in this layout plays or shows its poster frame.
   *
   * Resolved once, in {@link WallLayouts}, from the layout's spec — see
   * `wallLayoutPlayback.ts` and `src/domain/slideshow/wallLayout.ts`. Every layout below
   * takes it and hands it to {@link WallMedia}; none of them decides it, and a layout
   * that hardcoded `false` would be the domain's rule written a second time, in the place
   * it is hardest to find.
   */
  readonly plays: boolean
  /** Absent or `null`: the layout is the one it always was, with no place set aside. */
  readonly invite?: LayoutInvite | null
}

/** The crossfade length the room was given, as the custom property the CSS reads. */
export const stageStyleFor = (transitionMs: number | null): CSSProperties | StageStyle =>
  transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }
