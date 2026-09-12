import { CLAIM_LEASE_MS, backoffMs, dueInMs, isDue, isLeased, isSpent } from './outboxPolicy'
import type { OutboxSender, OutboxStore } from './outbox'

/**
 * Sends everything the device is holding for one event.
 *
 * The one piece of behaviour the page and the service worker genuinely share, which is
 * why it takes a store and a sender rather than reaching for either. The page passes
 * an adapter over `api.uploadPhotos`; the worker passes one over bare `fetch`. Neither
 * transport appears below.
 *
 * Sequential, and it stops at the first deferral. Four parallel uploads on a saturated
 * access point finish later than four in a row, and continuing past a photo that could
 * not be sent only spends a guest's battery discovering that the network is still down
 * — the next `online` event is what brings the drain back.
 */

export interface DrainOptions {
  readonly store: OutboxStore
  readonly slug: string
  readonly send: OutboxSender
  /** Epoch milliseconds. Injected, so a test never depends on wall-clock ordering. */
  readonly now: () => number
  readonly leaseMs?: number
  /**
   * Take entries another drain appears to be holding.
   *
   * For the page's first drain after it mounts, and nothing else. A service worker
   * woken by Background Sync claims an entry and is routinely killed by the browser
   * before it can give it back — an offline sync does exactly that — so a fresh page
   * otherwise finds a photo locked for the full lease and reports it as waiting while
   * sending nothing. That was not theoretical: a photo queued offline and then reloaded
   * back into view sat there for two minutes.
   *
   * The cost when the worker really is alive is one duplicate upload, which the server
   * answers from the content hash and which this queue already counts as success. The
   * cost of the lease being honoured here is a guest watching a photo not go.
   */
  readonly reclaim?: boolean
}

export interface DrainReport {
  /**
   * The entries the server accepted, duplicates included: those photos are in the
   * event.
   *
   * Ids rather than a count, because the upload screen has a row per photo and has to
   * know *which* ones arrived. A count would be right only while the outbox holds
   * nothing from an earlier visit, and the visit before is exactly the case this
   * feature exists for.
   */
  readonly sent: readonly string[]
  /** Dropped unsent — expired, out of attempts, or refused on its merits. */
  readonly discarded: readonly string[]
  /** Still held, either deferred by this drain or not yet due. */
  readonly remaining: number
  /**
   * How long until it is worth draining again, in milliseconds. `null` when nothing is
   * left to send.
   *
   * The screen arms one timer from this rather than polling. A poll would wake a phone
   * in somebody's pocket every thirty seconds for a whole evening — a battery cost paid
   * by every guest to serve the few with a queue — and without it nothing at all
   * rescheduled a drain once every remaining entry was inside its backoff. That is not
   * hypothetical: a photo queued offline, then reloaded back into view, sat there
   * reported as waiting and was never sent, because `online` had already fired before
   * the reload and no other trigger was ever going to come.
   */
  readonly retryAfterMs: number | null
}

/** Never below this, so a drain cannot spin; never above, so a guest is not left waiting. */
const RETRY_FLOOR_MS = 1_000
const RETRY_CEILING_MS = 60_000

export const drainOutbox = async ({
  store,
  slug,
  send,
  now,
  leaseMs = CLAIM_LEASE_MS,
  reclaim = false,
}: DrainOptions): Promise<DrainReport> => {
  // A zero-length lease is one that has always already expired, which is exactly what
  // "take it anyway" means — so reclaiming needs no second code path in the store.
  const effectiveLease = reclaim ? 0 : leaseMs
  const entries = await store.list(slug)
  const sent: string[] = []
  const discarded: string[] = []
  let remaining = 0
  let stopped = false
  /** The soonest any entry left behind becomes actionable. */
  let soonest = Number.POSITIVE_INFINITY
  const keep = (waitMs: number): void => {
    remaining += 1
    soonest = Math.min(soonest, waitMs)
  }

  for (const entry of entries) {
    if (stopped) {
      // Behind a photo the network would not take. It is due now; what it is waiting
      // for is the one in front of it.
      keep(0)
      continue
    }

    const at = now()

    // Spent entries are dropped before anything else, and without a claim: an entry
    // past its expiry is not work another drain might be doing better.
    if (isSpent(entry, at)) {
      await store.remove(entry.id)
      discarded.push(entry.id)
      continue
    }

    // Somebody else is on it, or the backoff has not elapsed. Either way this drain
    // leaves it alone and reports when it will be worth another look.
    if (isLeased(entry, at, effectiveLease) || !isDue(entry, at)) {
      keep(dueInMs(entry, at, effectiveLease))
      continue
    }

    const claimed = await store.claim(entry.id, at, effectiveLease)
    if (claimed === null) {
      // Another drain took it between the read and the claim.
      keep(leaseMs)
      continue
    }

    const outcome = await send(claimed)

    if (outcome.kind === 'sent') {
      await store.remove(claimed.id)
      sent.push(claimed.id)
      continue
    }

    if (outcome.kind === 'rejected') {
      // The server looked at these bytes and said no. The same bytes get the same
      // answer, so holding them would mean asking again every time the guest walks
      // past an access point.
      await store.remove(claimed.id)
      discarded.push(claimed.id)
      continue
    }

    await store.release(claimed.id, now())
    // The attempt this drain just spent is what sets the next wait.
    keep(backoffMs(claimed.attempts + 1))
    // The network is down. Everything after this would fail the same way.
    stopped = true
  }

  return {
    sent,
    discarded,
    remaining,
    retryAfterMs:
      remaining === 0 ? null : Math.min(RETRY_CEILING_MS, Math.max(RETRY_FLOOR_MS, soonest)),
  }
}
