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
  let calls: CallLog
  let purgeEvent: PurgeEvent

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    media = new InMemoryMediaStore()
    await media.put(WEDDING, HASH, 'original', Uint8Array.of(1))
    await media.put(GALA, HASH, 'original', Uint8Array.of(1))
    calls = new CallLog()
    purgeEvent = makePurgeEvent({ events, memberships, media: calls.watch('media', media) })

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

  /** What is left on the disk for the wedding and for the gala, in bytes. */
  const bytesLeft = async (): Promise<number[]> => [
    await media.usedBytes(WEDDING),
    await media.usedBytes(GALA),
  ]

  /** Every call the use case made on the media store, which for a purge is one or none. */
  const mediaCalls = (): readonly string[] => calls.names

  it('deletes the media of the event it was asked for, and asks the store for nothing else', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: OWNER })

    expect(await bytesLeft()).toEqual([0, 1])
    expect(mediaCalls()).toEqual(['media.deleteEvent'])
  })

  it('deletes the row, whose cascade takes the photos, guests and reactions with it', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: OWNER })

    expect(await events.findById(WEDDING)).toBeNull()
  })

  /**
   * The ordering is the whole point since the operator's purge hold (launch review S5): the row is
   * deleted first, in a statement that refuses a held event, and the bytes only after it said yes,
   * so the bytes of a held event can never be removed. A failure afterwards leaves bytes with no
   * row, which `sweepOrphanedMedia` collects.
   */
  it('deletes the row, conditionally, before the media', async () => {
    const calls = new CallLog()

    await makePurgeEvent({
      events: calls.watch('events', events),
      memberships,
      media: calls.watch('media', media),
    })({ eventId: WEDDING, actorId: OWNER })

    expect(calls.sequenceOf('media.deleteEvent', 'events.deleteUnlessHeld')).toEqual([
      'events.deleteUnlessHeld',
      'media.deleteEvent',
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

  it('has already removed the row when the media could not be deleted: the bytes are left for the orphan sweep', async () => {
    const failing = new InMemoryMediaStore().failEventPurges(WEDDING)

    await makePurgeEvent({ events, memberships, media: failing })({
      eventId: WEDDING,
      actorId: OWNER,
    })

    expect(await events.findById(WEDDING)).toBeNull()
  })

  it('keeps the bytes of an event whose hold was set after the request was read (launch review S5)', async () => {
    const racing = {
      ...events,
      findById: async (id: typeof WEDDING) => {
        const read = await events.findById(id)
        await events.setPurgeHeld(id, AT)
        return read
      },
      deleteUnlessHeld: (id: typeof WEDDING) => events.deleteUnlessHeld(id),
    }

    const result = await makePurgeEvent({
      events: racing as unknown as typeof events,
      memberships,
      media,
    })({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.mediaPurgeFailed')
    expect(await events.findById(WEDDING)).not.toBeNull()
    expect(await bytesLeft()).toEqual([1, 1])
  })

  // ------------------------------------------------------------ authorization --

  /** Deletion cascades to every photo of the event and is not undoable. */
  it('refuses a moderator of the event', async () => {
    const result = await purgeEvent({ eventId: WEDDING, actorId: MODERATOR })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('deletes no media when a moderator tries', async () => {
    await purgeEvent({ eventId: WEDDING, actorId: MODERATOR })

    expect(await bytesLeft()).toEqual([1, 1])
    expect(mediaCalls()).toEqual([])
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

    expect(await bytesLeft()).toEqual([1, 1])
    expect(mediaCalls()).toEqual([])
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

    expect(await bytesLeft()).toEqual([1, 1])
    expect(mediaCalls()).toEqual([])
  })
})
