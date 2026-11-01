import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asGuestId, asPhotoId, asUserId, type PhotoId } from '../../../domain/shared/ids'
import { AT, aGuest, aPhoto, anEvent, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { FakeReelRenderer } from '../../testing/fakeReelRenderer'
import { FakeReelRepository } from '../../testing/fakeReelRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { CountingClientRepository } from '../../testing/countingClientRepository'
import { makeEraseGuestContribution } from '../guests/eraseGuestContribution'
import { makeModeratePhoto } from '../moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../moderation/moderatePhotosBulk'
import { makeDeletePhoto } from '../photos/deletePhoto'
import { makeSetPhotoTakedown } from '../site/setPhotoTakedown'
import { makeInvalidateReel } from './invalidateReel'
import { makeRequestReel } from './requestReel'
import { makeTranscodeNextReel } from './transcodeNextReel'

/**
 * Every path that takes a photograph out of the evening takes it out of the highlight reel too
 * (spec 08, privacy). Five paths, five tests, each with the same three assertions: the row is
 * `stale`, the file is gone from the disk, and the quota stopped counting it. A photograph that is
 * in the montage and then removed must never be shown again, by whichever door it left.
 *
 * `reelInvalidation.guard.test.ts` (in `src/main`) is what makes a sixth door fail the build.
 */

const EVENT = asEventId('event-1')
const HOST = asUserId('user-host')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')
const hostActor = { kind: 'host', userId: HOST } as const

describe('the highlight reel and the five ways out of the evening', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let reels: FakeReelRepository
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let clock: FakeClock
  let guests: FakeGuestRepository
  let invalidateReel: ReturnType<typeof makeInvalidateReel>
  /** The montage file as it was rendered, to prove it is gone whichever door was used. */
  let montageHash: ContentHash

  beforeEach(async () => {
    const clients = new CountingClientRepository()
    events = new FakeEventRepository({ clients }).seed(anEvent({ id: 'event-1' }))
    photos = new FakePhotoRepository().chargeClientBytesFrom(clients)
    reels = new FakeReelRepository(photos)
    media = new InMemoryMediaStore()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    guests = new FakeGuestRepository()
    const logger = new CapturingLogger()
    invalidateReel = makeInvalidateReel({ reels, media, clock, logger })

    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    guests.seed(aGuest({ id: 'guest-sam', eventId: 'event-1', displayName: 'Sam' }))
    // Three photographs in the montage (two of Léa's, one of Sam's), one outside it.
    await seed('lea-1', LEA, 0, true)
    await seed('lea-2', LEA, 1_000, true)
    await seed('sam-1', SAM, 2_000, true)
    await seed('sam-2', SAM, 3_000, false)

    const request = makeRequestReel({
      events,
      clients,
      photos,
      reels,
      renderer: new FakeReelRenderer(),
      media,
      bus,
      clock,
      logger,
      policy: {
        enabled: true,
        maxPhotos: 10,
        secondsPerPhoto: 4,
        maxOutputBytes: 1_000,
        maxQueued: 2,
      },
    })
    expect((await request({ eventId: EVENT })).ok).toBe(true)
    const rendered = await makeTranscodeNextReel({
      events,
      clients,
      photos,
      reels,
      media,
      renderer: new FakeReelRenderer(),
      hasher: new FakeContentHasher(),
      bus,
      clock,
      logger,
      policy: { secondsPerPhoto: 4, maxOutputBytes: 1_000 },
    })()
    expect(rendered.ok && rendered.value.kind).toBe('rendered')
    const output = (await reels.findByEvent(EVENT))?.output
    if (output === undefined || output === null) throw new Error('fixture')
    montageHash = output.hash
  })

  const seed = async (id: string, guest: typeof LEA, at: number, starred: boolean) => {
    const photo = aPhoto({
      id,
      eventId: 'event-1',
      status: 'published',
      createdAt: atPlus(at),
      byteSize: 100,
      author: { kind: 'guest', id: guest },
    })
    photos.seed(photo)
    await media.put(EVENT, photo.contentHash, 'display', new TextEncoder().encode(id))
    if (starred) await photos.setHighlighted(EVENT, photo.id, AT)
  }

  /** The three assertions every door must satisfy. */
  const expectRetired = async (): Promise<void> => {
    const row = await reels.findByEvent(EVENT)
    expect(row?.status).toBe('stale')
    expect(row?.output).toBeNull()
    expect(await reels.reelBytes(EVENT)).toBe(0)
    expect(await media.exists(EVENT, montageHash, 'reel')).toBe(false)
  }

  const fileExists = async (): Promise<boolean> => media.exists(EVENT, montageHash, 'reel')

  it('starts with a finished montage on the disk, counted in the quota', async () => {
    expect((await reels.findByEvent(EVENT))?.status).toBe('done')
    expect(await fileExists()).toBe(true)
    expect(await reels.reelBytes(EVENT)).toBeGreaterThan(0)
  })

  it('1. deleting a photograph', async () => {
    const remove = makeDeletePhoto({
      events,
      photos,
      clips: new FakeClipJobRepository(),
      media,
      bus,
      clock,
      invalidateReel,
    })

    const result = await remove({ eventId: EVENT, photoId: asPhotoId('lea-1'), actor: hostActor })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('2. hiding or refusing one photograph', async () => {
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'moderator', grantedAt: AT })
    const moderate = makeModeratePhoto({ events, photos, memberships, bus, clock, invalidateReel })

    const result = await moderate({
      eventId: EVENT,
      photoId: asPhotoId('sam-1'),
      decision: 'hide',
      actor: hostActor,
    })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('2b. publishing a photograph leaves the montage alone', async () => {
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'moderator', grantedAt: AT })
    const moderate = makeModeratePhoto({ events, photos, memberships, bus, clock, invalidateReel })

    await moderate({
      eventId: EVENT,
      photoId: asPhotoId('sam-2'),
      decision: 'publish',
      actor: hostActor,
    })

    expect((await reels.findByEvent(EVENT))?.status).toBe('done')
  })

  it('3. hiding a batch, with one call for the batch', async () => {
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'moderator', grantedAt: AT })
    const bulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock, invalidateReel })

    const result = await bulk({
      eventId: EVENT,
      photoIds: ['lea-2', 'sam-2'].map(asPhotoId),
      decision: 'reject',
      actor: hostActor,
    })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('3b. a batch with no photograph of the montage leaves it alone', async () => {
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'moderator', grantedAt: AT })
    const bulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock, invalidateReel })

    await bulk({
      eventId: EVENT,
      photoIds: [asPhotoId('sam-2')],
      decision: 'hide',
      actor: hostActor,
    })

    expect((await reels.findByEvent(EVENT))?.status).toBe('done')
  })

  it('4. a guest erasing their contribution, before their row goes', async () => {
    const erase = makeEraseGuestContribution({
      events,
      guests,
      photos,
      reactions: new FakeReactionRepository(),
      clips: new FakeClipJobRepository(),
      media,
      bus,
      clock,
      invalidateReel,
    })

    const result = await erase({ eventId: EVENT, guestId: LEA })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('4b. another guest erasing theirs does not touch a montage that does not hold them', async () => {
    // Sam-2 is outside the montage, and Sam-1 is in it: erase a guest with nothing in it.
    guests.seed(aGuest({ id: 'guest-new', eventId: 'event-1' }))
    const erase = makeEraseGuestContribution({
      events,
      guests,
      photos,
      reactions: new FakeReactionRepository(),
      clips: new FakeClipJobRepository(),
      media,
      bus,
      clock,
      invalidateReel,
    })

    await erase({ eventId: EVENT, guestId: asGuestId('guest-new') })

    expect((await reels.findByEvent(EVENT))?.status).toBe('done')
  })

  it('5. the operator taking a photograph down: no audit line, no new signal', async () => {
    const audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    const takeDown = makeSetPhotoTakedown({ photos, audit, bus, clock, invalidateReel })
    bus.clear()

    const result = await takeDown({
      photoId: asPhotoId('lea-2'),
      down: true,
      reason: 'Signalement reçu, retrait conservatoire',
      actor: { kind: 'operator', userId: asUserId('user-operator') },
    })

    expect(result.ok).toBe(true)
    await expectRetired()
    // The neutral signal the takedown already published, and nothing about a reel.
    expect(bus.published.map((signal) => signal.type)).toEqual(['photo.deleted'])
    expect(audit.all().map((row) => row.action)).toEqual(['photo.takenDown'])
  })

  it('5b. putting the photograph back does not bring the montage back to life', async () => {
    const audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    const takeDown = makeSetPhotoTakedown({ photos, audit, bus, clock, invalidateReel })
    const act = (down: boolean) =>
      takeDown({
        photoId: asPhotoId('lea-2'),
        down,
        reason: 'Signalement reçu, retrait conservatoire',
        actor: { kind: 'operator', userId: asUserId('user-operator') },
      })

    await act(true)
    await act(false)

    expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
    expect(await fileExists()).toBe(false)
  })

  it('a photograph that is not one of the montage never spoils it, whichever door it takes', async () => {
    const outsiders: PhotoId[] = [asPhotoId('sam-2')]
    await invalidateReel(EVENT, outsiders)

    expect((await reels.findByEvent(EVENT))?.status).toBe('done')
  })
})
