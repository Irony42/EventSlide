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
import type { EventId } from '../domain/shared/ids'
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
 * - **Only the owner's browsers are told, read on each send**: a subscription of an account that is
 *   no longer an owner of the event, or is disabled, is skipped and kept, and the event taken down
 *   is not told at all.
 * - **A subscription the push service says is gone is removed**; one that merely failed is kept.
 * - Nothing throws out of a signal's callback, and **nothing logs an endpoint, a key or a payload**:
 *   a line says how many were delivered, gone or failed.
 */

/** Browsers told per message at most: ten per account, a handful of owners, and still bounded. */
const MAX_SENDS_PER_MESSAGE = 50

export interface PushNotifierDeps {
  readonly bus: Pick<EventBus, 'subscribeAll'>
  readonly events: Pick<EventRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'roleFor'>
  readonly subscriptions: Pick<PushSubscriptionRepository, 'listByEvent' | 'removeById'>
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

  const deliver = async (eventId: EventId, count: number): Promise<void> => {
    const event = await events.findById(eventId)
    if (event === null || event.isTakenDown()) return
    const held = await subscriptions.listByEvent(eventId)
    if (held.length === 0) return

    const payload = noticePayload(rsvpNotice(event.slug.value, count))
    const outcomes = { delivered: 0, gone: 0, failed: 0 }
    let sent = 0
    for (const subscription of held) {
      if (sent >= MAX_SENDS_PER_MESSAGE) break
      // Read now, not at subscription time: an owner who was demoted or disabled is not told.
      const role = await requireEventRole(memberships, eventId, subscription.userId, 'manage')
      if (!role.ok) continue
      sent += 1
      const outcome = await sender.send(subscription, payload)
      outcomes[outcome] += 1
      if (outcome === 'gone') await subscriptions.removeById(eventId, subscription.id)
    }
    if (sent > 0) logger.info('browser notifications sent', { eventId, ...outcomes })
  }

  const flush = async (eventId: EventId): Promise<void> => {
    const state = states.get(eventId)
    if (state === undefined) return
    state.cancel = null
    const count = state.pending
    state.pending = 0
    state.lastSentAt = clock.now().getTime()
    // Idle entries do not pile up: an event that has been quiet for an interval is forgotten.
    for (const [other, kept] of states) {
      if (
        other !== eventId &&
        kept.pending === 0 &&
        kept.cancel === null &&
        kept.lastSentAt !== null &&
        kept.lastSentAt + PUSH_MIN_INTERVAL_MS <= state.lastSentAt
      ) {
        states.delete(other)
      }
    }
    if (count === 0) return
    try {
      await deliver(eventId, count)
    } catch (error) {
      logger.error('browser notifications could not be sent', {
        eventId,
        error: error instanceof Error ? error.name : 'error',
      })
    }
  }

  const note = (eventId: EventId): void => {
    const state = states.get(eventId) ?? { pending: 0, lastSentAt: null, cancel: null }
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
