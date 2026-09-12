import type {
  Delivery,
  DomainEvent,
  EventBus,
  EventListener,
  Unsubscribe,
} from '../../application/ports/eventBus'
import type { EventId } from '../../domain/shared/ids'
import type { Logger } from '../../application/ports/logger'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'

/**
 * Per-event fan-out, in process.
 *
 * One deployment serves one venue, so there is no need for Redis or a message broker —
 * and adding one would mean an operator maintaining a second service to run a photo
 * wall in a village hall.
 *
 * What matters is the shape. 1.0 had a single global `EventEmitter` and every SSE
 * connection attached a listener that compared party names *inside* the callback, with
 * a fallback to the string `'myParty'`. Every projector therefore received every
 * event's activity and was trusted to ignore what was not its own. Here subscribers are
 * held in a map keyed by `eventId`, so a listener is never called with another event's
 * data — the isolation is structural rather than a comparison someone has to remember.
 */

export interface EventBusOptions {
  readonly logger: Logger
  /**
   * Guard against a leak taking the process down: one projector, a few moderation
   * consoles and a phone or two per event is the expected load, and hundreds means
   * connections are not being cleaned up — or that someone is opening them on purpose,
   * since the wall's channel needs no authentication.
   *
   * Reaching it is answered, not absorbed: `subscribe` returns a failure and the caller
   * refuses the connection outright.
   */
  readonly maxSubscribersPerEvent?: number
}

const DEFAULT_MAX_SUBSCRIBERS = 200

/**
 * The refusal a caller gets past the cap.
 *
 * `service.notReady` rather than a code of its own: it is the same answer `/api/ready`
 * gives — "this server cannot serve you right now, come back" — and the HTTP layer
 * turns it into the same `503`. Nothing in the body says *which* limit was reached,
 * because the channel it guards needs no authentication and confirming that an attack
 * landed is a courtesy the attacker has not earned.
 */
const atCapacity = (): DomainError => DomainError.unexpected('service.notReady')

export interface InMemoryEventBus extends EventBus {
  /** Live subscriber count, for the health endpoint and for tests. */
  subscriberCount(eventId?: EventId): number
  /** Drops every listener. Called on shutdown so no callback outlives the server. */
  close(): void
}

export const createInMemoryEventBus = ({
  logger,
  maxSubscribersPerEvent = DEFAULT_MAX_SUBSCRIBERS,
}: EventBusOptions): InMemoryEventBus => {
  const byEvent = new Map<EventId, Set<EventListener>>()

  /**
   * One number per delivered announcement, shared by every subscriber of it.
   *
   * Process-wide rather than per event, so there is nothing to purge when an event's
   * last subscriber leaves and a number is never handed out twice — a per-event
   * counter would have to be dropped with its subscribers and would then restart
   * behind the cursor a reconnecting projector still holds.
   */
  let lastSequence = 0

  return {
    publish: (event: DomainEvent): void => {
      const listeners = byEvent.get(event.eventId)
      if (!listeners || listeners.size === 0) return

      lastSequence += 1
      const delivery: Delivery = { sequence: lastSequence }

      // A copy, because a listener may unsubscribe itself while being called — an SSE
      // connection closing mid-broadcast does exactly that, and mutating the set
      // during iteration would skip a subscriber.
      for (const listener of [...listeners]) {
        try {
          listener(event, delivery)
        } catch (cause) {
          // A slow or broken projector must never fail a guest's upload. The publisher
          // is on the request path; a subscriber is not.
          logger.warn('event bus subscriber threw', {
            type: event.type,
            eventId: event.eventId,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    },

    subscribe: (eventId: EventId, listener: EventListener): Result<Unsubscribe, DomainError> => {
      const listeners = byEvent.get(eventId) ?? new Set<EventListener>()
      if (listeners.size >= maxSubscribersPerEvent) {
        logger.warn('event bus subscriber limit reached, refusing subscription', {
          eventId,
          limit: maxSubscribersPerEvent,
        })
        // Refused, and said so. This used to return a no-op unsubscribe — a value no
        // caller could tell from a live subscription — so past the cap a projector was
        // answered 200 and then heard nothing for the rest of the evening while
        // reporting itself connected. The caller now has to decide, and the HTTP layer
        // decides 503 before a header goes out.
        return err(atCapacity())
      }

      listeners.add(listener)
      byEvent.set(eventId, listeners)

      let released = false
      return ok(() => {
        // Idempotent: an SSE handler can plausibly unsubscribe on both `close` and
        // `error`, and the second call must not empty a set that has since been
        // repopulated for a new connection.
        if (released) return
        released = true

        const current = byEvent.get(eventId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) byEvent.delete(eventId)
      })
    },

    subscriberCount: (eventId?: EventId): number => {
      if (eventId !== undefined) return byEvent.get(eventId)?.size ?? 0
      let total = 0
      for (const listeners of byEvent.values()) total += listeners.size
      return total
    },

    close: (): void => {
      byEvent.clear()
    },
  }
}
