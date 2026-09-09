import type { DomainEvent, EventBus, Unsubscribe } from '../../application/ports/eventBus'
import type { EventId } from '../../domain/shared/ids'
import type { Logger } from '../../application/ports/logger'

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
   * connections are not being cleaned up.
   */
  readonly maxSubscribersPerEvent?: number
}

const DEFAULT_MAX_SUBSCRIBERS = 200

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
  const byEvent = new Map<EventId, Set<(event: DomainEvent) => void>>()

  return {
    publish: (event: DomainEvent): void => {
      const listeners = byEvent.get(event.eventId)
      if (!listeners || listeners.size === 0) return

      // A copy, because a listener may unsubscribe itself while being called — an SSE
      // connection closing mid-broadcast does exactly that, and mutating the set
      // during iteration would skip a subscriber.
      for (const listener of [...listeners]) {
        try {
          listener(event)
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

    subscribe: (eventId: EventId, listener: (event: DomainEvent) => void): Unsubscribe => {
      const listeners = byEvent.get(eventId) ?? new Set()
      if (listeners.size >= maxSubscribersPerEvent) {
        logger.warn('event bus subscriber limit reached, refusing subscription', {
          eventId,
          limit: maxSubscribersPerEvent,
        })
        // A no-op unsubscribe: the caller's cleanup path stays uniform, and the HTTP
        // layer decides whether to answer 503.
        return () => {}
      }

      listeners.add(listener)
      byEvent.set(eventId, listeners)

      let released = false
      return () => {
        // Idempotent: an SSE handler can plausibly unsubscribe on both `close` and
        // `error`, and the second call must not empty a set that has since been
        // repopulated for a new connection.
        if (released) return
        released = true

        const current = byEvent.get(eventId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) byEvent.delete(eventId)
      }
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
