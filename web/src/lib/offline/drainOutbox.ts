import {
  CLAIM_LEASE_MS,
  PHOTO_POLICY,
  backoffMs,
  dueInMs,
  isDue,
  isLeased,
  isSpent,
  type OutboxPolicy,
} from './outboxPolicy'
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
   * The rules of the store being drained (how long an entry lives). The photo queue's when omitted:
   * the voice queue passes its own, and the drain never reads a constant of either.
   */
  readonly policy?: OutboxPolicy
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

/** An entry a drain did not send and why: refused outright (`rejected`, dropped) or kept and stopped (`blocked`). */
export interface DrainRefusal {
  readonly id: string
  readonly kind: 'rejected' | 'blocked'
  readonly code: string
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
  /**
   * The server's refusals by name: the entries it would not take (`rejected`, also in `discarded`)
   * and the ones it refused for the moment and that are now held, stopped (`blocked`, in neither
   * `discarded` nor `remaining`: a blocked entry is waiting for a person or a setting, not a timer).
   */
  readonly refusals: readonly DrainRefusal[]
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
  policy = PHOTO_POLICY,
  reclaim = false,
}: DrainOptions): Promise<DrainReport> => {
  // A zero-length lease is one that has always already expired, which is exactly what
  // "take it anyway" means — so reclaiming needs no second code path in the store.
  const effectiveLease = reclaim ? 0 : leaseMs
  const entries = await store.list(slug)
  const sent: string[] = []
  const discarded: string[] = []
  const refusals: DrainRefusal[] = []
  let remaining = 0
  /**
   * How long the photo that stopped this drain is waiting, or `null` while nothing has.
   *
   * Everything behind it inherits that wait rather than reporting zero. Reporting zero
   * looks harmless and is not: `soonest` would collapse to the floor whenever more than
   * one photo was queued, so a guest with five photos on a dead network drained once a
   * second — burning attempts and radio, and doing the precise opposite of the "one
   * timer, no polling" reasoning this field exists for.
   */
  let stoppedFor: number | null = null
  /** The soonest any entry left behind becomes actionable. */
  let soonest = Number.POSITIVE_INFINITY
  const keep = (waitMs: number): void => {
    remaining += 1
    soonest = Math.min(soonest, waitMs)
  }

  for (const entry of entries) {
    if (stoppedFor !== null) {
      // Behind a photo the network would not take. What it is waiting for is the one in
      // front of it, so it waits exactly as long.
      keep(stoppedFor)
      continue
    }

    const at = now()

    // Stopped by a refusal of the moment: kept for the guest, and nobody's timer. It is neither
    // sent nor counted as waiting, and it does not hold up the entries behind it.
    if (entry.blockedCode != null) continue

    // Spent entries are dropped before anything else, and without a claim: an entry
    // past its expiry is not work another drain might be doing better.
    if (isSpent(entry, at, policy)) {
      await store.remove(entry.id)
      discarded.push(entry.id)
      continue
    }

    // Somebody else is on it, or the backoff has not elapsed. Either way this drain
    // leaves it alone and reports when it will be worth another look.
    if (isLeased(entry, at, effectiveLease) || !isDue(entry, at)) {
      // The wait is reported against the real lease, not the reclaiming one: this drain
      // chose to ignore a lease, which is no reason to tell the screen that everybody
      // else may too.
      keep(dueInMs(entry, at, leaseMs))
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
      refusals.push({ id: claimed.id, kind: 'rejected', code: outcome.code })
      continue
    }

    if (outcome.kind === 'blocked') {
      // Not the bytes' fault and not the network's: keep them, say why, and stop asking. The next
      // page open (or the host's setting changing) unblocks the entry.
      await store.block(claimed.id, outcome.code)
      refusals.push({ id: claimed.id, kind: 'blocked', code: outcome.code })
      continue
    }

    await store.release(claimed.id, now())
    // The attempt this drain just spent is what sets the next wait.
    const wait = backoffMs(claimed.attempts + 1)
    keep(wait)
    // The network is down. Everything after this would fail the same way, and waits on
    // this photo rather than on one of its own.
    stoppedFor = wait
  }

  return {
    sent,
    discarded,
    refusals,
    remaining,
    retryAfterMs:
      remaining === 0 ? null : Math.min(RETRY_CEILING_MS, Math.max(RETRY_FLOOR_MS, soonest)),
  }
}
