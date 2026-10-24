import { beforeEach, describe, expect, it } from 'vitest'
import type {
  Delivery,
  DomainEvent,
  EventBus,
  EventListener,
  Unsubscribe,
} from '../../ports/eventBus'
import { asEventId, asPhotoId, type EventId } from '../../../domain/shared/ids'

/**
 * The shared `EventBus` contract, run against the in-memory adapter the server uses and
 * against `RecordingEventBus`, the double every use case test announces on.
 *
 * The two are about seventy lines of the same delivery logic written twice, and the double
 * is only worth its place if a use case test sees what the server would deliver: that a
 * wedding's activity never reaches a gala's projector, that one announcement is numbered
 * once for every subscriber, that a subscriber leaving mid-broadcast does not make the next
 * one miss it. 1.0's single global `EventEmitter` failed the first of those silently.
 *
 * What stays out, because it is one implementation's own: the per-event subscriber cap and
 * its refusal, `close()`, and the logging of a subscriber that threw (the adapter); the
 * recording itself, `listenerErrors` and `clear()` (the double).
 */

/** What both buses offer besides the port: how many listeners are scoped to an event. */
export interface EventBusSubject {
  readonly bus: EventBus
  readonly subscriberCount: (eventId?: EventId) => number
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const moderated = (eventId: EventId, photo = 'photo-1'): DomainEvent => ({
  type: 'photo.moderated',
  eventId,
  photoId: asPhotoId(photo),
  status: 'published',
})

export const eventBusContract = (name: string, makeSubject: () => EventBusSubject): void => {
  describe(`EventBus contract: ${name}`, () => {
    let bus: EventBus
    let subscriberCount: EventBusSubject['subscriberCount']

    beforeEach(() => {
      ;({ bus, subscriberCount } = makeSubject())
    })

    /** Subscribes where the subscription must be accepted; a refusal fails the test loudly. */
    const subscribed = (eventId: EventId, listener: EventListener): Unsubscribe => {
      const result = bus.subscribe(eventId, listener)
      if (!result.ok) throw new Error(`the bus refused a subscription: ${result.error.code}`)
      return result.value
    }

    it('delivers an announcement to a subscriber of that event, with its delivery', () => {
      const heard: [DomainEvent, Delivery][] = []
      subscribed(WEDDING, (event, delivery) => heard.push([event, delivery]))

      bus.publish(moderated(WEDDING))

      expect(heard).toEqual([[moderated(WEDDING), { sequence: 1 }]])
    })

    it('never delivers one event’s activity to a subscriber of another', () => {
      const heard: DomainEvent[] = []
      subscribed(GALA, (event) => heard.push(event))

      bus.publish(moderated(WEDDING))

      expect(heard).toEqual([])
    })

    it('delivers to every subscriber of the event, in the order they subscribed', () => {
      const order: string[] = []
      subscribed(WEDDING, () => order.push('first'))
      subscribed(WEDDING, () => order.push('second'))
      subscribed(WEDDING, () => order.push('third'))

      bus.publish(moderated(WEDDING))

      expect(order).toEqual(['first', 'second', 'third'])
    })

    it('lets an announcement nobody listens to pass without an error', () => {
      expect(() => bus.publish(moderated(WEDDING))).not.toThrow()
    })

    it('stops delivering to a subscriber that left, and goes on delivering to the others', () => {
      const leaver: DomainEvent[] = []
      const stayer: DomainEvent[] = []
      const leave = subscribed(WEDDING, (event) => leaver.push(event))
      subscribed(WEDDING, (event) => stayer.push(event))

      bus.publish(moderated(WEDDING, 'before'))
      leave()
      bus.publish(moderated(WEDDING, 'after'))

      expect(leaver).toHaveLength(1)
      expect(stayer).toHaveLength(2)
    })

    it('treats a second unsubscribe as nothing, even once the same listener has subscribed again', () => {
      // An SSE handler unsubscribes on both `close` and `error`, and a reconnecting client
      // subscribes the same function again in between: the stale second call must not
      // take the new subscription away.
      const heard: DomainEvent[] = []
      const listener: EventListener = (event) => heard.push(event)
      const first = subscribed(WEDDING, listener)
      first()
      subscribed(WEDDING, listener)

      first()
      bus.publish(moderated(WEDDING))

      expect(heard).toHaveLength(1)
    })

    it('does not skip the next subscriber when one unsubscribes itself mid-broadcast', () => {
      const heard: string[] = []
      const leave = subscribed(WEDDING, () => {
        heard.push('leaver')
        leave()
      })
      subscribed(WEDDING, () => heard.push('next'))

      bus.publish(moderated(WEDDING))

      expect(heard).toEqual(['leaver', 'next'])
    })

    it('does not deliver an announcement to a subscriber that joined while it was being delivered', () => {
      const lateHeard: DomainEvent[] = []
      subscribed(WEDDING, () => {
        subscribed(WEDDING, (event) => lateHeard.push(event))
      })

      bus.publish(moderated(WEDDING, 'during'))
      expect(lateHeard).toEqual([])

      bus.publish(moderated(WEDDING, 'after'))
      expect(lateHeard).toEqual([moderated(WEDDING, 'after')])
    })

    it.each([
      ['an Error', new Error('projector fell over')],
      ['something that is not an Error', 'a bare string'],
    ])(
      'never lets a subscriber that throws %s fail the publisher or the others',
      (_label, thrown) => {
        // A slow or broken projector must not be able to fail a guest's upload.
        const heard: DomainEvent[] = []
        subscribed(WEDDING, () => {
          throw thrown
        })
        subscribed(WEDDING, (event) => heard.push(event))

        expect(() => bus.publish(moderated(WEDDING))).not.toThrow()
        expect(heard).toHaveLength(1)
      },
    )

    describe('the sequence a delivery carries', () => {
      it('gives every subscriber of one announcement the same number', () => {
        // The SSE hub numbers its frames from it: numbering inside each callback made N ids
        // for N connected clients and consumed the replay ring N times faster.
        const sequences: number[] = []
        subscribed(WEDDING, (_event, delivery) => sequences.push(delivery.sequence))
        subscribed(WEDDING, (_event, delivery) => sequences.push(delivery.sequence))
        bus.subscribeAll((_event, delivery) => sequences.push(delivery.sequence))

        bus.publish(moderated(WEDDING))

        expect(sequences).toEqual([1, 1, 1])
      })

      it('numbers each announcement once, in order, across every event', () => {
        const sequences: number[] = []
        bus.subscribeAll((_event, delivery) => sequences.push(delivery.sequence))

        bus.publish(moderated(WEDDING))
        bus.publish(moderated(GALA))
        bus.publish(moderated(WEDDING))

        expect(sequences).toEqual([1, 2, 3])
      })

      it('spends no number on an announcement nobody was listening to', () => {
        const sequences: number[] = []
        subscribed(WEDDING, (_event, delivery) => sequences.push(delivery.sequence))

        bus.publish(moderated(GALA))
        bus.publish(moderated(WEDDING))

        expect(sequences).toEqual([1])
      })

      it('never reuses a number once the last subscriber has left', () => {
        // A client that reconnects after its event went quiet still holds a cursor, which
        // must stay strictly behind whatever comes next.
        const sequences: number[] = []
        const leave = subscribed(WEDDING, (_event, delivery) => sequences.push(delivery.sequence))
        bus.publish(moderated(WEDDING))
        leave()
        subscribed(WEDDING, (_event, delivery) => sequences.push(delivery.sequence))

        bus.publish(moderated(WEDDING))

        expect(sequences).toEqual([1, 2])
      })
    })

    describe('listening to every event', () => {
      it('hears every event’s activity, which a subscriber scoped to one event never does', () => {
        const everything: DomainEvent[] = []
        const weddingOnly: DomainEvent[] = []
        bus.subscribeAll((event) => everything.push(event))
        subscribed(WEDDING, (event) => weddingOnly.push(event))

        bus.publish(moderated(WEDDING))
        bus.publish(moderated(GALA))

        expect(everything).toEqual([moderated(WEDDING), moderated(GALA)])
        expect(weddingOnly).toEqual([moderated(WEDDING)])
      })

      it('is called after the subscribers scoped to the event', () => {
        const order: string[] = []
        bus.subscribeAll(() => order.push('all'))
        subscribed(WEDDING, () => order.push('scoped'))

        bus.publish(moderated(WEDDING))

        expect(order).toEqual(['scoped', 'all'])
      })

      it('stops hearing once it unsubscribes, and a second unsubscribe is nothing', () => {
        const heard: DomainEvent[] = []
        const listener: EventListener = (event) => heard.push(event)
        const first = bus.subscribeAll(listener)
        first()
        bus.subscribeAll(listener)

        first()
        bus.publish(moderated(WEDDING))

        expect(heard).toHaveLength(1)
      })

      it('lets a listener that throws fail neither the publisher nor the others', () => {
        const heard: DomainEvent[] = []
        bus.subscribeAll(() => {
          throw new Error('the worker fell over')
        })
        bus.subscribeAll((event) => heard.push(event))

        expect(() => bus.publish(moderated(WEDDING))).not.toThrow()
        expect(heard).toHaveLength(1)
      })

      it('is not counted among the subscribers scoped to an event', () => {
        bus.subscribeAll(() => undefined)

        expect(subscriberCount(WEDDING)).toBe(0)
        expect(subscriberCount()).toBe(0)
      })
    })

    it('counts the subscribers of each event and of all of them, and fewer after one leaves', () => {
      const leave = subscribed(WEDDING, () => undefined)
      subscribed(WEDDING, () => undefined)
      subscribed(GALA, () => undefined)

      expect([subscriberCount(WEDDING), subscriberCount(GALA), subscriberCount()]).toEqual([
        2, 1, 3,
      ])

      leave()

      expect([subscriberCount(WEDDING), subscriberCount(GALA), subscriberCount()]).toEqual([
        1, 1, 2,
      ])
    })
  })
}
