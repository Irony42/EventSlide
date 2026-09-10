import { beforeEach, describe, expect, it } from 'vitest'
import type { EventId } from '../../../domain/shared/ids'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { MediaMetadata, MediaStore } from '../../ports/mediaStore'
import { AT, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makePurgeEvent, type PurgeEvent } from './purgeEvent'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

const notPartOfAPurge = (method: string): never => {
  throw new Error(`MediaStore.${method} is not part of purging an event`)
}

interface RecordingMediaStoreOptions {
  /** Events whose purge blows up: a read-only media root, a disk that went away. */
  readonly failing?: readonly EventId[]
  /** Runs before the bytes go, so a test can observe the row that must still be there. */
  readonly observe?: () => Promise<void>
}

/**
 * A media store that records the event purges asked of it.
 *
 * Only `deleteEvent` belongs to a purge; the rest of the port throws, so a use case
 * that quietly started reading bytes here would fail loudly instead of passing against
 * a permissive stub.
 */
class RecordingMediaStore implements MediaStore {
  readonly purged: EventId[] = []

  constructor(private readonly options: RecordingMediaStoreOptions = {}) {}

  async deleteEvent(eventId: EventId): Promise<void> {
    await this.options.observe?.()
    if (this.options.failing?.includes(eventId) === true) {
      throw new Error('media root is read-only')
    }
    this.purged.push(eventId)
  }

  put = async (): Promise<void> => notPartOfAPurge('put')
  exists = async (): Promise<boolean> => notPartOfAPurge('exists')
  stat = async (): Promise<MediaMetadata | null> => notPartOfAPurge('stat')
  openRead = async (): Promise<AsyncIterable<Uint8Array> | null> => notPartOfAPurge('openRead')
  read = async (): Promise<Uint8Array | null> => notPartOfAPurge('read')
  delete = async (): Promise<void> => notPartOfAPurge('delete')
  usedBytes = async (): Promise<number> => notPartOfAPurge('usedBytes')
}

describe('purgeEvent', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let media: RecordingMediaStore
  let purgeEvent: PurgeEvent

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    media = new RecordingMediaStore()
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

    expect(media.purged).toEqual([WEDDING])
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
    const rowPresentWhenMediaWent: boolean[] = []
    const observing = new RecordingMediaStore({
      observe: async () => {
        rowPresentWhenMediaWent.push((await events.findById(WEDDING)) !== null)
      },
    })

    await makePurgeEvent({ events, memberships, media: observing })({
      eventId: WEDDING,
      actorId: OWNER,
    })

    expect(rowPresentWhenMediaWent).toEqual([true])
  })

  // ---------------------------------------------------------- a disk that fails --

  it('reports a media failure instead of throwing, so the job above can carry on', async () => {
    const failing = new RecordingMediaStore({ failing: [WEDDING] })

    const result = await makePurgeEvent({ events, memberships, media: failing })({
      eventId: WEDDING,
      actorId: OWNER,
    })

    expect(!result.ok && result.error.code).toBe('event.mediaPurgeFailed')
  })

  it('leaves the row intact when the media could not be deleted, so the purge can be rerun', async () => {
    const failing = new RecordingMediaStore({ failing: [WEDDING] })

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

    expect(media.purged).toEqual([])
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

    expect(media.purged).toEqual([])
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

    expect(media.purged).toEqual([])
  })
})
