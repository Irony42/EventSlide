import { useMemo, type CSSProperties } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './ReactionBurst.module.css'

type LaneStyle = CSSProperties & { readonly '--wall-lane': string }

export interface ReactionBurstProps {
  /** Count of `reaction.added` signals seen so far, from `useWallPlaylist`. */
  readonly pulse: number
}

/**
 * The ceiling on floaters alive at once.
 *
 * An eight-hour reception sends thousands of reactions and the wall must not grow a
 * node per reaction — 1.0's confetti did exactly that and the projector's browser was
 * unusable by the dessert. Eight is also as many as reads as celebration rather than
 * as a fault.
 */
const MAX_FLOATERS = 8

/** Fixed columns, so the hearts do not stack into one line. */
const LANES = 5

/**
 * Hearts drifting up over the photo when a guest reacts.
 *
 * There is no timer and nothing to clean up: the visible floaters are *derived* from
 * the signal count, so the oldest is unmounted by the arrival of the newest and the
 * element count is capped by construction rather than by a cleanup that has to be
 * remembered. Each one animates once on mount and then holds its final frame at zero
 * opacity — nothing on the wall loops except Ken Burns.
 *
 * The lane comes from the signal number, so two projectors on the same event place the
 * same heart in the same column.
 */
export function ReactionBurst({ pulse }: ReactionBurstProps) {
  const reducedMotion = usePrefersReducedMotion()

  const floaters = useMemo(() => {
    const alive = Math.min(Math.max(pulse, 0), MAX_FLOATERS)
    // Newest first: the keys are the signal numbers, so a new pulse adds one key and
    // drops the one that fell past the cap.
    return Array.from({ length: alive }, (_unused, offset) => pulse - offset)
  }, [pulse])

  // Not slowed down, not shortened: removed. A projected animation is the worst case
  // for a vestibular disorder, and the reactions carry no information.
  if (reducedMotion || floaters.length === 0) return null

  return (
    <div className={styles['burst']} aria-hidden="true">
      {floaters.map((signal) => {
        const lane: LaneStyle = { '--wall-lane': String(signal % LANES) }

        return (
          <span
            key={signal}
            className={styles['floater']}
            style={lane}
            // Decoration has no accessible identity, so a test id is the only handle a
            // test can hold: it is how the cap on concurrent floaters is asserted.
            data-testid="wall-reaction"
          >
            <svg className={styles['glyph']} viewBox="0 0 16 16" focusable="false">
              <path
                d="M8 14.2C8 14.2 2.2 10.6 2.2 6.9A3.3 3.3 0 0 1 8 4.8a3.3 3.3 0 0 1 5.8 2.1c0 3.7-5.8 7.3-5.8 7.3z"
                fill="currentColor"
              />
            </svg>
          </span>
        )
      })}
    </div>
  )
}
