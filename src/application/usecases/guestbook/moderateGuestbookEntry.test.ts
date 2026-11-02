import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asGuestbookEntryId, asUserId } from '../../../domain/shared/ids'
import { aGuestbookEntry, anEvent, AT } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeModerateGuestbookEntry, type ModerateGuestbookEntry } from './moderateGuestbookEntry'

const EVENT = asEventId('event-1')
const M1 = asGuestbookEntryId('m1')
const MODERATOR = asUserId('user-2')

const moderator: PhotoActor = { kind: 'host', userId: MODERATOR }
const guest: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }

describe('moderateGuestbookEntry', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let moderate: ModerateGuestbookEntry

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    moderate = makeModerateGuestbookEntry({
      events,
      guestbook,
      memberships,
      bus,
      clock: new FakeClock(),
    })
    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
    guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1' }))
  })

  const run = (
    decision: 'publish' | 'hide' | 'reject',
    overrides: { actor?: PhotoActor; eventId?: typeof EVENT; entryId?: typeof M1 } = {},
  ) => moderate({ eventId: EVENT, entryId: M1, decision, actor: moderator, ...overrides })

  const codeOf = async (promise: ReturnType<typeof run>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  it('publishes a pending message and says so on the bus, once', async () => {
    const result = await run('publish')

    expect(result.ok && result.value.status).toBe('published')
    expect((await guestbook.findById(EVENT, M1))?.status).toBe('published')
    expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
  })

  it('records which host decided', async () => {
    await run('reject')

    expect((await guestbook.findById(EVENT, M1))?.review).toMatchObject({
      kind: 'host',
      userId: MODERATOR,
    })
  })

  it('hides a published message and refuses to hide a pending one, announcing nothing', async () => {
    expect(await codeOf(run('hide'))).toBe('guestbook.illegalTransition')
    expect(bus.published).toEqual([])

    await run('publish')
    expect((await run('hide')).ok).toBe(true)
    expect((await guestbook.findById(EVENT, M1))?.status).toBe('hidden')
  })

  it('answers another event message as not found, and leaves it untouched', async () => {
    guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-2' }))
    events.seed(anEvent({ id: 'event-2', slug: 'other', joinCode: 'OTHER1' }))

    expect(await codeOf(run('publish', { entryId: asGuestbookEntryId('nope') }))).toBe(
      'guestbook.notFound',
    )
    expect((await guestbook.findById(asEventId('event-2'), M1))?.status).toBe('pending')
  })

  it('answers a message the operator took down as not found', async () => {
    guestbook.takeDown(EVENT, M1, AT)

    expect(await codeOf(run('publish'))).toBe('guestbook.notFound')
  })

  it('refuses a guest, whatever the message', async () => {
    const result = await run('publish', { actor: guest })

    expect(!result.ok && result.error.kind).toBe('forbidden')
    expect((await guestbook.findById(EVENT, M1))?.status).toBe('pending')
  })

  it('refuses a user with no part in the event, as if the event did not exist', async () => {
    const stranger: PhotoActor = { kind: 'host', userId: asUserId('user-99') }

    expect(await codeOf(run('publish', { actor: stranger }))).toBe('event.notFound')
  })

  it('answers event.notFound for an unknown event, and for one the operator took down', async () => {
    expect(await codeOf(run('publish', { eventId: asEventId('event-404') }))).toBe('event.notFound')
    await events.setTakenDown(EVENT, AT)
    expect(await codeOf(run('publish'))).toBe('event.notFound')
  })

  it('refuses a decision on an archived event, which is a record', async () => {
    events.seed(anEvent({ id: 'event-1', status: 'archived' }))

    expect(await codeOf(run('publish'))).toBe('event.notModeratable')
    expect((await guestbook.findById(EVENT, M1))?.status).toBe('pending')
  })

  it('refuses a decision for a suspended client', async () => {
    events.seed(Event.restore({ ...anEvent({ id: 'event-1' }).toProps(), clientSuspendedAt: AT }))

    expect(await codeOf(run('publish'))).toBe('client.suspended')
  })
})
