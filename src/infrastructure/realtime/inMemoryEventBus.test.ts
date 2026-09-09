import { describe, expect, it, vi } from 'vitest'
import { createInMemoryEventBus } from './inMemoryEventBus'
import type { DomainEvent } from '../../application/ports/eventBus'
import type { Logger } from '../../application/ports/logger'
import { asEventId, asPhotoId } from '../../domain/shared/ids'

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
    const unsubscribe = bus.subscribe(WEDDING, listener)

    unsubscribe()
    bus.publish(photoPublished())

    expect(listener).not.toHaveBeenCalled()
    expect(bus.subscriberCount(WEDDING)).toBe(0)
  })

  it('unsubscribe is idempotent and does not disturb a later subscription', () => {
    // An SSE handler plausibly unsubscribes on both `close` and `error`.
    const bus = createInMemoryEventBus({ logger: silentLogger() })
    const first = vi.fn()
    const unsubscribe = bus.subscribe(WEDDING, first)
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
    const unsubscribeSelf = bus.subscribe(WEDDING, () => unsubscribeSelf())
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

  it('refuses a subscription past the per-event limit and still returns a usable unsubscribe', () => {
    const { logger, warnings } = recordingLogger()
    const bus = createInMemoryEventBus({ logger, maxSubscribersPerEvent: 2 })
    bus.subscribe(WEDDING, vi.fn())
    bus.subscribe(WEDDING, vi.fn())

    const refused = vi.fn()
    const unsubscribe = bus.subscribe(WEDDING, refused)
    bus.publish(photoPublished())

    expect(refused).not.toHaveBeenCalled()
    expect(bus.subscriberCount(WEDDING)).toBe(2)
    expect(warnings).toContain('event bus subscriber limit reached, refusing subscription')
    expect(() => unsubscribe()).not.toThrow()
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
