import type { Delivery, DomainEvent, EventBus, EventListener, Unsubscribe } from '../ports/eventBus'
import type { EventId } from '../../domain/shared/ids'
import type { DomainError } from '../../domain/shared/errors'
import { ok, type Result } from '../../domain/shared/result'

type Listener = EventListener

/**
 * A bus that both records and delivers.
 *
 * Recording alone would answer "was it announced". Delivering as well is what lets a
 * test prove the other half: that a wedding's activity never reaches a corporate
 * gala's projector. 1.0 had one global `EventEmitter` and compared event names inside
 * each listener, so every subscriber received everything and was trusted to ignore what
 * was not its own — a double that only recorded would not notice that regression
 * coming back.
 */
export class RecordingEventBus implements EventBus {
  /** Everything announced, in order. The assertion surface for a use case test. */
  readonly published: DomainEvent[] = []

  /**
   * What a subscriber threw. The port promises `publish` never throws — a slow
   * projector must not fail a guest's upload — so a failure is captured here instead
   * of propagating, and a test can still assert it happened.
   */
  readonly listenerErrors: unknown[] = []

  private readonly listeners = new Map<EventId, Set<Listener>>()

  /** Subscribers that hear every event, as the clip worker does in production. */
  private readonly globalListeners = new Set<Listener>()

  /** One number per delivered announcement, shared by every subscriber of it. */
  private lastSequence = 0

  publish(event: DomainEvent): void {
    this.published.push(event)

    // A copy: an SSE connection closing mid-broadcast unsubscribes itself from inside
    // its own callback, and mutating the set while iterating would skip a subscriber.
    const subscribers = [...(this.listeners.get(event.eventId) ?? []), ...this.globalListeners]
    if (subscribers.length === 0) return

    this.lastSequence += 1
    const delivery: Delivery = { sequence: this.lastSequence }

    for (const listener of subscribers) {
      try {
        listener(event, delivery)
      } catch (cause) {
        this.listenerErrors.push(cause)
      }
    }
  }

  /**
   * Always accepts. The cap that makes this fallible belongs to the in-memory adapter,
   * which is what a test exercising a refusal reaches for — the double's job here is to
   * deliver, and a limit invented for it would be a rule nothing in production shares.
   */
  subscribe(eventId: EventId, listener: Listener): Result<Unsubscribe, DomainError> {
    const subscribers = this.listeners.get(eventId) ?? new Set<Listener>()
    subscribers.add(listener)
    this.listeners.set(eventId, subscribers)

    let released = false
    return ok(() => {
      // Idempotent: an SSE handler plausibly unsubscribes on both `close` and `error`,
      // and the second call must not empty a set repopulated by a new connection.
      if (released) return
      released = true

      const current = this.listeners.get(eventId)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(eventId)
    })
  }

  /**
   * Every event's activity, as the clip worker subscribes in production. Always accepts,
   * for the same reason `subscribe` does.
   */
  subscribeAll(listener: Listener): Unsubscribe {
    this.globalListeners.add(listener)

    let released = false
    return () => {
      if (released) return
      released = true
      this.globalListeners.delete(listener)
    }
  }

  /** Only what was recorded for one event, for a test asserting isolation. */
  publishedFor(eventId: EventId): readonly DomainEvent[] {
    return this.published.filter((event) => event.eventId === eventId)
  }

  subscriberCount(eventId?: EventId): number {
    if (eventId !== undefined) return this.listeners.get(eventId)?.size ?? 0
    let total = 0
    for (const subscribers of this.listeners.values()) total += subscribers.size
    return total
  }

  /** How many listeners are hearing every event. */
  globalSubscriberCount(): number {
    return this.globalListeners.size
  }

  /**
   * Forget the recording. Subscribers survive on purpose: a test that clears between
   * two acts is asking about the second act's events, not rewiring its world.
   */
  clear(): void {
    this.published.length = 0
    this.listenerErrors.length = 0
  }
}
