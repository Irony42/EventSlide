import type { ModerationDecision, PhotoStatus } from '../../../lib/api/dto'

/**
 * The optimistic-decision engine the photo queue and the guestbook queue share (WEB-HOST-05),
 * as plain functions.
 *
 * A host decides while a read may be on the wire. That read was asked before the decision
 * existed, so its answer describes the row as it was, and a response that replaced the rows
 * wholesale would put the old status back under the host's thumb. So each console remembers
 * what it is still waiting to hear about (`InFlight`) and writes it over every response.
 *
 * Reads are numbered as they start. A decision is written over a read until a read that
 * started *after* the decision was answered has come back: that one is the server's own
 * account. Over earlier reads even when they answer after the request did, because two
 * requests in flight are in no order.
 */

/** A decision whose request has not come back, as far as a read response is concerned. */
export interface InFlight {
  readonly status: PhotoStatus
  /**
   * `null` while the request is out. Once it has answered, the number of reads that had
   * started by then: a read numbered above it asked after the decision landed.
   */
  settledAfterRead: number | null
}

/** Anything remembered the same way: a decision, a highlight toggle. */
export interface Settling {
  readonly settledAfterRead: number | null
}

/** A row both consoles can show a decision on. */
export interface DecidableRow {
  readonly id: string
  readonly status: PhotoStatus
  readonly allowedDecisions: readonly ModerationDecision[]
}

/** Whether a read numbered `startedAt` asked after this was answered, so it is the server's word. */
export const isSettledBefore = (held: Settling, startedAt: number): boolean =>
  held.settledAfterRead !== null && startedAt > held.settledAfterRead

/** The ids a read numbered `startedAt` makes obsolete: the caller forgets them. */
export const expiredIds = (
  held: ReadonlyMap<string, Settling>,
  startedAt: number,
): readonly string[] => {
  const expired: string[] = []
  for (const [id, entry] of held) if (isSettledBefore(entry, startedAt)) expired.push(id)
  return expired
}

export interface Overlaid<T> {
  readonly rows: readonly T[]
  /** How far the pending badge moves because of the decisions written over `rows`. */
  readonly pendingDelta: number
  /** Decisions this read makes obsolete: forget them. */
  readonly expired: readonly string[]
}

/**
 * The rows as the host should see them: the server's answer with what is still being decided
 * written over it. Those rows show no decisions (`allowedDecisions` is the server's reading of
 * its status machine and the console holds no copy of it) until a read that started after
 * their decision was answered.
 *
 * Pure: it returns the ids to forget instead of deleting them.
 */
export const overlayInFlight = <T extends DecidableRow>(
  rows: readonly T[],
  inFlight: ReadonlyMap<string, InFlight>,
  startedAt: number,
): Overlaid<T> => {
  const expired = expiredIds(inFlight, startedAt)
  const dropped = new Set(expired)
  let pendingDelta = 0
  const shown = rows.map((row) => {
    const held = inFlight.get(row.id)
    if (held === undefined || dropped.has(row.id)) return row
    if (row.status === 'pending' && held.status !== 'pending') pendingDelta -= 1
    if (row.status !== 'pending' && held.status === 'pending') pendingDelta += 1
    return { ...row, status: held.status, allowedDecisions: [] }
  })
  return { rows: shown, pendingDelta, expired }
}

/** Forget a decision, unless a later one on the same row has taken its place. */
export const forgetInFlight = (
  inFlight: Map<string, InFlight>,
  id: string,
  decision: InFlight,
): void => {
  if (inFlight.get(id) === decision) inFlight.delete(id)
}

/** A one-line answer, gone before the host has looked up from the projector. */
export const NOTHING_TO_UNDO_MS = 2_500
