import { DomainError } from '../shared/errors'

/**
 * Backpressure: what happens when more clips are waiting than the box can chew through.
 *
 * One worker drains the queue at concurrency 1, for every event on the machine, because
 * a second concurrent `libx264` on a self-hosted box is the wall dropping frames. So the
 * queue has a depth, and the depth is a real wait: at roughly ten seconds a clip, twenty
 * waiting clips is three minutes.
 *
 * **This is a 429, not a 413.** The distinction is the whole reason this module exists.
 * `event.quotaExceeded` is answered in French as *"La galerie a atteint sa capacite.
 * Prevenez l'organisateur"* — it tells a guest to go and find the host, and it is the
 * right sentence for a gallery that is genuinely full. Saying it for a condition that
 * clears in ninety seconds sends a guest across a room to interrupt someone at their own
 * wedding over nothing. A `429` with `Retry-After` says "not now, in a minute", which is
 * what is actually true, and the client can retry it on its own.
 *
 * The depth is **process-wide rather than per event**, and that is a trade: one event
 * can fill the queue and make another event's guests wait. The deployment target is one
 * box at one venue, usually with one live event, and what a guest experiences is the
 * global wait — a per-event cap would admit a clip and then make it queue behind another
 * event's backlog anyway, which is the same wait reported as a success. Per-event
 * fairness is already carried by the byte quota and by the per-event upload limiter.
 */

/** Roughly what one clip costs the worker, used only to word the retry advice. */
const SECONDS_PER_CLIP = 10

/** Never advise a wait so long that a guest gives up and never comes back. */
const MAX_RETRY_AFTER_SECONDS = 120

export const admitsAnotherClip = (depth: number, maxDepth: number): boolean => depth < maxDepth

/**
 * How long to tell the client to wait, in whole seconds.
 *
 * Derived from the depth rather than fixed, so a queue of twenty is not answered with the
 * same "try in five seconds" as a queue of one — twenty clients retrying every five
 * seconds is a second flood on top of the first. At least one second, because
 * `Retry-After: 0` is an invitation to retry immediately.
 */
export const retryAfterSecondsFor = (depth: number): number =>
  Math.max(1, Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(depth * SECONDS_PER_CLIP)))

/**
 * The refusal itself, built here so the code and the `Retry-After` detail cannot drift
 * apart between the use case that raises it and the route that renders the header.
 */
export const clipQueueFull = (depth: number, maxDepth: number): DomainError =>
  DomainError.rateLimited('clip.queueFull', {
    depth,
    maxDepth,
    retryAfterSeconds: retryAfterSecondsFor(depth),
  })
