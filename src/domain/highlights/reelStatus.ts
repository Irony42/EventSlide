/**
 * The life of an event's highlight reel (spec 08).
 *
 * There is no `reserved`: a montage has no upload to wait for, so it starts `queued`. `stale`
 * is terminal for a reel but not for the **row**: an event has exactly one reel row, and asking
 * for a new montage puts a `done`, `failed` or `stale` row back to `queued`.
 *
 * `stale` means "a photograph of this reel was taken out of the evening" and says nothing else.
 * Deleting, hiding, refusing, a guest's erasure and the operator's takedown all land here, so
 * that the host cannot tell which one happened.
 */
export const REEL_STATUSES = ['queued', 'running', 'done', 'failed', 'stale'] as const

export type ReelStatus = (typeof REEL_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<ReelStatus, readonly ReelStatus[]>> = {
  // Claimed by the worker; or made stale before it ever ran.
  queued: ['running', 'stale'],
  // Finished, given up on, handed back for another attempt, or made stale mid-render.
  running: ['queued', 'done', 'failed', 'stale'],
  // Served, until a photograph leaves it, or the host asks for another one.
  done: ['stale', 'queued'],
  failed: ['queued'],
  stale: ['queued'],
}

export const isReelStatus = (value: unknown): value is ReelStatus =>
  typeof value === 'string' && (REEL_STATUSES as readonly string[]).includes(value)

export const canTransition = (from: ReelStatus, to: ReelStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

/** Waiting for the worker or being rendered: one of these blocks asking for another montage. */
export const isActive = (status: ReelStatus): boolean => status === 'queued' || status === 'running'

/** A photograph leaving the reel makes it stale only while there is something to spoil. */
export const canGoStale = (status: ReelStatus): boolean => canTransition(status, 'stale')

/**
 * Whether a row holds a file that counts against the event's quota: a finished montage, and a
 * stale one whose file the invalidation has not yet deleted.
 */
export const holdsOutputBytes = (status: ReelStatus): boolean =>
  status === 'done' || status === 'stale'
