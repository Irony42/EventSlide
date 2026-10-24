import { describe, expect, it, vi } from 'vitest'
import { createInMemoryEventBus, type InMemoryEventBus } from './inMemoryEventBus'
import { eventBusContract } from '../../application/testing/contracts/eventBusContract'
import type { DomainEvent, EventListener, Unsubscribe } from '../../application/ports/eventBus'
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

eventBusContract('in-memory', () => {
  const bus = createInMemoryEventBus({ logger: silentLogger() })
  return { bus, subscriberCount: (eventId) => bus.subscriberCount(eventId) }
})

describe('inMemoryEventBus', () => {
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

  it('applies the limit per event, not globally', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger(), maxSubscribersPerEvent: 1 })
    bus.subscribe(WEDDING, vi.fn())
    const galaListener = vi.fn()
    bus.subscribe(GALA, galaListener)

    bus.publish(photoPublished(GALA))

    expect(galaListener).toHaveBeenCalledTimes(1)
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
