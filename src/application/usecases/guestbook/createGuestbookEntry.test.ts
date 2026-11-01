import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { AT, aGuestbookEntry, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeCreateGuestbookEntry, type CreateGuestbookEntry } from './createGuestbookEntry'

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-lea')
const DAY_MS = 86_400_000

describe('createGuestbookEntry', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let create: CreateGuestbookEntry

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestbook: true } }))
    create = makeCreateGuestbookEntry({
      events,
      guestbook,
      ids: new SequentialIdGenerator(),
      bus,
      clock,
    })
  })

  const write = (text: unknown = 'Merci pour tout', guestId = LEA, eventId = EVENT) =>
    create({ eventId, guestId, text })

  const codeOf = async (promise: ReturnType<typeof write>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  it('holds a message for the host on a moderated event, and tells the bus', async () => {
    const result = await write()

    expect(result.ok && result.value.entry.status).toBe('pending')
    expect(result.ok && result.value.duplicate).toBe(false)
    expect(guestbook.all(EVENT)).toHaveLength(1)
    expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
  })

  it('publishes on arrival, as an automatic decision, on an auto event', async () => {
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestbook: true, moderation: 'auto' } }))

    const result = await write()

    expect(result.ok && result.value.entry.status).toBe('published')
    expect(result.ok && result.value.entry.review).toEqual({ kind: 'automatic', at: AT })
  })

  it('signs the message with the guest the token proves, at the event it names', async () => {
    const result = await write('Bravo', asGuestId('guest-sam'))

    expect(result.ok && result.value.entry.guestId).toBe('guest-sam')
    expect(result.ok && result.value.entry.eventId).toBe(EVENT)
  })

  it('refuses when the host has not switched the guestbook on', async () => {
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestbook: false } }))

    expect(await codeOf(write())).toBe('guestbook.disabled')
    expect(bus.published).toEqual([])
  })

  it('refuses text the domain refuses, and says nothing to the bus', async () => {
    expect(await codeOf(write('   '))).toBe('guestbook.empty')
    expect(await codeOf(write('x'.repeat(501)))).toBe('guestbook.tooLong')
    expect(await codeOf(write(7))).toBe('guestbook.invalid')
    expect(bus.published).toEqual([])
  })

  it.each(['draft', 'archived'] as const)('refuses on a %s event', async (status) => {
    events.seed(anEvent({ id: 'event-1', status, settings: { allowGuestbook: true } }))

    expect(await codeOf(write())).toBe('event.notAcceptingUploads')
  })

  it('accepts on a closed event for seven days after it closed, and not after', async () => {
    const closedAt = new Date(AT.getTime() - DAY_MS)
    events.seed(
      anEvent({ id: 'event-1', status: 'closed', closedAt, settings: { allowGuestbook: true } }),
    )
    clock.set(new Date(closedAt.getTime() + 7 * DAY_MS - 1))
    expect((await write()).ok).toBe(true)

    clock.set(new Date(closedAt.getTime() + 7 * DAY_MS))
    expect(await codeOf(write('une autre fois'))).toBe('event.notAcceptingUploads')
  })

  it('answers an event the operator took down as an event that is not there', async () => {
    await events.setTakenDown(EVENT, new Date(0))

    expect(await codeOf(write())).toBe('event.notFound')
  })

  it('answers an unknown event as one that is not there', async () => {
    expect(await codeOf(write('Bravo', LEA, asEventId('nope')))).toBe('event.notFound')
  })

  it('refuses the fourth message of a guest and the 501st of an event, naming each limit', async () => {
    for (const text of ['un', 'deux', 'trois']) await write(text)
    const fourth = await write('quatre')
    expect(!fourth.ok && fourth.error.code).toBe('guestbook.limitReached')
    expect(!fourth.ok && fourth.error.details).toEqual({ max: 3 })

    for (let n = 0; n < 500; n += 1) {
      guestbook.seed(
        aGuestbookEntry({
          id: `fill-${n}`,
          eventId: 'event-1',
          guestId: `guest-${n}`,
          text: `fill-${n}`,
        }),
      )
    }
    const full = await write('un de plus', asGuestId('guest-late'))
    expect(!full.ok && full.error.code).toBe('guestbook.eventFull')
  })

  it('answers the same text twice within a minute with the first message, and announces nothing new', async () => {
    const first = await write('Merci')
    bus.published.length = 0
    clock.advance(10_000)

    const again = await write('Merci')

    expect(again.ok && again.value.duplicate).toBe(true)
    expect(again.ok && first.ok && again.value.entry.id).toBe(first.ok && first.value.entry.id)
    expect(guestbook.all(EVENT)).toHaveLength(1)
    expect(bus.published).toEqual([])
  })
})
