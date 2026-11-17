import type { EventDto } from '../../lib/api/dto'

/**
 * What the console's reveal band says (spec 23), as view-state.
 *
 * **The rule is the server's.** Whether the evening is revealed is `event.reveal.revealed`, decided
 * with the server's clock when the event was read; this only keeps the countdown honest between two
 * reads (the end of a countdown announces nothing: the hour is a function of the clock, there is no
 * sweep), by comparing the hour with the **server's** clock as the page measured it, never the
 * laptop's. A band that guessed it was revealed before the server said so would only ever be off by
 * the seconds until the panel reads the event again, which it does at zero.
 */

export type RevealBand =
  | { readonly kind: 'revealed'; readonly atMs: number | null }
  | {
      readonly kind: 'waiting'
      /** The hour, or `null` while the host reveals with the button. */
      readonly atMs: number | null
      /** Milliseconds to the hour on the server's clock, `null` with no hour. Never negative. */
      readonly leftMs: number | null
      /** Published photographs the gate holds back. */
      readonly readyCount: number
      /** Photographs waiting for a decision: they stay hidden after the reveal. */
      readonly pendingCount: number
      /** The event is closed or archived and was never revealed (spec 23 §3.5, Pierre 16/11). */
      readonly closedHeld: boolean
      /** A closing is scheduled before the reveal, or with no reveal hour at all. */
      readonly closesBefore: boolean
    }

/** `null` when the mode is off or the server did not say (an older build): no band at all. */
export const revealBandOf = (event: EventDto, serverNowMs: number): RevealBand | null => {
  const reveal = event.reveal
  if (reveal === undefined || !reveal.enabled) return null

  const left = reveal.atMs === null ? null : reveal.atMs - serverNowMs
  if (reveal.revealed || (left !== null && left <= 0)) {
    return { kind: 'revealed', atMs: reveal.atMs }
  }

  const closed = event.status === 'closed' || event.status === 'archived'
  const closing = event.scheduledCloseAt === null ? null : Date.parse(event.scheduledCloseAt)
  return {
    kind: 'waiting',
    atMs: reveal.atMs,
    leftMs: left === null ? null : Math.max(0, left),
    readyCount: reveal.readyCount ?? 0,
    pendingCount: event.pendingCount,
    closedHeld: closed,
    closesBefore:
      !closed &&
      closing !== null &&
      Number.isFinite(closing) &&
      (reveal.atMs === null || closing < reveal.atMs),
  }
}
