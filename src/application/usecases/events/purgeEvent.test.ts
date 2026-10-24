import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, aPhoto } from '../../testing/builders'
import { CallLog } from '../../testing/callLog'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makePurgeEvent, type PurgeEvent } from './purgeEvent'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')
const HASH = aPhoto().contentHash

describe('purgeEvent', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let media: InMemoryMediaStore
  let purgeEvent: PurgeEvent

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    media = new InMemoryMediaStore()
    await media.put(WEDDING, HASH, 'original', Uint8Array.of(1))
    await media.put(GALA, HASH, 'original', Uint8Array.of(1))
    purgeEvent = makePurgeEvent({ events, memberships, media })

    events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
  })

  it('deletes the media of the event it was asked for', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: OWNER })

    expect(await media.listEvents()).toEqual([GALA])
  })

  it('deletes the row, whose cascade takes the photos, guests and reactions with it', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: OWNER })

    expect(await events.findById(WEDDING)).toBeNull()
  })

  /**
   * The ordering is the whole point. The row is the only record that this event's bytes
   * exist, so it has to outlive them: if it went first, a failure would leave gigabytes
   * on the disk with nothing left to find them by.
   */
  it('deletes the media while the row that names it is still there', async () => {
    const calls = new CallLog()

    await makePurgeEvent({
      events: calls.watch('events', events),
      memberships,
      media: calls.watch('media', media),
    })({ eventId: WEDDING, actorId: OWNER })

    expect(calls.sequenceOf('media.deleteEvent', 'events.delete')).toEqual([
      'media.deleteEvent',
      'events.delete',
    ])
  })

  // ---------------------------------------------------------- a disk that fails --

  it('reports a media failure instead of throwing, so the job above can carry on', async () => {
    const failing = new InMemoryMediaStore().failEventPurges(WEDDING)

    const result = await makePurgeEvent({ events, memberships, media: failing })({
      eventId: WEDDING,
      actorId: OWNER,
    })

    expect(!result.ok && result.error.code).toBe('event.mediaPurgeFailed')
  })

  it('leaves the row intact when the media could not be deleted, so the purge can be rerun', async () => {
    const failing = new InMemoryMediaStore().failEventPurges(WEDDING)

    await makePurgeEvent({ events, memberships, media: failing })({
      eventId: WEDDING,
      actorId: OWNER,
    })

    expect(await events.findById(WEDDING)).not.toBeNull()
  })

  // ------------------------------------------------------------ authorization --

  /** Deletion cascades to every photo of the event and is not undoable. */
  it('refuses a moderator of the event', async () => {
    const result = await purgeEvent({ eventId: WEDDING, actorId: MODERATOR })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('deletes no media when a moderator tries', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: MODERATOR })

    expect(await media.listEvents()).toEqual([WEDDING, GALA])
  })

  it('keeps the row when a moderator tries', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: MODERATOR })

    expect(await events.findById(WEDDING)).not.toBeNull()
  })

  /**
   * `notFound`, not `forbidden`: confirming that an event exists to someone with no
   * part in it turns this into an enumeration oracle for other people's events.
   */
  it('answers notFound to a caller with no membership in the event', async () => {
    const result = await purgeEvent({ eventId: WEDDING, actorId: asUserId('user-nobody') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot purge another event with the role the caller holds on their own', async () => {
    const result = await purgeEvent({ eventId: GALA, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('touches neither the row nor the media of another event', async () => {
    await purgeEvent({ eventId: GALA, actorId: OWNER })

    expect(await media.listEvents()).toEqual([WEDDING, GALA])
  })

  it('leaves the other event standing', async () => {
    await purgeEvent({ eventId: GALA, actorId: OWNER })

    expect(await events.findById(GALA)).not.toBeNull()
  })

  it('answers notFound for an event id that does not exist', async () => {
    const result = await purgeEvent({ eventId: asEventId('evt-nothing'), actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('asks the media store for nothing when the event does not exist', async () => {
    await purgeEvent({ eventId: asEventId('evt-nothing'), actorId: OWNER })

    expect(await media.listEvents()).toEqual([WEDDING, GALA])
  })
})
