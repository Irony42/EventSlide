import { describe, expect, it } from 'vitest'
import { asEventId, asPhotoId } from '../../domain/shared/ids'
import type { DomainEvent } from '../ports/eventBus'
import { RecordingEventBus } from './recordingEventBus'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const uploaded = (eventId: string, photoId: string): DomainEvent => ({
  type: 'photo.uploaded',
  eventId: asEventId(eventId),
  photoId: asPhotoId(photoId),
})

describe('RecordingEventBus', () => {
  it('records what was announced, in order', async () => {
    const bus = new RecordingEventBus()

    bus.publish(uploaded('evt-wedding', 'p1'))
    bus.publish(uploaded('evt-wedding', 'p2'))

    expect(bus.published).toEqual([uploaded('evt-wedding', 'p1'), uploaded('evt-wedding', 'p2')])
  })

  it('delivers an event to a subscriber of that event', async () => {
    const bus = new RecordingEventBus()
    const seen: DomainEvent[] = []
    bus.subscribe(WEDDING, (event) => seen.push(event))

    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toEqual([uploaded('evt-wedding', 'p1')])
  })

  it('never delivers one event activity to another event subscriber', async () => {
    const bus = new RecordingEventBus()
    const seen: DomainEvent[] = []
    bus.subscribe(GALA, (event) => seen.push(event))

    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toEqual([])
  })

  it('delivers to every subscriber of the event', async () => {
    const bus = new RecordingEventBus()
    let deliveries = 0
    bus.subscribe(WEDDING, () => {
      deliveries += 1
    })
    bus.subscribe(WEDDING, () => {
      deliveries += 1
    })

    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(deliveries).toBe(2)
  })

  it('stops delivering once a subscriber unsubscribes', async () => {
    const bus = new RecordingEventBus()
    const seen: DomainEvent[] = []
    const unsubscribe = bus.subscribe(WEDDING, (event) => seen.push(event))

    unsubscribe()
    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toEqual([])
  })

  it('tolerates a second unsubscribe, which an SSE handler will send', async () => {
    const bus = new RecordingEventBus()
    const seen: DomainEvent[] = []
    const first = bus.subscribe(WEDDING, () => {})
    first()
    bus.subscribe(WEDDING, (event) => seen.push(event))

    first()
    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toEqual([uploaded('evt-wedding', 'p1')])
  })

  it('lets a subscriber unsubscribe itself mid-broadcast without skipping the next', async () => {
    const bus = new RecordingEventBus()
    const seen: string[] = []
    const unsubscribe = bus.subscribe(WEDDING, () => {
      seen.push('first')
      unsubscribe()
    })
    bus.subscribe(WEDDING, () => seen.push('second'))

    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toEqual(['first', 'second'])
  })

  it('never lets a subscriber failure reach the publisher', async () => {
    // A broken projector must not fail a guest upload: the publisher is on the request
    // path, a subscriber is not.
    const bus = new RecordingEventBus()
    bus.subscribe(WEDDING, () => {
      throw new Error('projector went away')
    })

    expect(() => bus.publish(uploaded('evt-wedding', 'p1'))).not.toThrow()
  })

  it('records a subscriber failure, so a test can still assert it happened', async () => {
    const bus = new RecordingEventBus()
    bus.subscribe(WEDDING, () => {
      throw new Error('projector went away')
    })

    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(bus.listenerErrors).toHaveLength(1)
  })

  it('reports what was announced for one event', async () => {
    const bus = new RecordingEventBus()

    bus.publish(uploaded('evt-wedding', 'p1'))
    bus.publish(uploaded('evt-gala', 'p9'))

    expect(bus.publishedFor(GALA)).toEqual([uploaded('evt-gala', 'p9')])
  })

  it('counts subscribers per event and in total', async () => {
    const bus = new RecordingEventBus()
    bus.subscribe(WEDDING, () => {})
    bus.subscribe(GALA, () => {})

    expect([bus.subscriberCount(WEDDING), bus.subscriberCount()]).toEqual([1, 2])
  })

  it('counts nobody for an event with no subscriber', async () => {
    expect(new RecordingEventBus().subscriberCount(WEDDING)).toBe(0)
  })

  it('forgets the recording on clear', async () => {
    const bus = new RecordingEventBus()
    bus.publish(uploaded('evt-wedding', 'p1'))

    bus.clear()

    expect(bus.published).toEqual([])
  })

  it('keeps its subscribers across a clear', async () => {
    const bus = new RecordingEventBus()
    const seen: DomainEvent[] = []
    bus.subscribe(WEDDING, (event) => seen.push(event))

    bus.clear()
    bus.publish(uploaded('evt-wedding', 'p1'))

    expect(seen).toHaveLength(1)
  })
})
