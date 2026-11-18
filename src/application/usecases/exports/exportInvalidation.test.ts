import { beforeEach, describe, expect, it } from 'vitest'
import {
  asEventId,
  asGuestbookEntryId,
  asGuestId,
  asPhotoId,
  asUserId,
} from '../../../domain/shared/ids'
import {
  AT,
  aGuest,
  aGuestbookEntry,
  aPhoto,
  aVoiceEntry,
  anEvent,
  atPlus,
} from '../../testing/builders'
import { EXPORT_EVENT, ExportScene } from '../../testing/exportScene'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { makeChangeEventStatus } from '../events/changeEventStatus'
import { makeApplyEventSchedules } from '../events/applyEventSchedules'
import { makeDeleteGuestbookEntry } from '../guestbook/deleteGuestbookEntry'
import { makeModerateGuestbookEntry } from '../guestbook/moderateGuestbookEntry'
import { makeEraseGuestContribution } from '../guests/eraseGuestContribution'
import { makeModeratePhoto } from '../moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../moderation/moderatePhotosBulk'
import { makeDeletePhoto } from '../photos/deletePhoto'
import { makeSetEventTakedown } from '../site/setEventTakedown'
import { makeSetGuestbookTakedown } from '../site/setGuestbookTakedown'
import { makeSetPhotoTakedown } from '../site/setPhotoTakedown'
import { makeInvalidateAlbumExport, type InvalidateExport } from './invalidateAlbumExport'

/**
 * Every path that takes content out of the evening takes it out of the archive the box keeps
 * (spec 22, section 7): the row goes `stale`, the file is deleted, and **it happens before the
 * bytes go**, whichever door the content left by. A guest who erased themselves must not survive in
 * a copy the box holds. `exportInvalidation.guard.test.ts` (in `src/main`) makes a new door fail
 * the build.
 */

const HOST = asUserId('user-host')
const LEA = asGuestId('guest-lea')
const hostActor = { kind: 'host', userId: HOST } as const
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const REASON = 'Signalement reçu, retrait conservatoire'

describe('the archive and the ways out of the evening', () => {
  let scene: ExportScene
  let memberships: FakeMembershipRepository
  let invalidateExport: InvalidateExport
  /** What the archive said at the instant each file of the album was deleted. */
  let statusWhenBytesWentAt: string[]

  beforeEach(async () => {
    scene = new ExportScene()
    memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EXPORT_EVENT, userId: HOST, role: 'owner', grantedAt: AT })
    invalidateExport = makeInvalidateAlbumExport({
      exports: scene.exports,
      exportFiles: scene.exportFiles,
      bus: scene.bus,
      clock: scene.clock,
      logger: scene.logger,
    })
    scene.guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    scene.guests.seed(aGuest({ id: 'guest-new', eventId: 'event-1', displayName: 'Nina' }))
    const byLea = { kind: 'guest', id: 'guest-lea' } as const
    await scene.photo({ id: 'lea-1', author: byLea })
    await scene.photo({ id: 'lea-2', author: byLea, status: 'hidden' })
    await scene.photo({ id: 'wait', status: 'pending' })
    await scene.sealArchive()

    // The order, which an end state cannot see: the archive is already stale when the first file is deleted.
    statusWhenBytesWentAt = []
    const deleteBytes = scene.media.delete.bind(scene.media)
    scene.media.delete = async (...args) => {
      statusWhenBytesWentAt.push((await scene.exports.find(EXPORT_EVENT))?.status ?? 'none')
      return deleteBytes(...args)
    }
  })

  const expectRetired = async (reason: string): Promise<void> => {
    expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
      status: 'stale',
      staleReason: reason,
    })
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
  }

  const expectUntouched = async (): Promise<void> => {
    expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({ status: 'sealed' })
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(true)
  }

  const expectRetiredBeforeTheBytes = (): void => {
    expect(statusWhenBytesWentAt.length).toBeGreaterThan(0)
    expect(statusWhenBytesWentAt.every((status) => status === 'stale')).toBe(true)
  }

  // ------------------------------------------------------------------- photographs --

  const deleter = () =>
    makeDeletePhoto({
      events: scene.events,
      photos: scene.photos,
      clips: new FakeClipJobRepository(),
      media: scene.media,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

  it('1. deleting a published photograph retires the archive, before its bytes go', async () => {
    const result = await deleter()({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('lea-1'),
      actor: hostActor,
    })

    expect(result.ok).toBe(true)
    await expectRetired('photoRemoved')
    expectRetiredBeforeTheBytes()
  })

  it('1b. deleting a hidden photograph does too: the archive holds hidden photographs', async () => {
    await deleter()({ eventId: EXPORT_EVENT, photoId: asPhotoId('lea-2'), actor: hostActor })

    await expectRetired('photoRemoved')
    expectRetiredBeforeTheBytes()
  })

  it('1c. deleting a photograph that was never in the archive leaves it alone', async () => {
    await deleter()({ eventId: EXPORT_EVENT, photoId: asPhotoId('wait'), actor: hostActor })

    await expectUntouched()
  })

  it('2. rejecting a published photograph retires the archive', async () => {
    const moderate = makeModeratePhoto({
      events: scene.events,
      photos: scene.photos,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

    await moderate({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('lea-1'),
      decision: 'reject',
      actor: hostActor,
    })

    await expectRetired('photoRemoved')
  })

  it('2b. hiding a published photograph leaves the archive alone: a hidden photograph is still in it', async () => {
    const moderate = makeModeratePhoto({
      events: scene.events,
      photos: scene.photos,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

    await moderate({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('lea-1'),
      decision: 'hide',
      actor: hostActor,
    })

    await expectUntouched()
  })

  it('2c. refusing a pending photograph, or publishing one, leaves the archive alone', async () => {
    const moderate = makeModeratePhoto({
      events: scene.events,
      photos: scene.photos,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

    await moderate({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('wait'),
      decision: 'reject',
      actor: hostActor,
    })
    scene.photos.seed(aPhoto({ id: 'wait-2', eventId: 'event-1', status: 'pending' }))
    await moderate({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('wait-2'),
      decision: 'publish',
      actor: hostActor,
    })

    await expectUntouched()
  })

  const bulker = () =>
    makeModeratePhotosBulk({
      events: scene.events,
      photos: scene.photos,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

  it('3. rejecting a batch that holds a published photograph retires the archive', async () => {
    await bulker()({
      eventId: EXPORT_EVENT,
      photoIds: ['lea-1', 'wait'].map(asPhotoId),
      decision: 'reject',
      actor: hostActor,
    })

    await expectRetired('photoRemoved')
  })

  it('3b. hiding a batch, or refusing one of pending photographs, leaves the archive alone', async () => {
    await bulker()({
      eventId: EXPORT_EVENT,
      photoIds: ['lea-1'].map(asPhotoId),
      decision: 'hide',
      actor: hostActor,
    })
    await bulker()({
      eventId: EXPORT_EVENT,
      photoIds: ['wait'].map(asPhotoId),
      decision: 'reject',
      actor: hostActor,
    })

    await expectUntouched()
  })

  // ------------------------------------------------------------- the guest's erasure --

  const eraser = (guestbook = scene.guestbook) =>
    makeEraseGuestContribution({
      events: scene.events,
      guests: scene.guests,
      photos: scene.photos,
      reactions: new FakeReactionRepository(),
      clips: new FakeClipJobRepository(),
      guestbook,
      voices: new FakeGuestbookVoiceRepository(guestbook),
      media: scene.media,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

  it('4. a guest erasing their contribution retires the archive, before any of their bytes go', async () => {
    const result = await eraser()({ eventId: EXPORT_EVENT, guestId: LEA })

    expect(result.ok).toBe(true)
    await expectRetired('guestErased')
    expectRetiredBeforeTheBytes()
  })

  it('4b. a guest whose clip is in the archive reaches it too', async () => {
    scene.guests.seed(aGuest({ id: 'guest-vid', eventId: 'event-1', displayName: 'Vic' }))
    await scene.clip({ id: 'clip-1', author: { kind: 'guest', id: 'guest-vid' } })

    await eraser()({ eventId: EXPORT_EVENT, guestId: asGuestId('guest-vid') })

    await expectRetired('guestErased')
    expectRetiredBeforeTheBytes()
  })

  it('4c. a guest who wrote messages only retires the archive for what guestbook.txt holds', async () => {
    scene.guestbook.seed(
      aGuestbookEntry({ id: 'm1', eventId: 'event-1', guestId: 'guest-new', moderation: 'auto' }),
    )

    await eraser()({ eventId: EXPORT_EVENT, guestId: asGuestId('guest-new') })

    await expectRetired('guestbookChanged')
  })

  it('4d. a guest with nothing in the archive leaves it alone', async () => {
    await eraser()({ eventId: EXPORT_EVENT, guestId: asGuestId('guest-new') })

    await expectUntouched()
  })

  it('4e. an erasure refused under the operator’s hold changes nothing: the archive stays, so does the file', async () => {
    await scene.events.setPurgeHeld(EXPORT_EVENT, AT)

    const result = await eraser()({ eventId: EXPORT_EVENT, guestId: LEA })

    expect(!result.ok && result.error.code).toBe('photo.deleteFailed')
    await expectUntouched()
    expect(await scene.photos.findById(EXPORT_EVENT, asPhotoId('lea-1'))).not.toBeNull()
  })

  it('4f. a deletion refused under the hold changes nothing either', async () => {
    await scene.events.setPurgeHeld(EXPORT_EVENT, AT)

    const result = await deleter()({
      eventId: EXPORT_EVENT,
      photoId: asPhotoId('lea-1'),
      actor: hostActor,
    })

    expect(!result.ok && result.error.code).toBe('photo.deleteFailed')
    await expectUntouched()
  })

  // ---------------------------------------------------------------- the operator --

  const takedown = () => {
    const audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    const takeDown = makeSetPhotoTakedown({
      photos: scene.photos,
      audit,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })
    const act = (down: boolean) =>
      takeDown({ photoId: asPhotoId('lea-2'), down, reason: REASON, actor: OPERATOR })
    return { act, audit }
  }

  it('5. the operator taking a photograph down retires the archive, with no audit line about it', async () => {
    const { act, audit } = takedown()

    expect((await act(true)).ok).toBe(true)

    await expectRetired('takenDown')
    expect(audit.all().map((row) => row.action)).toEqual(['photo.takenDown'])
  })

  it('5b. restoring the photograph does not bring the archive back', async () => {
    const { act } = takedown()

    await act(true)
    await act(false)

    await expectRetired('takenDown')
  })

  it('6. the operator taking the whole event down retires the archive, restoring it does not bring it back', async () => {
    const audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    const takeDown = makeSetEventTakedown({
      events: scene.events,
      audit,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

    await takeDown({ eventId: EXPORT_EVENT, down: true, reason: REASON, actor: OPERATOR })
    await expectRetired('takenDown')
    await takeDown({ eventId: EXPORT_EVENT, down: false, reason: REASON, actor: OPERATOR })

    await expectRetired('takenDown')
  })

  it('7. the operator taking a guestbook message down retires the archive that holds the book', async () => {
    scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
    const audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    const takeDown = makeSetGuestbookTakedown({
      guestbook: scene.guestbook,
      audit,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

    await takeDown({
      entryId: asGuestbookEntryId('m1'),
      down: true,
      reason: REASON,
      actor: OPERATOR,
    })

    await expectRetired('takenDown')
  })

  // ------------------------------------------------------------------ the guestbook --

  const guestbookModerator = () =>
    makeModerateGuestbookEntry({
      events: scene.events,
      guestbook: scene.guestbook,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateExport,
    })

  it('8. the host rejecting a published message retires the archive', async () => {
    scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))

    await guestbookModerator()({
      eventId: EXPORT_EVENT,
      entryId: asGuestbookEntryId('m1'),
      decision: 'reject',
      actor: hostActor,
    })

    await expectRetired('guestbookChanged')
  })

  it('8b. hiding a message, or refusing one that was waiting, leaves the archive alone', async () => {
    scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
    scene.guestbook.seed(aGuestbookEntry({ id: 'm2', eventId: 'event-1', moderation: 'manual' }))

    await guestbookModerator()({
      eventId: EXPORT_EVENT,
      entryId: asGuestbookEntryId('m1'),
      decision: 'hide',
      actor: hostActor,
    })
    await guestbookModerator()({
      eventId: EXPORT_EVENT,
      entryId: asGuestbookEntryId('m2'),
      decision: 'reject',
      actor: hostActor,
    })

    await expectUntouched()
  })

  // ------------------------------------------------------ the voice messages (spec 25) --

  describe('9. the voice messages', () => {
    /** A recording the box finished, published on arrival, whose output is on the disk. */
    const seedVoice = async (
      id: string,
      guest: string,
      input: { readonly moderation?: 'manual' | 'auto'; readonly state?: 'ready' | 'failed' } = {},
    ) => {
      const entry = aVoiceEntry({
        id,
        guestId: guest,
        eventId: 'event-1',
        state: input.state ?? 'ready',
        moderation: input.moderation ?? 'auto',
        // Just now: inside the grace window a guest has to take a recording back.
        createdAt: scene.clock.now(),
      })
      scene.guestbook.seed(entry)
      const hash = entry.voice?.audioHash
      if (hash !== null && hash !== undefined) {
        await scene.media.put(entry.eventId, hash, 'voice', new Uint8Array([4, 4]))
      }
    }

    const guestDeleter = () =>
      makeDeleteGuestbookEntry({
        events: scene.events,
        guestbook: scene.guestbook,
        voices: scene.voices,
        media: scene.media,
        bus: scene.bus,
        clock: scene.clock,
        invalidateExport,
      })

    it('9a. a guest erasing their contribution retires the archive for the recording it holds, before its bytes go', async () => {
      await seedVoice('v1', 'guest-new')

      await eraser()({ eventId: EXPORT_EVENT, guestId: asGuestId('guest-new') })

      await expectRetired('guestbookChanged')
      expectRetiredBeforeTheBytes()
    })

    it('9b. a guest whose only recording failed leaves the archive alone: it was never in it', async () => {
      await seedVoice('v1', 'guest-new', { state: 'failed' })

      await eraser()({ eventId: EXPORT_EVENT, guestId: asGuestId('guest-new') })

      await expectUntouched()
    })

    it('9c. a guest taking back a published recording retires the archive, before its bytes go', async () => {
      await seedVoice('v1', 'guest-new')

      const result = await guestDeleter()({
        eventId: EXPORT_EVENT,
        entryId: asGuestbookEntryId('v1'),
        guestId: asGuestId('guest-new'),
      })

      expect(result.ok).toBe(true)
      await expectRetired('guestbookChanged')
      expectRetiredBeforeTheBytes()
    })

    it('9d. a recording waiting for a decision, or one that failed, was not in the archive: removing it leaves it alone', async () => {
      await seedVoice('v-wait', 'guest-new', { moderation: 'manual' })
      await seedVoice('v-failed', 'guest-new', { state: 'failed' })

      for (const id of ['v-wait', 'v-failed']) {
        await guestDeleter()({
          eventId: EXPORT_EVENT,
          entryId: asGuestbookEntryId(id),
          guestId: asGuestId('guest-new'),
        })
      }

      await expectUntouched()
    })

    it('9e. a removal refused under the hold changes nothing: the archive stays', async () => {
      await seedVoice('v1', 'guest-new')
      await scene.events.setPurgeHeld(EXPORT_EVENT, AT)

      const result = await guestDeleter()({
        eventId: EXPORT_EVENT,
        entryId: asGuestbookEntryId('v1'),
        guestId: asGuestId('guest-new'),
      })

      expect(!result.ok && result.error.code).toBe('guestbook.deleteFailed')
      await expectUntouched()
    })

    it('9f. the host refusing a published recording retires the archive; hiding it is not possible', async () => {
      await seedVoice('v1', 'guest-new')

      const hidden = await guestbookModerator()({
        eventId: EXPORT_EVENT,
        entryId: asGuestbookEntryId('v1'),
        decision: 'hide',
        actor: hostActor,
      })
      await expectUntouched()
      await guestbookModerator()({
        eventId: EXPORT_EVENT,
        entryId: asGuestbookEntryId('v1'),
        decision: 'reject',
        actor: hostActor,
      })

      expect(!hidden.ok && hidden.error.code).toBe('guestbook.voiceCannotHide')
      await expectRetired('guestbookChanged')
    })

    it('9g. the operator taking a recording down retires the archive, with its bytes left where they are', async () => {
      await seedVoice('v1', 'guest-new')
      const audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
      const takeDown = makeSetGuestbookTakedown({
        guestbook: scene.guestbook,
        audit,
        bus: scene.bus,
        clock: scene.clock,
        invalidateExport,
      })

      await takeDown({
        entryId: asGuestbookEntryId('v1'),
        down: true,
        reason: REASON,
        actor: OPERATOR,
      })

      await expectRetired('takenDown')
      expect(statusWhenBytesWentAt).toEqual([])
    })
  })

  // --------------------------------------------------------------------- reopening --

  describe('10. reopening the event', () => {
    const changer = () =>
      makeChangeEventStatus({
        events: scene.events,
        clients: scene.clients,
        memberships,
        bus: scene.bus,
        clock: scene.clock,
        invalidateExport,
      })

    it('retires the archive: the album goes on growing, and the date it was bounded by is cleared', async () => {
      const result = await changer()({ eventId: EXPORT_EVENT, actorId: HOST, status: 'live' })

      expect(result.ok).toBe(true)
      await expectRetired('reopened')
    })

    it('archiving a closed event leaves the archive alone', async () => {
      await changer()({ eventId: EXPORT_EVENT, actorId: HOST, status: 'archived' })

      await expectUntouched()
    })

    it('a refused transition retires nothing', async () => {
      // An archived event cannot go back to live: the refusal changes nothing.
      await changer()({ eventId: EXPORT_EVENT, actorId: HOST, status: 'archived' })
      const refused = await changer()({ eventId: EXPORT_EVENT, actorId: HOST, status: 'live' })

      expect(refused.ok).toBe(false)
      await expectUntouched()
    })

    it('retires it too when the event’s own schedule reopens it', async () => {
      scene.events.seed(
        anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'closed',
          scheduledOpenAt: atPlus(30 * 60_000),
        }),
      )
      const sweep = makeApplyEventSchedules({
        events: scene.events,
        clients: scene.clients,
        bus: scene.bus,
        clock: scene.clock,
        invalidateExport,
      })

      const report = await sweep()

      expect(report.opened).toEqual([EXPORT_EVENT])
      await expectRetired('reopened')
    })

    it('does not retire it when the schedule only closes an event', async () => {
      scene.events.seed(
        anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'live',
          scheduledCloseAt: atPlus(30 * 60_000),
        }),
      )
      const sweep = makeApplyEventSchedules({
        events: scene.events,
        clients: scene.clients,
        bus: scene.bus,
        clock: scene.clock,
        invalidateExport,
      })

      await sweep()

      await expectUntouched()
    })
  })

  it('does not touch another event’s archive', async () => {
    const other = asEventId('event-2')
    scene.events.seed(anEvent({ id: 'event-2', slug: 'gala', joinCode: '2AB3CD' }))
    await scene.exports.request({
      ...(await scene.exports.find(EXPORT_EVENT))!,
      eventId: other,
    })
    scene.photos.seed(aPhoto({ id: 'g1', eventId: 'event-2', status: 'published' }))

    await deleter()({ eventId: EXPORT_EVENT, photoId: asPhotoId('lea-1'), actor: hostActor })

    expect((await scene.exports.find(other))?.status).toBe('sealed')
  })
})
