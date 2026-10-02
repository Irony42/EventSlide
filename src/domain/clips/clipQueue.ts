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
 * The depth is checked **twice**: once process-wide, and once scoped to the event doing
 * the staging (`MAX_QUEUED_CLIPS` and `MAX_QUEUED_CLIPS_PER_EVENT`, both read by
 * `ClipJobRepository.stage` inside the one transaction that decides admission). The
 * box-wide cap alone has a real cost for anything but the deployment this product ships
 * for — one box, one venue, usually one live event: a second event sharing the process
 * can fill every slot and make the first event's guests wait behind its backlog, which a
 * single live event never notices and a multi-event cell cannot avoid. The per-event cap
 * is what bounds that without touching the single-event case at all — defaulted to the
 * same number as the box-wide one, so a solo box reaches both together and the wait a
 * guest experiences is still the global one, exactly as before.
 *
 * Admitting a clip never means it transcodes immediately either way: one worker drains
 * the queue at concurrency 1, so a clip under both caps still queues behind whatever this
 * event — or, if the box-wide cap is the looser of the two, another event — already has
 * waiting. The per-event cap's job is narrower than "no wait": it is "no event can make
 * every *other* event's guests wait on its behalf".
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
