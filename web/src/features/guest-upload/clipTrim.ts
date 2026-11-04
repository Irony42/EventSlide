/**
 * Which part of a too-long recording a guest keeps (spec 16): the rules of the two
 * handles, with no screen in them.
 *
 * Pure, and separate from the component, because these are the only decisions on the
 * trim screen that are rules rather than plumbing. The screen has one promise to the
 * guest, **no handle position is ever an error**: whatever they drag, the range stays
 * one the server will take (a second at least, the event's cap at most, inside the
 * recording). So there is no refusal message to write and no disabled button to explain;
 * the other handle gives way instead.
 *
 * The server judges the same range again from the bytes (`ClipTrim`), with the cap it
 * owns. The numbers here are the event's own, passed in, never constants of this bundle.
 *
 * Milliseconds throughout and whole ones: that is what the wire carries.
 */

/** The server's `ClipDuration.minMs`: under a second is a mis-tap, not a clip. */
export const MIN_TRIM_MS = 1_000

export interface TrimRange {
  readonly startMs: number
  readonly endMs: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

/**
 * The range the screen opens on: the start of the recording, as long as the cap allows.
 * Already a valid choice, so one tap on "Envoyer cet extrait" is all a guest needs.
 */
export const defaultTrim = (durationMs: number, maxMs: number): TrimRange => ({
  startMs: 0,
  endMs: Math.round(Math.min(durationMs, maxMs)),
})

/**
 * Drag the start handle. The end stays where it is unless the move would make the range
 * shorter than a second or longer than the cap, in which case it follows: the range
 * slides rather than the handle sticking.
 */
export const moveStart = (
  range: TrimRange,
  valueMs: number,
  durationMs: number,
  maxMs: number,
): TrimRange => {
  const startMs = Math.round(clamp(valueMs, 0, Math.max(0, durationMs - MIN_TRIM_MS)))
  let endMs = range.endMs
  if (endMs - startMs < MIN_TRIM_MS) endMs = startMs + MIN_TRIM_MS
  if (endMs - startMs > maxMs) endMs = startMs + maxMs
  return { startMs, endMs: Math.round(Math.min(endMs, durationMs)) }
}

/** Drag the end handle; the mirror of {@link moveStart}. */
export const moveEnd = (
  range: TrimRange,
  valueMs: number,
  durationMs: number,
  maxMs: number,
): TrimRange => {
  const endMs = Math.round(clamp(valueMs, Math.min(MIN_TRIM_MS, durationMs), durationMs))
  let startMs = range.startMs
  if (endMs - startMs < MIN_TRIM_MS) startMs = endMs - MIN_TRIM_MS
  if (endMs - startMs > maxMs) startMs = endMs - maxMs
  return { startMs: Math.round(Math.max(startMs, 0)), endMs }
}

/** Whether the picker's recording needs the trim screen at all: longer than the cap. */
export const needsTrim = (durationMs: number | null, maxSeconds: number): boolean =>
  durationMs !== null && durationMs > maxSeconds * 1_000

/** Tenths of a second, rounded: what a guest reads ("12,5 s"), never a millisecond. */
export const secondsOf = (ms: number): number => Math.round(ms / 100) / 10
