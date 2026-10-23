import { describe, expect, it } from 'vitest'
import { asEventId, asPhotoId } from '../../domain/shared/ids'
import type { DomainEvent } from '../ports/eventBus'
import { eventBusContract } from './contracts/eventBusContract'
import { RecordingEventBus } from './recordingEventBus'

eventBusContract('recording', () => {
  const bus = new RecordingEventBus()
  return { bus, subscriberCount: (eventId) => bus.subscriberCount(eventId) }
})

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
