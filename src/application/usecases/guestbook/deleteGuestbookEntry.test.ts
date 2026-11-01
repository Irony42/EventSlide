import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asGuestbookEntryId } from '../../../domain/shared/ids'
import { aGuestbookEntry, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeleteGuestbookEntry, type DeleteGuestbookEntry } from './deleteGuestbookEntry'

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-lea')
const M1 = asGuestbookEntryId('m1')

describe('deleteGuestbookEntry', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let remove: DeleteGuestbookEntry

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    events.seed(anEvent({ id: 'event-1' }))
    guestbook.seed(aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', eventId: 'event-1' }))
    remove = makeDeleteGuestbookEntry({ events, guestbook, bus, clock })
  })

  const run = (input: { guestId?: typeof LEA; entryId?: typeof M1; eventId?: typeof EVENT } = {}) =>
    remove({ eventId: EVENT, entryId: M1, guestId: LEA, ...input })

  const codeOf = async (promise: ReturnType<typeof run>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  it('lets the author take back a pending message, and tells the bus', async () => {
    const result = await run()

    expect(result.ok).toBe(true)
    expect(guestbook.all(EVENT)).toEqual([])
    expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
  })

  it('answers another guest message as not found, and leaves it', async () => {
    expect(await codeOf(run({ guestId: asGuestId('guest-sam') }))).toBe('guestbook.notFound')
    expect(guestbook.all(EVENT)).toHaveLength(1)
    expect(bus.published).toEqual([])
  })

  it('answers another event message as not found', async () => {
    events.seed(anEvent({ id: 'event-2', slug: 'other', joinCode: 'OTHER1' }))

    expect(await codeOf(run({ eventId: asEventId('event-2') }))).toBe('guestbook.notFound')
  })

  it('answers an unknown id, and a message the operator took down, as not found', async () => {
    expect(await codeOf(run({ entryId: asGuestbookEntryId('nope') }))).toBe('guestbook.notFound')

    guestbook.takeDown(EVENT, M1, new Date(0))
    expect(await codeOf(run())).toBe('guestbook.notFound')
  })

  it('answers an unknown or taken-down event as not there', async () => {
    expect(await codeOf(run({ eventId: asEventId('nope') }))).toBe('event.notFound')

    await events.setTakenDown(EVENT, new Date(0))
    expect(await codeOf(run())).toBe('event.notFound')
  })

  it('refuses with the host veto when self-delete is switched off', async () => {
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))

    expect(await codeOf(run())).toBe('event.guestSelfDeleteDisabled')
    expect(guestbook.all(EVENT)).toHaveLength(1)
  })

  it('refuses once the grace window is over', async () => {
    clock.advance(901_000)

    expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
  })

  it('refuses once the message is on the wall, as it does a published photograph', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', eventId: 'event-1', moderation: 'auto' }),
    )

    expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
  })

  it('fails generically on a purge-held event, after the lookup so an unknown id stays a 404', async () => {
    await events.setPurgeHeld(EVENT, new Date(0))

    expect(await codeOf(run())).toBe('guestbook.deleteFailed')
    expect(await codeOf(run({ entryId: asGuestbookEntryId('nope') }))).toBe('guestbook.notFound')
    expect(guestbook.all(EVENT)).toHaveLength(1)
  })
})
