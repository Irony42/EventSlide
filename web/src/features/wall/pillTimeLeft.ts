/**
 * What the discreet announcement's pill says about the time it has left (spec 21, §6).
 *
 * Rounded **up** to the minute, so the pill never promises less than there is and never reads
 * "encore 0 min"; in the last minute it says so in words. The figure changes at most once a
 * minute and the pill has no seconds, no bar: a discreet text is not a countdown.
 *
 * Pure and derived from the server's clock (`remainingMs` comes from `wallAnnouncementPhaseAt`),
 * never from a timer of its own.
 */
const MINUTE_MS = 60_000

export type PillTimeLeft =
  { readonly kind: 'minutes'; readonly minutes: number } | { readonly kind: 'lastMinute' }

/** `encore {n} min` from two minutes up (the minute above `remainingMs`), then "moins d'1 min". */
export const pillTimeLeft = (remainingMs: number): PillTimeLeft =>
  remainingMs <= MINUTE_MS
    ? { kind: 'lastMinute' }
    : { kind: 'minutes', minutes: Math.ceil(remainingMs / MINUTE_MS) }

/**
 * Milliseconds until the label above next changes, or `null` in the last minute, where it is
 * final (the pill is unmounted by the layers at its end, not by this). It is the single timeout
 * the pill arms, once a minute.
 */
export const msUntilPillLabelChanges = (remainingMs: number): number | null =>
  remainingMs <= MINUTE_MS
    ? null
    : remainingMs - (Math.ceil(remainingMs / MINUTE_MS) - 1) * MINUTE_MS
