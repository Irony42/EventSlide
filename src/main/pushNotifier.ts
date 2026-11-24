import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { EventRepository } from '../application/ports/eventRepository'
import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type { PushSender } from '../application/ports/pushSender'
import type { PushSubscriptionRepository } from '../application/ports/pushSubscriptionRepository'
import type { MembershipRepository } from '../application/ports/userRepository'
import { requireEventRole } from '../application/usecases/shared/eventRole'
import {
  PUSH_MIN_INTERVAL_MS,
  noticePayload,
  pushBatchWait,
  rsvpNotice,
} from '../domain/push/pushNotice'
import {
  MAX_PUSH_FAILURES,
  MAX_PUSH_SENDS_PER_MESSAGE,
  selectForDelivery,
} from '../domain/push/pushSubscription'
import type { EventId, UserId } from '../domain/shared/ids'
import { setBackgroundTimeout } from '../infrastructure/time/backgroundTimers'

/**
 * Tells the host's browsers that replies came in (spec 30, lot 4, Web Push).
 *
 * It listens to the one signal the replies already publish (`rsvp.changed`, which carries an event id
 * and nothing else) and sends **at most one message per event and per five minutes**: the first reply
 * after a quiet spell is told after a moment (so a burst of the same instant is one message), the
 * ones that follow are counted and told together when the five minutes are over ("3 nouvelles
 * réponses"). The count is the number of signals, which also include the host's own changes: it is
 * "something changed", never a name or an answer.
 *
 * - **State is in memory** (a restart forgets a pending count, which is fine for "something came in").
 * - **Only the owner's browsers are told, read on each send**: the subscriptions of an account that is no
 *   longer a member, or no longer an owner, are removed; an owner whose account is switched off is
 *   skipped and kept; the event taken down is not told at all.
 * - **At most 50 browsers per message**, shared out round-robin between the owners (newest first).
 * - **A subscription the push service says is gone is removed**; one that merely failed is kept until it
 *   has failed five times in a row (a delivery starts the count again).
 * - **Never two deliveries of one event at once**: a slow push service delays the next message, it does not
 *   overlap it.
 * - Nothing throws out of a signal's callback, and **nothing logs an endpoint, a key or a payload**:
 *   a line says how many were delivered, gone or failed.
 */

export interface PushNotifierDeps {
  readonly bus: Pick<EventBus, 'subscribeAll'>
  readonly events: Pick<EventRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'roleFor' | 'membershipFor'>
  readonly subscriptions: Pick<
    PushSubscriptionRepository,
    'listByEvent' | 'removeById' | 'recordFailure' | 'resetFailures' | 'removeForMember'
  >
  readonly sender: PushSender
  readonly clock: Clock
  readonly logger: Logger
  /** A timer that does not hold the process open, returning the way to cancel it. Injected by tests. */
  readonly schedule?: (task: () => void, delayMs: number) => () => void
}

export interface PushNotifier {
  start(): void
  stop(): void
}

interface EventState {
  pending: number
  lastSentAt: number | null
  /** A delivery of this event is going: a second one never starts beside it. */
  inFlight: boolean
  cancel: (() => void) | null
}

const backgroundSchedule = (task: () => void, delayMs: number): (() => void) => {
  const timer = setBackgroundTimeout(task, delayMs)
  return () => clearTimeout(timer)
}

export const createPushNotifier = ({
  bus,
  events,
  memberships,
  subscriptions,
  sender,
  clock,
  logger,
  schedule = backgroundSchedule,
}: PushNotifierDeps): PushNotifier => {
  const states = new Map<EventId, EventState>()
  let unsubscribe: Unsubscribe | null = null

  /**
   * What an account holding subscriptions is to the event now: `owner` (told), `disabled` (an owner
   * whose account is switched off: kept, and skipped, because switching it back on gives back what it
   * had) or `gone` (no membership, or not an owner any more: its subscriptions are removed).
   */
  const standingOf = async (
    eventId: EventId,
    userId: UserId,
  ): Promise<'owner' | 'disabled' | 'gone'> => {
    const role = await requireEventRole(memberships, eventId, userId, 'manage')
    if (role.ok) return 'owner'
    const row = await memberships.membershipFor(eventId, userId)
    return row?.role === 'owner' ? 'disabled' : 'gone'
  }

  const deliver = async (eventId: EventId, count: number): Promise<void> => {
    const event = await events.findById(eventId)
    if (event === null || event.isTakenDown()) return
    const held = await subscriptions.listByEvent(eventId)
    if (held.length === 0) return

    // Read now, not at subscription time: an owner who was demoted or removed is not told, and the
    // browsers they left behind are forgotten.
    const standings = new Map<UserId, 'owner' | 'disabled' | 'gone'>()
    for (const subscription of held) {
      if (standings.has(subscription.userId)) continue
      const standing = await standingOf(eventId, subscription.userId)
      standings.set(subscription.userId, standing)
      if (standing === 'gone') await subscriptions.removeForMember(eventId, subscription.userId)
    }
    const owners = held.filter((subscription) => standings.get(subscription.userId) === 'owner')

    const payload = noticePayload(rsvpNotice(event.slug.value, count))
    const outcomes = { delivered: 0, gone: 0, failed: 0, pruned: 0 }
    const chosen = selectForDelivery(owners, MAX_PUSH_SENDS_PER_MESSAGE)
    for (const subscription of chosen) {
      const outcome = await sender.send(subscription, payload)
      if (outcome === 'delivered') {
        outcomes.delivered += 1
        await subscriptions.resetFailures(eventId, subscription.id)
      } else if (outcome === 'gone') {
        outcomes.gone += 1
        await subscriptions.removeById(eventId, subscription.id)
      } else {
        outcomes.failed += 1
        // Not taken (a refusal, a timeout): kept, until it has failed this many times in a row.
        const result = await subscriptions.recordFailure(
          eventId,
          subscription.id,
          MAX_PUSH_FAILURES,
        )
        if (result === 'pruned') outcomes.pruned += 1
      }
    }
    if (chosen.length > 0) logger.info('browser notifications sent', { eventId, ...outcomes })
  }

  const flush = async (eventId: EventId): Promise<void> => {
    const state = states.get(eventId)
    if (state === undefined) return
    state.cancel = null
    // A delivery of this event is still going (a slow push service): this one is counted into the
    // next, which starts when that one ends, and never overlaps it.
    if (state.inFlight) return
    const count = state.pending
    state.pending = 0
    state.lastSentAt = clock.now().getTime()
    // Idle entries do not pile up: an event that has been quiet for an interval is forgotten.
    for (const [other, kept] of states) {
      if (
        other !== eventId &&
        kept.pending === 0 &&
        kept.cancel === null &&
        !kept.inFlight &&
        kept.lastSentAt !== null &&
        kept.lastSentAt + PUSH_MIN_INTERVAL_MS <= state.lastSentAt
      ) {
        states.delete(other)
      }
    }
    if (count === 0) return
    state.inFlight = true
    try {
      await deliver(eventId, count)
    } catch (error) {
      logger.error('browser notifications could not be sent', {
        eventId,
        error: error instanceof Error ? error.name : 'error',
      })
    } finally {
      state.inFlight = false
      // What came in meanwhile goes in the next message, on the usual clock.
      if (state.pending > 0 && state.cancel === null && states.get(eventId) === state) {
        state.cancel = schedule(
          () => void flush(eventId),
          pushBatchWait(state.lastSentAt, clock.now().getTime()),
        )
      }
    }
  }

  const note = (eventId: EventId): void => {
    const state = states.get(eventId) ?? {
      pending: 0,
      lastSentAt: null,
      inFlight: false,
      cancel: null,
    }
    states.set(eventId, state)
    state.pending += 1
    // A message is already waiting for its turn: this reply is counted into it.
    if (state.cancel !== null) return
    const wait = pushBatchWait(state.lastSentAt, clock.now().getTime())
    state.cancel = schedule(() => void flush(eventId), wait)
  }

  return {
    start: () => {
      if (unsubscribe !== null) return
      unsubscribe = bus.subscribeAll((event) => {
        if (event.type === 'rsvp.changed') note(event.eventId)
      })
    },
    stop: () => {
      if (unsubscribe !== null) {
        unsubscribe()
        unsubscribe = null
      }
      for (const state of states.values()) state.cancel?.()
      states.clear()
    },
  }
}
