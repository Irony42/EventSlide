import { describe, expect, it, vi } from 'vitest'
import { createInMemoryEventBus, type InMemoryEventBus } from './inMemoryEventBus'
import type {
  Delivery,
  DomainEvent,
  EventListener,
  Unsubscribe,
} from '../../application/ports/eventBus'
import type { Logger } from '../../application/ports/logger'
import { asEventId, asPhotoId, type EventId } from '../../domain/shared/ids'

const silentLogger = (): Logger => {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger
}

const recordingLogger = (): { logger: Logger; warnings: string[] } => {
  const warnings: string[] = []
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message) => void warnings.push(message),
    error: () => {},
    child: () => logger,
  }
  return { logger, warnings }
}

const WEDDING = asEventId('wedding')
const GALA = asEventId('gala')

const photoPublished = (eventId = WEDDING): DomainEvent => ({
  type: 'photo.moderated',
  eventId,
  photoId: asPhotoId('photo-1'),
  status: 'published',
})

/**
 * Subscribes where the subscription is expected to be accepted, and hands back the
 * teardown.
 *
 * The refusal has its own tests below; everywhere else a refusal would be a silent
 * change of what the test is exercising, so it fails loudly here instead.
 */
const subscribed = (
  bus: InMemoryEventBus,
  eventId: EventId,
  listener: EventListener,
): Unsubscribe => {
  const result = bus.subscribe(eventId, listener)
  if (!result.ok) throw new Error(`the bus refused a subscription: ${result.error.code}`)
  return result.value
}

describe('inMemoryEventBus', () => {
  it('delivers an event to a subscriber of that event', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const received: DomainEvent[] = []
    bus.subscribe(WEDDING, (event) => void received.push(event))

    bus.publish(photoPublished())

    expect(received).toEqual([photoPublished()])
  })

  it('never delivers one event to another event subscriber', () => {
    // The 1.0 defect: a single global emitter delivered everything to everyone and
    // trusted each listener to filter by party name inside the callback.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const gala: DomainEvent[] = []
    bus.subscribe(GALA, (event) => void gala.push(event))

    bus.publish(photoPublished(WEDDING))

    expect(gala).toEqual([])
  })

  it('delivers to every subscriber of the same event', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const first = vi.fn()
    const second = vi.fn()
    bus.subscribe(WEDDING, first)
    bus.subscribe(WEDDING, second)

    bus.publish(photoPublished())

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('publishing with no subscribers is a no-op', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })

    expect(() => bus.publish(photoPublished())).not.toThrow()
    expect(bus.subscriberCount()).toBe(0)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const listener = vi.fn()
    const unsubscribe = subscribed(bus, WEDDING, listener)

    unsubscribe()
    bus.publish(photoPublished())

    expect(listener).not.toHaveBeenCalled()
    expect(bus.subscriberCount(WEDDING)).toBe(0)
  })

  it('unsubscribe is idempotent and does not disturb a later subscription', () => {
    // An SSE handler plausibly unsubscribes on both `close` and `error`.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const first = vi.fn()
    const unsubscribe = subscribed(bus, WEDDING, first)
    unsubscribe()
    unsubscribe()

    const second = vi.fn()
    bus.subscribe(WEDDING, second)
    bus.publish(photoPublished())

    expect(second).toHaveBeenCalledTimes(1)
    expect(bus.subscriberCount(WEDDING)).toBe(1)
  })

  it('survives a subscriber that unsubscribes itself mid-broadcast', () => {
    // A projector's connection closing while an event is being delivered mutates the
    // subscriber set during iteration.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const later = vi.fn()
    const unsubscribeSelf = subscribed(bus, WEDDING, () => unsubscribeSelf())
    bus.subscribe(WEDDING, later)

    bus.publish(photoPublished())

    expect(later).toHaveBeenCalledTimes(1)
    expect(bus.subscriberCount(WEDDING)).toBe(1)
  })

  it('a throwing subscriber cannot fail the publisher', () => {
    // The publisher is on a guest's upload request path. A broken wall must not turn
    // a successful upload into a 500.
    const { logger, warnings } = recordingLogger()
    const bus = createInMemoryEventBus({ logger })
    bus.subscribe(WEDDING, () => {
      throw new Error('projector exploded')
    })
    const healthy = vi.fn()
    bus.subscribe(WEDDING, healthy)

    expect(() => bus.publish(photoPublished())).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(warnings).toContain('event bus subscriber threw')
  })

  it('a subscriber that throws a non-Error still cannot fail the publisher', () => {
    // `throw 'boom'` in a callback is not hypothetical, and an error report that says
    // `undefined` is how a broken projector stays broken. The publisher is on the
    // guest's upload path either way.
    const { logger, warnings } = recordingLogger()
    const bus = createInMemoryEventBus({ logger })
    bus.subscribe(WEDDING, () => {
      throw 'projector exploded'
    })
    const healthy = vi.fn()
    bus.subscribe(WEDDING, healthy)

    expect(() => bus.publish(photoPublished())).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(warnings).toContain('event bus subscriber threw')
  })

  it('unsubscribing after the bus has been closed is not an error', () => {
    // Shutdown drops every listener, and an SSE handler's `close` callback fires after
    // that. It must not resurrect an entry for an event nobody is watching any more.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const unsubscribe = subscribed(bus, WEDDING, vi.fn())
    bus.close()

    expect(() => unsubscribe()).not.toThrow()
    expect(bus.subscriberCount()).toBe(0)
  })

  it('refuses a subscription past the per-event limit, and says so', () => {
    // The defect this replaces: the refusal came back as an empty unsubscribe function,
    // which is indistinguishable from a live subscription. The caller could not tell it
    // had been refused, so the HTTP layer answered 200 and the projector behind it went
    // quiet for the rest of the evening while still reporting itself connected.
    const { logger, warnings } = recordingLogger()
    const bus = createInMemoryEventBus({ logger, maxSubscribersPerEvent: 2 })
    bus.subscribe(WEDDING, vi.fn())
    bus.subscribe(WEDDING, vi.fn())

    const refused = vi.fn()
    const result = bus.subscribe(WEDDING, refused)
    bus.publish(photoPublished())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('service.notReady')
    expect(refused).not.toHaveBeenCalled()
    expect(bus.subscriberCount(WEDDING)).toBe(2)
    expect(warnings).toContain('event bus subscriber limit reached, refusing subscription')
  })

  it('accepts a subscription again once a slot is released', () => {
    // The cap bounds what is held, not what has ever connected: a projector that
    // reconnects after the room filled up must be able to get back in.
    const bus = createInMemoryEventBus({ logger: silentLogger(), maxSubscribersPerEvent: 1 })
    const leaving = subscribed(bus, WEDDING, vi.fn())
    expect(bus.subscribe(WEDDING, vi.fn()).ok).toBe(false)

    leaving()

    const listener = vi.fn()
    expect(bus.subscribe(WEDDING, listener).ok).toBe(true)
    bus.publish(photoPublished())
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('gives every subscriber of one announcement the same delivery sequence', () => {
    // The number the SSE hub writes as the frame's `id:`. Minted per subscriber, one
    // photo became a different id for the projector and for each console, so
    // `Last-Event-ID` was six private cursors rather than one shared one.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const seen: Delivery[] = []
    subscribed(bus, WEDDING, (_event, delivery) => void seen.push(delivery))
    subscribed(bus, WEDDING, (_event, delivery) => void seen.push(delivery))

    bus.publish(photoPublished())

    expect(seen.map((delivery) => delivery.sequence)).toEqual([1, 1])
  })

  it('numbers each announcement once, in order, across events', () => {
    // Shared across events rather than per event, so a number is never handed out twice
    // in one process — a per-event counter would have to be dropped when its last
    // subscriber left, and would then restart behind the cursor a reconnecting client
    // still holds.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const wedding: number[] = []
    const gala: number[] = []
    subscribed(bus, WEDDING, (_event, delivery) => void wedding.push(delivery.sequence))
    subscribed(bus, GALA, (_event, delivery) => void gala.push(delivery.sequence))

    bus.publish(photoPublished(WEDDING))
    bus.publish(photoPublished(GALA))
    bus.publish(photoPublished(WEDDING))

    expect(wedding).toEqual([1, 3])
    expect(gala).toEqual([2])
  })

  it('spends no number on an announcement nobody is listening to', () => {
    // Ids stay dense for the clients that exist, and an event with no projector costs
    // nothing at all.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    bus.publish(photoPublished(GALA))
    const sequences: number[] = []
    subscribed(bus, WEDDING, (_event, delivery) => void sequences.push(delivery.sequence))

    bus.publish(photoPublished(WEDDING))

    expect(sequences).toEqual([1])
  })

  it('applies the limit per event, not globally', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger(), maxSubscribersPerEvent: 1 })
    bus.subscribe(WEDDING, vi.fn())
    const galaListener = vi.fn()
    bus.subscribe(GALA, galaListener)

    bus.publish(photoPublished(GALA))

    expect(galaListener).toHaveBeenCalledTimes(1)
  })

  it('counts subscribers per event and in total', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    bus.subscribe(WEDDING, vi.fn())
    bus.subscribe(WEDDING, vi.fn())
    bus.subscribe(GALA, vi.fn())

    expect(bus.subscriberCount(WEDDING)).toBe(2)
    expect(bus.subscriberCount(GALA)).toBe(1)
    expect(bus.subscriberCount()).toBe(3)
    expect(bus.subscriberCount(asEventId('never-subscribed'))).toBe(0)
  })

  it('drops every listener on close, so no callback outlives shutdown', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const listener = vi.fn()
    bus.subscribe(WEDDING, listener)

    bus.close()
    bus.publish(photoPublished())

    expect(listener).not.toHaveBeenCalled()
    expect(bus.subscriberCount()).toBe(0)
  })
})
