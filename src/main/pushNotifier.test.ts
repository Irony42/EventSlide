import { beforeEach, describe, expect, it } from 'vitest'
import { PushSubscription } from '../domain/push/pushSubscription'
import { PUSH_MIN_INTERVAL_MS } from '../domain/push/pushNotice'
import type { EventBus, EventListener } from '../application/ports/eventBus'
import { CapturingLogger } from '../application/testing/capturingLogger'
import { FakePushSubscriptionRepository } from '../application/testing/fakePushSubscriptionRepository'
import {
  ARCHIVED,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../application/testing/guestInviteScene'
import { RecordingPushSender } from '../application/testing/recordingPushSender'
import { asGuestId, type EventId } from '../domain/shared/ids'
import type { MembershipRepository } from '../application/ports/userRepository'
import { FakeMembershipRepository } from '../application/testing/fakeMembershipRepository'
import { FakeUserRepository } from '../application/testing/fakeUserRepository'
import { aUser } from '../application/testing/builders'
import { MAX_PUSH_FAILURES } from '../domain/push/pushSubscription'
import { createPushNotifier } from './pushNotifier'

/**
 * Browser notifications (spec 30, lot 4): one message per event and per five minutes, counting what
 * came in meanwhile; only the owners, read on each send; the subscriptions the push service calls
 * gone are removed; nothing a guest wrote and nothing about the endpoint in the message or the logs.
 */

interface Timers {
  readonly pending: { at: number; task: () => void; cancelled: boolean }[]
  now: number
}

describe('the push notifier', () => {
  let scene: GuestInviteScene
  let subscriptions: FakePushSubscriptionRepository
  let sender: RecordingPushSender
  let logger: CapturingLogger
  let timers: Timers
  let listeners: EventListener[]
  let started = false

  beforeEach(async () => {
    scene = await guestInviteScene()
    subscriptions = new FakePushSubscriptionRepository()
    sender = new RecordingPushSender()
    logger = new CapturingLogger()
    timers = { pending: [], now: scene.clock.now().getTime() }
    listeners = []
    started = false
    memberships = null
  })

  let memberships: Pick<MembershipRepository, 'roleFor' | 'membershipFor'> | null = null
  const notifier = () => {
    const bus: Pick<EventBus, 'subscribeAll'> = {
      subscribeAll: (listener) => {
        listeners.push(listener)
        return () => void listeners.splice(listeners.indexOf(listener), 1)
      },
    }
    return createPushNotifier({
      bus,
      events: scene.events,
      memberships: memberships ?? scene.memberships,
      subscriptions,
      sender,
      clock: scene.clock,
      logger,
      schedule: (task, delay) => {
        const entry = { at: timers.now + delay, task, cancelled: false }
        timers.pending.push(entry)
        return () => void (entry.cancelled = true)
      },
    })
  }
  const begin = () => {
    const made = notifier()
    made.start()
    started = true
    return made
  }
  const reply = (eventId: EventId = WEDDING) =>
    listeners.forEach((listener) => listener({ type: 'rsvp.changed', eventId }, { sequence: 1 }))
  const subscribe = async (id: string, eventId: EventId = WEDDING, user = OWNER) =>
    void (await subscriptions.upsert(
      PushSubscription.create({
        id,
        userId: user,
        eventId,
        endpoint: `https://fcm.googleapis.com/${id}`,
        p256dh: 'B' + 'A'.repeat(86),
        auth: 'A'.repeat(22),
        createdAt: scene.clock.now(),
      }),
      10,
    ))
  /** Moves time to `to` and runs what is due, in order, and what that schedules in turn. */
  const advance = async (toMs: number) => {
    timers.now = toMs
    scene.clock.set(new Date(toMs))
    for (;;) {
      const due = timers.pending.find((timer) => !timer.cancelled && timer.at <= toMs)
      if (due === undefined) break
      due.cancelled = true
      due.task()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const T = () => scene.clock.now().getTime()
  const payloads = () => sender.sent.map((entry) => JSON.parse(entry.payload))

  it('tells the owner’s browsers after the first reply, with the event’s address and a count of one', async () => {
    await subscribe('s-1')
    begin()

    reply()
    await advance(T())

    expect(payloads()).toEqual([{ v: 1, type: 'rsvp.new', slug: 'camille-et-sacha', count: 1 }])
  })

  it('says nothing of a guest: the message has four fields and no name, diet or word', async () => {
    await subscribe('s-1')
    begin()

    reply()
    await advance(T())

    const [message] = payloads()
    expect(Object.keys(message).sort()).toEqual(['count', 'slug', 'type', 'v'])
    expect(JSON.stringify(sender.sent.map((entry) => entry.payload))).not.toMatch(
      /name|diet|message|adults/iu,
    )
  })

  it('joins a burst of the same moment into one message', async () => {
    await subscribe('s-1')
    begin()

    reply()
    reply()
    reply()
    await advance(T())

    expect(payloads()).toEqual([{ v: 1, type: 'rsvp.new', slug: 'camille-et-sacha', count: 3 }])
  })

  it('sends at most one message per five minutes, and tells the replies that came meanwhile together', async () => {
    await subscribe('s-1')
    const start = T()
    begin()
    reply()
    await advance(start)
    expect(payloads()).toHaveLength(1)

    await advance(start + 60_000)
    reply()
    await advance(start + 120_000)
    reply()
    await advance(start + 240_000)
    expect(payloads()).toHaveLength(1)

    await advance(start + PUSH_MIN_INTERVAL_MS)
    expect(payloads().map((message) => message.count)).toEqual([1, 2])
  })

  it('tells at once again once the five minutes are past without a reply', async () => {
    await subscribe('s-1')
    const start = T()
    begin()
    reply()
    await advance(start)

    await advance(start + PUSH_MIN_INTERVAL_MS + 1)
    reply()
    await advance(start + PUSH_MIN_INTERVAL_MS + 1)

    expect(payloads().map((message) => message.count)).toEqual([1, 1])
  })

  it('keeps the events apart: another event’s reply tells only its own browsers, on its own clock', async () => {
    await subscribe('s-wedding', WEDDING)
    await subscribe('s-gala', GALA, STRANGER)
    begin()

    reply(WEDDING)
    await advance(T())
    reply(GALA)
    await advance(T())

    expect(sender.sent.map((entry) => entry.subscription.id)).toEqual(['s-wedding', 's-gala'])
  })

  it('does not send when nobody subscribed, and sends nothing before a reply', async () => {
    begin()

    reply()
    await advance(T())

    expect(sender.sent).toHaveLength(0)
  })

  it('tells only those who are still owners, read now: a moderator’s or a stranger’s subscription is not sent to, and is removed', async () => {
    await subscribe('s-owner')
    await subscribe('s-mod', WEDDING, MODERATOR)
    begin()

    reply()
    await advance(T())

    expect(sender.sent.map((entry) => entry.subscription.id)).toEqual(['s-owner'])
    expect((await subscriptions.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-owner'])
  })

  it('removes the subscriptions of an account that has no membership any more', async () => {
    await subscribe('s-owner')
    await subscribe('s-left', WEDDING, STRANGER)
    begin()

    reply()
    await advance(T())

    expect(sender.sent.map((entry) => entry.subscription.id)).toEqual(['s-owner'])
    expect((await subscriptions.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-owner'])
  })

  it('skips and keeps the subscription of an owner whose account is switched off', async () => {
    await subscribe('s-owner')
    const users = new FakeUserRepository().seed(aUser({ id: OWNER }).disable(scene.clock.now()))
    memberships = new FakeMembershipRepository({ users }).seed({
      eventId: WEDDING,
      userId: OWNER,
      role: 'owner',
      grantedAt: scene.clock.now(),
    })
    begin()

    reply()
    await advance(T())

    expect(sender.sent).toHaveLength(0)
    expect(await subscriptions.listByEvent(WEDDING)).toHaveLength(1)
  })

  it('prunes a subscription that failed five times in a row, and a delivery starts the count again', async () => {
    await subscribe('s-dead')
    await subscribe('s-flaky')
    sender.outcomes.set('s-dead', 'failed')
    sender.outcomes.set('s-flaky', 'failed')
    begin()
    let at = T()
    const send = async () => {
      reply()
      await advance(at)
      at += PUSH_MIN_INTERVAL_MS
    }

    for (let i = 0; i < MAX_PUSH_FAILURES - 1; i += 1) await send()
    expect((await subscriptions.listByEvent(WEDDING)).map((row) => row.id)).toEqual([
      's-dead',
      's-flaky',
    ])
    sender.outcomes.delete('s-flaky')
    await send()
    sender.outcomes.set('s-flaky', 'failed')
    for (let i = 0; i < MAX_PUSH_FAILURES - 1; i += 1) await send()

    expect((await subscriptions.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-flaky'])
    expect(
      logger.lines.filter((line) => line.message === 'browser notifications sent').at(-1)?.context,
    ).toMatchObject({ pruned: 0 })
  })

  it('shares the fifty sends out between the owners, newest browser first for each', async () => {
    await scene.memberships.grant({
      eventId: WEDDING,
      userId: STRANGER,
      role: 'owner',
      grantedAt: scene.clock.now(),
    })
    const make = async (id: string, user: typeof OWNER, at: number) =>
      void (await subscriptions.upsert(
        PushSubscription.create({
          id,
          userId: user,
          eventId: WEDDING,
          endpoint: `https://fcm.googleapis.com/${id}`,
          p256dh: 'B' + 'A'.repeat(86),
          auth: 'A'.repeat(22),
          createdAt: new Date(at),
        }),
        100,
      ))
    for (let i = 0; i < 10; i += 1) await make(`a-${i}`, OWNER, 1000 + i)
    for (let i = 0; i < 45; i += 1) await make(`b-${i}`, STRANGER, 5000 + i)
    begin()

    reply()
    await advance(T())

    const ids = sender.sent.map((entry) => entry.subscription.id)
    expect(ids).toHaveLength(50)
    // All ten of the first owner are told, though the other has more than the cap on its own.
    expect(ids.filter((id) => id.startsWith('a-'))).toHaveLength(10)
    expect(ids).toContain('b-44')
    expect(ids).not.toContain('b-0')
  })

  it('never runs two deliveries of one event at once: a reply during a slow one goes in the next', async () => {
    await subscribe('s-1')
    let release: () => void = () => undefined
    sender.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const start = T()
    begin()

    reply()
    await advance(start)
    expect(sender.sent).toHaveLength(1)
    reply()
    await advance(start + PUSH_MIN_INTERVAL_MS)
    expect(sender.sent).toHaveLength(1)
    sender.hold = null
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await advance(start + 2 * PUSH_MIN_INTERVAL_MS)

    expect(payloads().map((message) => message.count)).toEqual([1, 1])
  })

  it('removes a subscription the push service calls gone, and keeps one that merely failed', async () => {
    await subscribe('s-gone')
    await subscribe('s-failed')
    await subscribe('s-ok')
    sender.outcomes.set('s-gone', 'gone')
    sender.outcomes.set('s-failed', 'failed')
    begin()

    reply()
    await advance(T())

    expect((await subscriptions.listByEvent(WEDDING)).map((row) => row.id)).toEqual([
      's-failed',
      's-ok',
    ])
    expect(
      logger.lines.find((line) => line.message === 'browser notifications sent')?.context,
    ).toMatchObject({
      delivered: 1,
      gone: 1,
      failed: 1,
    })
  })

  it('logs counts only, never an endpoint, a key or the message', async () => {
    await subscribe('s-1')
    begin()

    reply()
    await advance(T())

    const log = JSON.stringify(logger.lines)
    expect(log).not.toMatch(/fcm|googleapis|rsvp\.new|camille-et-sacha/u)
  })

  it('does not tell an event the operator took down, nor one that is gone', async () => {
    await subscribe('s-1')
    await subscribe('s-archived', ARCHIVED)
    await scene.events.setTakenDown(WEDDING, scene.clock.now())
    begin()

    reply(WEDDING)
    reply(EVENT_UNKNOWN)
    await advance(T())

    expect(sender.sent).toHaveLength(0)
  })

  it('survives a sender that throws, and logs it without a word of the subscription', async () => {
    await subscribe('s-1')
    sender.send = async () => {
      throw new Error('boom https://fcm.googleapis.com/s-1')
    }
    begin()

    reply()
    await advance(T())

    expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
    expect(JSON.stringify(logger.lines)).not.toContain('googleapis')
  })

  it('does nothing after stop: no signal is heard and a pending message is cancelled', async () => {
    await subscribe('s-1')
    const made = begin()
    reply()

    made.stop()
    await advance(T() + PUSH_MIN_INTERVAL_MS)

    expect(listeners).toHaveLength(0)
    expect(sender.sent).toHaveLength(0)
    expect(started).toBe(true)
  })

  it('ignores every signal but a reply: a photograph does not tell the host', async () => {
    await subscribe('s-1')
    begin()

    listeners.forEach((listener) =>
      listener(
        { type: 'guest.joined', eventId: WEDDING, guestId: asGuestId('g-1') },
        { sequence: 1 },
      ),
    )
    await advance(T() + PUSH_MIN_INTERVAL_MS)

    expect(timers.pending).toHaveLength(0)
    expect(sender.sent).toHaveLength(0)
  })

  it('holds one timer for a burst, so that stop leaves none behind', async () => {
    await subscribe('s-1')
    const made = begin()

    reply()
    reply()
    reply()
    expect(timers.pending.filter((timer) => !timer.cancelled)).toHaveLength(1)
    made.stop()

    expect(timers.pending.filter((timer) => !timer.cancelled)).toHaveLength(0)
  })

  it('tells at most fifty browsers per message, however many the owners hold', async () => {
    for (let i = 0; i < 60; i += 1) {
      await subscriptions.upsert(
        PushSubscription.create({
          id: `bulk-${i}`,
          userId: OWNER,
          eventId: WEDDING,
          endpoint: `https://fcm.googleapis.com/bulk-${i}`,
          p256dh: 'B' + 'A'.repeat(86),
          auth: 'A'.repeat(22),
          createdAt: scene.clock.now(),
        }),
        100,
      )
    }
    begin()

    reply()
    await advance(T())

    expect(sender.sent).toHaveLength(50)
  })

  it('does not listen twice when started twice', () => {
    const made = notifier()

    made.start()
    made.start()

    expect(listeners).toHaveLength(1)
  })

  it('forgets an event that has been quiet for an interval, so its state does not pile up', async () => {
    await subscribe('s-1')
    await subscribe('s-gala', GALA, STRANGER)
    const start = T()
    begin()
    reply(WEDDING)
    await advance(start)

    // A later message of another event is where the old one is dropped; the wedding then tells at once.
    await advance(start + 2 * PUSH_MIN_INTERVAL_MS)
    reply(GALA)
    await advance(start + 2 * PUSH_MIN_INTERVAL_MS)
    reply(WEDDING)
    await advance(start + 2 * PUSH_MIN_INTERVAL_MS)

    expect(sender.sent.map((entry) => entry.subscription.id)).toEqual(['s-1', 's-gala', 's-1'])
  })
})

const EVENT_UNKNOWN = 'evt-unknown' as EventId
