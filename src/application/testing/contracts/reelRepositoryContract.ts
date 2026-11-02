import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReelJob } from '../../../domain/highlights/reelJob'
import { ContentHash } from '../../../domain/photos/contentHash'
import type { Photo } from '../../../domain/photos/photo'
import {
  asClientId,
  asEventId,
  asPhotoId,
  asReelId,
  type ClientId,
  type EventId,
} from '../../../domain/shared/ids'
import type { PhotoRepository } from '../../ports/photoRepository'
import type {
  ReelAdmissionLimits,
  ReelFinishLimits,
  ReelRepository,
} from '../../ports/reelRepository'
import { AT, aClip, aPhoto, atPlus } from '../builders'

/**
 * What a subject provides: the reel repository, the photo repository whose rows it judges (and
 * whose byte sums it joins), and the two ways to arrange the world a case needs.
 *
 * The photo repository is part of the subject because the final write's eligibility check and
 * the quota sum are questions about `photos`, which each implementation answers its own way (SQL
 * in one statement, a fake handed this repository) and which must agree.
 */
export interface ReelRepositorySubject {
  readonly repo: ReelRepository
  readonly photos: PhotoRepository
  /** Make these the events of one client, by whatever route the implementation has. */
  placeEventsInClient: (clientId: ClientId, eventIds: readonly EventId[]) => Promise<void>
  readonly dispose?: () => Promise<void>
}

export const REEL_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala', 'evt-brunch'],
  userIds: ['user-host'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const hashOf = (seed: string): ContentHash => {
  const made = ContentHash.create(seed.padEnd(64, '0').slice(0, 64))
  if (!made.ok) throw new Error('bad fixture hash')
  return made.value
}

const OUTPUT = { hash: hashOf('aa'), byteSize: 5_000, durationMs: 12_000 }

const ROOMY: ReelAdmissionLimits = {
  quotaBytes: 1_000_000,
  clientBytes: null,
  reservedBytes: 10_000,
  maxQueued: 2,
}
const FINISH_ROOMY: ReelFinishLimits = { quotaBytes: 1_000_000, clientBytes: null }

const PHOTO_IDS = ['p-a', 'p-b', 'p-c'].map(asPhotoId)

const reelOf = (eventId: EventId, id = 'reel-1', photoIds = PHOTO_IDS, now = AT): ReelJob =>
  ReelJob.request({ id: asReelId(id), eventId, photoIds }, now)

export const reelRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ReelRepositorySubject>,
): void => {
  describe(`ReelRepository contract: ${name}`, () => {
    let repo: ReelRepository
    let photos: PhotoRepository
    let placeEventsInClient: ReelRepositorySubject['placeEventsInClient']
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      photos = subject.photos
      placeEventsInClient = subject.placeEventsInClient
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    const seedPhotos = async (eventId: EventId = WEDDING): Promise<readonly Photo[]> => {
      const made = PHOTO_IDS.map((id, index) =>
        aPhoto({
          id,
          eventId,
          status: 'published',
          createdAt: atPlus(index * 1_000),
          byteSize: 1_000,
        }),
      )
      for (const photo of made) await photos.save(photo)
      return made
    }

    /** A claimed, running row ready to finish. */
    const running = async (eventId: EventId = WEDDING): Promise<ReelJob> => {
      const admission = await repo.request(reelOf(eventId), ROOMY)
      expect(admission.refusal).toBeNull()
      const claimed = await repo.claimNext(AT)
      if (claimed === null) throw new Error('fixture: nothing to claim')
      return claimed
    }

    // ----------------------------------------------------------------- request --

    it('writes a request and reads it back by event, and only by its event', async () => {
      const admission = await repo.request(reelOf(WEDDING), ROOMY)

      expect(admission).toEqual({ refusal: null, replacedOutput: null })
      const found = await repo.findByEvent(WEDDING)
      expect(found?.photoIds).toEqual(PHOTO_IDS)
      expect(found?.status).toBe('queued')
      expect(await repo.findByEvent(GALA)).toBeNull()
    })

    it('refuses a second request while the first is queued or running', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)

      expect((await repo.request(reelOf(WEDDING, 'reel-2'), ROOMY)).refusal).toEqual({
        reason: 'alreadyRunning',
      })

      await repo.claimNext(AT)
      expect((await repo.request(reelOf(WEDDING, 'reel-2'), ROOMY)).refusal).toEqual({
        reason: 'alreadyRunning',
      })
    })

    it('refuses when the box already queues as many montages as it accepts', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)
      await repo.request(reelOf(GALA, 'reel-2'), ROOMY)

      const third = await repo.request(reelOf(asEventId('evt-brunch'), 'reel-3'), ROOMY)

      expect(third.refusal).toEqual({ reason: 'queueFull', depth: 2, maxDepth: 2 })
      expect(await repo.findByEvent(asEventId('evt-brunch'))).toBeNull()
      expect(await repo.countActive()).toBe(2)
    })

    it('refuses with the room that was left when the event cannot hold another montage', async () => {
      await seedPhotos()

      const admission = await repo.request(reelOf(WEDDING), {
        ...ROOMY,
        quotaBytes: 3_000 + 5_000,
        reservedBytes: 6_000,
      })

      expect(admission.refusal).toEqual({ reason: 'quotaExceeded', remaining: 5_000 })
      expect(await repo.findByEvent(WEDDING)).toBeNull()
    })

    it('refuses when the client cannot hold another montage across its events', async () => {
      await seedPhotos(WEDDING)
      await placeEventsInClient(asClientId('client-1'), [WEDDING, GALA])

      const admission = await repo.request(reelOf(WEDDING), {
        ...ROOMY,
        clientBytes: { clientId: asClientId('client-1'), maxBytes: 4_000 },
        reservedBytes: 2_000,
      })

      expect(admission.refusal).toEqual({ reason: 'clientStorageFull', remaining: 1_000 })
    })

    // ------------------------------------------------------------------ finish --

    it('finishes a running montage whose photographs are all still eligible', async () => {
      await seedPhotos()
      const job = await running()

      expect(await repo.finish(job, OUTPUT, FINISH_ROOMY, atPlus(5_000))).toEqual({ kind: 'done' })

      const done = await repo.findByEvent(WEDDING)
      expect([done?.status, done?.output?.byteSize]).toEqual(['done', 5_000])
      expect(await repo.reelBytes(WEDDING)).toBe(5_000)
      expect((await repo.listReferencedDigests(WEDDING)).has(OUTPUT.hash.value)).toBe(true)
    })

    it.each(['hidden', 'rejected'] as const)(
      'makes the row stale, never done, when a photograph was %s while it rendered',
      async (status) => {
        const [first] = await seedPhotos()
        const job = await running()
        if (first === undefined) throw new Error('fixture')
        await photos.updateStatuses(WEDDING, [first.id], status, { kind: 'automatic', at: AT })

        expect(await repo.finish(job, OUTPUT, FINISH_ROOMY, atPlus(5_000))).toEqual({
          kind: 'stale',
        })
        expect((await repo.findByEvent(WEDDING))?.status).toBe('stale')
        expect(await repo.reelBytes(WEDDING)).toBe(0)
      },
    )

    it('makes the row stale when a photograph was taken down or deleted while it rendered', async () => {
      await seedPhotos()
      const job = await running()
      await photos.setTakenDown(WEDDING, asPhotoId('p-b'), atPlus(1))

      expect((await repo.finish(job, OUTPUT, FINISH_ROOMY, atPlus(5_000))).kind).toBe('stale')

      const spoiled = await repo.findByEvent(WEDDING)
      const fresh = spoiled?.rerequest(PHOTO_IDS, atPlus(2))
      if (fresh === undefined || !fresh.ok) throw new Error('fixture')
      await repo.request(fresh.value, ROOMY)
      await photos.setTakenDown(WEDDING, asPhotoId('p-b'), null)
      const again = await repo.claimNext(atPlus(10_000))
      if (again === null) throw new Error('fixture')
      await photos.delete(WEDDING, asPhotoId('p-c'))

      expect((await repo.finish(again, OUTPUT, FINISH_ROOMY, atPlus(11_000))).kind).toBe('stale')
    })

    it('makes the row stale when a photograph became a clip row, which the montage cannot use', async () => {
      await seedPhotos()
      await photos.delete(WEDDING, asPhotoId('p-a'))
      await photos.save(
        aClip({ id: 'p-a', eventId: WEDDING, status: 'published', createdAt: AT, byteSize: 1_000 }),
      )
      const job = await running()

      expect((await repo.finish(job, OUTPUT, FINISH_ROOMY, atPlus(5_000))).kind).toBe('stale')
    })

    it('refuses a file the event can no longer hold, with the room that was left', async () => {
      await seedPhotos()
      const job = await running()

      const verdict = await repo.finish(
        job,
        OUTPUT,
        { quotaBytes: 3_000 + 4_000, clientBytes: null },
        atPlus(5_000),
      )

      expect(verdict).toEqual({
        kind: 'refused',
        refusal: { reason: 'quotaExceeded', remaining: 4_000 },
      })
      expect((await repo.findByEvent(WEDDING))?.status).toBe('running')
    })

    it('refuses a file the client can no longer hold', async () => {
      await seedPhotos()
      await placeEventsInClient(asClientId('client-1'), [WEDDING])
      const job = await running()

      const verdict = await repo.finish(
        job,
        OUTPUT,
        {
          quotaBytes: 1_000_000,
          clientBytes: { clientId: asClientId('client-1'), maxBytes: 3_000 + 4_000 },
        },
        atPlus(5_000),
      )

      expect(verdict).toEqual({
        kind: 'refused',
        refusal: { reason: 'clientStorageFull', remaining: 4_000 },
      })
    })

    it('does not finish a row that is not running, or that is gone', async () => {
      await seedPhotos()
      const job = await running()
      await repo.save(
        (() => {
          const failed = job.fail('reel.notEnoughPhotos', atPlus(1))
          if (!failed.ok) throw new Error('fixture')
          return failed.value
        })(),
      )

      expect((await repo.finish(job, OUTPUT, FINISH_ROOMY, atPlus(5_000))).kind).toBe('stale')
      expect((await repo.finish(reelOf(GALA, 'other'), OUTPUT, FINISH_ROOMY, AT)).kind).toBe('gone')
    })

    // ------------------------------------------------------------------- claim --

    it('claims the oldest due row once, counting the attempt, and nothing before it is due', async () => {
      await repo.request(reelOf(WEDDING, 'reel-1', PHOTO_IDS, atPlus(1_000)), ROOMY)

      expect(await repo.claimNext(AT)).toBeNull()

      const claimed = await repo.claimNext(atPlus(1_000))
      expect([claimed?.status, claimed?.attempts]).toEqual(['running', 1])
      expect(await repo.claimNext(atPlus(2_000))).toBeNull()
    })

    it('puts a running row back to the queue after a crash, and counts it', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)
      await repo.claimNext(AT)

      expect(await repo.recoverAbandoned(atPlus(5_000))).toBe(1)

      expect((await repo.findByEvent(WEDDING))?.status).toBe('queued')
      expect(await repo.recoverAbandoned(atPlus(6_000))).toBe(0)
    })

    it('saves what the worker holds, and says when the row is gone', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)
      const claimed = await repo.claimNext(AT)
      if (claimed === null) throw new Error('fixture')
      const again = claimed.fail('reel.renderFailed', atPlus(1))
      if (!again.ok) throw new Error('fixture')

      expect(await repo.save(again.value)).toBe(true)
      expect((await repo.findByEvent(WEDDING))?.failureCode).toBe('reel.renderFailed')
      expect(await repo.save(reelOf(GALA, 'nobody'))).toBe(false)
    })

    it('does not let a late failure bring a stale montage back to the queue', async () => {
      await seedPhotos()
      const job = await running()
      await repo.invalidate(WEDDING, [asPhotoId('p-a')], atPlus(1))
      const failed = job.fail('reel.renderFailed', atPlus(2))
      if (!failed.ok) throw new Error('fixture')

      expect(await repo.save(failed.value)).toBe(false)

      expect((await repo.findByEvent(WEDDING))?.status).toBe('stale')
    })

    // -------------------------------------------------------------- invalidate --

    it('makes a done montage stale when one of its photographs is named, and names the file to delete', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))

      const verdict = await repo.invalidate(WEDDING, [asPhotoId('p-c')], atPlus(6_000))

      expect(verdict.staled).toBe(true)
      expect(verdict.output?.equals(OUTPUT.hash)).toBe(true)
      const row = await repo.findByEvent(WEDDING)
      expect([row?.status, row?.output?.hash.value]).toEqual(['stale', OUTPUT.hash.value])
      // Still counted until the file is gone.
      expect(await repo.reelBytes(WEDDING)).toBe(5_000)

      await repo.clearOutput(WEDDING, OUTPUT.hash)
      expect(await repo.reelBytes(WEDDING)).toBe(0)
      expect((await repo.listReferencedDigests(WEDDING)).size).toBe(0)
    })

    it('leaves a montage alone when the photograph is not one of its own', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))

      expect(await repo.invalidate(WEDDING, [asPhotoId('other')], atPlus(6_000))).toEqual({
        staled: false,
        output: null,
      })
      expect((await repo.findByEvent(WEDDING))?.status).toBe('done')
    })

    it('does not reach another event, nor a failed or absent row', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))

      expect((await repo.invalidate(GALA, PHOTO_IDS, atPlus(6_000))).staled).toBe(false)
      expect((await repo.findByEvent(WEDDING))?.status).toBe('done')
    })

    it('makes a queued montage stale, with no file to delete', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)

      const verdict = await repo.invalidate(WEDDING, [asPhotoId('p-a')], atPlus(1))

      expect(verdict).toEqual({ staled: true, output: null })
      expect(await repo.claimNext(atPlus(2))).toBeNull()
    })

    it('does not make a failed montage stale', async () => {
      await repo.request(reelOf(WEDDING), ROOMY)
      const claimed = await repo.claimNext(AT)
      const failed = claimed?.fail('reel.notEnoughPhotos', atPlus(1))
      if (failed === undefined || !failed.ok) throw new Error('fixture')
      await repo.save(failed.value)

      expect((await repo.invalidate(WEDDING, PHOTO_IDS, atPlus(2))).staled).toBe(false)
      expect((await repo.findByEvent(WEDDING))?.status).toBe('failed')
    })

    it('lists the stale rows that still name a file, for the boot sweep', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))
      await repo.invalidate(WEDDING, PHOTO_IDS, atPlus(6_000))

      const listed = await repo.listStaleOutputs()
      expect(listed.map((entry) => [entry.eventId, entry.hash.value])).toEqual([
        [WEDDING, OUTPUT.hash.value],
      ])

      await repo.clearOutput(WEDDING, OUTPUT.hash)
      expect(await repo.listStaleOutputs()).toEqual([])
    })

    it('does not clear a file the row does not name', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))

      await repo.clearOutput(WEDDING, hashOf('bb'))
      await repo.clearOutput(GALA, OUTPUT.hash)

      expect(await repo.reelBytes(WEDDING)).toBe(5_000)
    })

    // ---------------------------------------------------- asking again (reuse) --

    it('reuses the one row when asked again after a finished montage, and hands back the old file', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))
      const done = await repo.findByEvent(WEDDING)
      if (done === null) throw new Error('fixture')
      const fresh = done.rerequest(PHOTO_IDS, atPlus(9_000))
      if (!fresh.ok) throw new Error('fixture')

      const admission = await repo.request(fresh.value, ROOMY)

      expect(admission.refusal).toBeNull()
      expect(admission.replacedOutput?.equals(OUTPUT.hash)).toBe(true)
      const row = await repo.findByEvent(WEDDING)
      expect([row?.id, row?.status, row?.output]).toEqual(['reel-1', 'queued', null])
      expect(await repo.reelBytes(WEDDING)).toBe(0)
    })

    it('does not charge a recreation for the old file as well as the new one', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))
      const done = await repo.findByEvent(WEDDING)
      if (done === null) throw new Error('fixture')
      const fresh = done.rerequest(PHOTO_IDS, atPlus(9_000))
      if (!fresh.ok) throw new Error('fixture')

      // 3 000 of photographs + 5 000 of the old montage fills 8 000; asking again needs 5 000
      // more, which fits only because the old file is let go.
      const admission = await repo.request(fresh.value, {
        ...ROOMY,
        quotaBytes: 8_000,
        reservedBytes: 5_000,
      })

      expect(admission.refusal).toBeNull()
    })

    it('keeps the old montage when the new request is refused for room', async () => {
      await seedPhotos()
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))
      const done = await repo.findByEvent(WEDDING)
      if (done === null) throw new Error('fixture')
      const fresh = done.rerequest(PHOTO_IDS, atPlus(9_000))
      if (!fresh.ok) throw new Error('fixture')

      const admission = await repo.request(fresh.value, {
        ...ROOMY,
        quotaBytes: 8_000,
        reservedBytes: 6_000,
      })

      expect(admission.refusal?.reason).toBe('quotaExceeded')
      expect((await repo.findByEvent(WEDDING))?.status).toBe('done')
      expect(await repo.reelBytes(WEDDING)).toBe(5_000)
    })

    // ------------------------------------------------------ the quota's two halves --

    it('counts the montage in the event and client byte totals, as one sum with the photographs', async () => {
      await seedPhotos()
      await placeEventsInClient(asClientId('client-1'), [WEDDING])
      await repo.finish(await running(), OUTPUT, FINISH_ROOMY, atPlus(5_000))

      expect(await photos.totalBytes(WEDDING)).toBe(3_000 + 5_000)
      expect(await photos.clientTotalBytes(asClientId('client-1'))).toBe(3_000 + 5_000)
      expect(await photos.totalBytes(GALA)).toBe(0)
    })
  })
}
