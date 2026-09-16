import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asClipJobId, asEventId, asPhotoId, type EventId } from '../../../domain/shared/ids'
import type { ClipJob } from '../../../domain/clips/clipJob'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import { AT, aClipJob, atPlus } from '../builders'

/**
 * The shared `ClipJobRepository` contract.
 *
 * Run by the SQLite adapter and by `FakeClipJobRepository`, because a fake that drifts
 * from the adapter turns every ring-2 test about the queue into a lie — and this queue's
 * failure mode is the one nobody notices until an evening at a venue: a job claimed
 * twice, or a job nothing ever claims.
 *
 * Two cases here are not about tenant isolation and are the reason this port exists:
 * `claimNext` must be **atomic**, and `recoverAbandoned` must put back exactly the jobs a
 * dead process was holding.
 */

/**
 * Rows the subject must already hold: `clip_jobs` carries foreign keys to `events` and
 * `guests`. The `:memory:` harness seeds these; the fake needs nothing.
 */
export const CLIP_JOB_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  guestIds: ['guest-lea', 'guest-sam'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

/** A stable 64-hex digest for a seed, as the builders take it: a plain string. */
const hexOf = (seed: string): string => seed.padEnd(64, '0').slice(0, 64)

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(hexOf(seed))
  if (!result.ok) throw new Error(`bad fixture hash: ${seed}`)
  return result.value
}

/**
 * What a subject must provide beyond the port itself.
 *
 * `savePhotoBytes` is the mirror of `stageClipBytes` in the photo contract, and it is
 * here for the same reason: the event byte quota is **one number over two tables**, and
 * `stage` is one of the two places it is enforced. The SQLite adapter reads `photos`
 * inside the same statement as its `SUM` over `clip_jobs`; the fake is handed the photo
 * repository through `chargePhotoBytesFrom`. Those are two mechanisms for one rule, and
 * until this existed the fake's half was exercised by no contract case at all — it
 * happened to work only because two use-case tests wired it by hand.
 *
 * Required rather than optional: an implementation that cannot answer it cannot be
 * trusted with a quota.
 */
export interface ClipJobRepositorySubject {
  readonly repo: ClipJobRepository
  /** Put `byteSize` of *photographs* on this event's disk, by whatever route it has. */
  savePhotoBytes: (eventId: EventId, byteSize: number) => Promise<void>
  /**
   * Put a job row in, whatever its status.
   *
   * An arrange step, and it deliberately cannot be `save`: that is **update-only**,
   * because every production writer of it is a transition of a row that already exists —
   * and a write that re-inserted a job `deletePhoto` had just retired would resurrect a
   * clip the guest deleted.
   */
  insertJob: (job: ClipJob) => Promise<void>
  readonly dispose?: () => Promise<void>
}

export const clipJobRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ClipJobRepositorySubject>,
): void => {
  describe(`ClipJobRepository contract: ${name}`, () => {
    let repo: ClipJobRepository
    let savePhotoBytes: (eventId: EventId, byteSize: number) => Promise<void>
    let insertJob: (job: ClipJob) => Promise<void>
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      savePhotoBytes = subject.savePhotoBytes
      insertJob = subject.insertJob
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    describe('findById', () => {
      it('returns a job it was given', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.id).toBe('job-1')
      })

      it('returns null for a job that belongs to another event', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            author: { kind: 'guest', id: 'guest-lea' },
          }),
        )

        expect(await repo.findById(GALA, asClipJobId('job-1'))).toBeNull()
      })

      it('returns null for a job that does not exist', async () => {
        expect(await repo.findById(WEDDING, asClipJobId('nope'))).toBeNull()
      })
    })

    describe('findBySourceHash', () => {
      it('recognises the same upload sent twice', async () => {
        // The retry on venue Wi-Fi. Without this the box transcodes the same fifteen
        // seconds twice and the wall shows the clip twice.
        const job = aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceHash: hexOf('abc') })
        await insertJob(job)

        const found = await repo.findBySourceHash(WEDDING, hashOf('abc'))
        expect(found?.id).toBe('job-1')
      })

      it('does not answer with a job that was given up on', async () => {
        // **The rule that lets a refused clip be sent again.** `event.quotaExceeded` and
        // `event.photoLimitReached` are permanent verdicts about the *album*, not about
        // the bytes, and an album empties: the host deletes fifty photographs and the
        // same clip now fits. While a failed row answered here, that guest could never
        // send it again — no route retries or deletes a clip job.
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'failed',
            failureCode: 'event.quotaExceeded',
            sourceHash: hexOf('abc'),
          }),
        )

        expect(await repo.findBySourceHash(WEDDING, hashOf('abc'))).toBeNull()
      })

      it('answers with a job that is done, because its photo is on the wall', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'done',
            sourceHash: hexOf('abc'),
          }),
        )

        expect((await repo.findBySourceHash(WEDDING, hashOf('abc')))?.id).toBe('job-1')
      })

      it('does not find another event’s upload of the same bytes', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            author: { kind: 'guest', id: 'guest-lea' },
            sourceHash: hexOf('abc'),
          }),
        )

        expect(await repo.findBySourceHash(GALA, hashOf('abc'))).toBeNull()
      })
    })

    describe('save', () => {
      it('updates a job in place rather than inserting a second one', async () => {
        const job = aClipJob({ id: 'job-1', eventId: 'evt-wedding' })
        await insertJob(job)

        const claimed = job.claim(AT)
        expect(claimed.ok).toBe(true)
        if (claimed.ok) expect(await repo.save(claimed.value)).toBe(true)

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.status).toBe('running')
        expect(await repo.countActive()).toBe(1)
      })

      it('reports a job that has been retired under it, and does not put it back', async () => {
        // **The resurrection this method is update-only to prevent.** `deletePhoto`
        // retires a clip's job while the worker may still be holding that `ClipJob` and
        // about to write its `done` transition. Re-inserting would either name a photo
        // row that no longer exists, or — once the guest has re-uploaded, which is now
        // legal — collide with the fresh row on the partial unique index and throw out of
        // the worker, leaving the *first* job running for ever with its source never
        // released.
        const job = aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running' })
        await insertJob(job)
        await repo.deleteForPhoto(WEDDING, asPhotoId(job.photoId))

        const done = job.succeed(AT)
        expect(done.ok).toBe(true)
        if (!done.ok) return

        expect(await repo.save(done.value)).toBe(false)
        expect(await repo.findById(WEDDING, asClipJobId('job-1'))).toBeNull()
      })

      it('refuses a second job for bytes this event already has a job for', async () => {
        // The same unique index `stage` meets, reached by the other writer. An update of
        // the row that already holds those bytes is fine; a *second* row is not.
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceHash: hexOf('beef') }),
        )

        await expect(
          insertJob(aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceHash: hexOf('beef') })),
        ).rejects.toThrow()
      })

      it('lets the same bytes be staged again once the first job has failed', async () => {
        // The other half of the partial index. Refusing this insert would make the
        // re-upload above impossible however the dedupe answered.
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'failed',
            sourceHash: hexOf('beef'),
          }),
        )

        await insertJob(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceHash: hexOf('beef') }),
        )

        expect((await repo.findBySourceHash(WEDDING, hashOf('beef')))?.id).toBe('job-2')
      })

      it('round-trips every field the entity carries', async () => {
        const job = aClipJob({
          id: 'job-1',
          eventId: 'evt-wedding',
          author: { kind: 'guest', id: 'guest-lea' },
          caption: 'Le premier slow',
          sourceByteSize: 7_654_321,
          attempts: 2,
          status: 'failed',
          failureCode: 'clip.noVideoStream',
          notBefore: atPlus(5_000),
          updatedAt: atPlus(9_000),
        })
        await insertJob(job)

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.toProps()).toEqual(job.toProps())
      })
    })

    describe('deleteForPhoto', () => {
      it('retires the job that produced a photo', async () => {
        // A `done` job blocks the dedupe. Without this, a guest who deleted their own
        // clip by mistake and sent it again was told it was already here, with the id of
        // a photo row that no longer existed.
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done', photoId: 'photo-1' }),
        )

        await repo.deleteForPhoto(WEDDING, asPhotoId('photo-1'))

        expect(await repo.findById(WEDDING, asClipJobId('job-1'))).toBeNull()
      })

      it('is a no-op for a photo no clip job produced', async () => {
        // Every delete calls it, and most of them are photographs.
        await expect(repo.deleteForPhoto(WEDDING, asPhotoId('photo-none'))).resolves.toBeUndefined()
      })

      it('never retires a job belonging to another event', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'done',
            photoId: 'photo-1',
          }),
        )

        await repo.deleteForPhoto(GALA, asPhotoId('photo-1'))

        expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.id).toBe('job-1')
      })
    })

    describe('claimNext', () => {
      it('answers null when nothing is queued', async () => {
        // The ordinary case: the queue is empty for most of an evening.
        expect(await repo.claimNext(AT)).toBeNull()
      })

      it('marks the job running, so a second worker cannot take the same one', async () => {
        // Two workers holding one output path is a corrupt file, not a slow queue. This
        // is the case the transaction inside the adapter exists for.
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        const first = await repo.claimNext(AT)
        const second = await repo.claimNext(AT)

        expect(first?.id).toBe('job-1')
        expect(first?.status).toBe('running')
        expect(second).toBeNull()
      })

      it('counts the attempt as it claims', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        expect((await repo.claimNext(AT))?.attempts).toBe(1)
      })

      it('will not claim a job whose backoff has not elapsed', async () => {
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', notBefore: atPlus(10_000) }),
        )

        expect(await repo.claimNext(AT)).toBeNull()
        expect((await repo.claimNext(atPlus(10_000)))?.id).toBe('job-1')
      })

      it('takes the oldest due job first, so nobody is starved behind a late arrival', async () => {
        await insertJob(
          aClipJob({ id: 'job-late', eventId: 'evt-wedding', createdAt: atPlus(5_000) }),
        )
        await insertJob(aClipJob({ id: 'job-early', eventId: 'evt-wedding', createdAt: AT }))

        expect((await repo.claimNext(atPlus(10_000)))?.id).toBe('job-early')
      })

      it('drains every event, because there is one worker for the box', async () => {
        // The deliberate exception to "every read is scoped by eventId": the worker
        // cannot name the event whose guest is about to upload.
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
          }),
        )

        expect((await repo.claimNext(AT))?.eventId).toBe('evt-gala')
      })

      it('does not claim a job that has already finished', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done' }))
        await insertJob(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed' }))

        expect(await repo.claimNext(AT)).toBeNull()
      })
    })

    describe('recoverAbandoned', () => {
      it('puts a job the crash left running back on the queue', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running' }))

        const recovered = await repo.recoverAbandoned(atPlus(60_000))

        expect(recovered.map((job) => job.id)).toEqual(['job-1'])
        expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.status).toBe('queued')
      })

      it('makes the recovered job claimable straight away', async () => {
        // The guest has already waited once; a restart must not cost them a second wait.
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running' }))
        await repo.recoverAbandoned(atPlus(60_000))

        expect((await repo.claimNext(atPlus(60_000)))?.id).toBe('job-1')
      })

      it('gives up on a job that has spent its attempts rather than looping forever', async () => {
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running', attempts: 3 }),
        )

        await repo.recoverAbandoned(atPlus(60_000))

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.status).toBe('failed')
        expect(found?.failureCode).toBe('clip.abandoned')
      })

      it('leaves queued and finished jobs alone', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued' }))
        await insertJob(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'done' }))

        expect(await repo.recoverAbandoned(atPlus(60_000))).toEqual([])
      })
    })

    describe('stage', () => {
      const ROOM = { quotaBytes: 1_000, maxQueuedClips: 2 } as const

      it('admits a clip the event has room for, and the row is then readable', async () => {
        const admission = await repo.stage(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceByteSize: 100 }),
          ROOM,
        )

        expect(admission.refusal).toBeNull()
        expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.id).toBe('job-1')
      })

      it('refuses a clip the quota has no room for, and writes nothing', async () => {
        // The enforcing check, inside the insert's own transaction. The upload path also
        // asks before it writes sixty megabytes to the disk, but that one is advisory:
        // two uploads in flight both pass it.
        await repo.stage(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceByteSize: 900 }),
          ROOM,
        )

        const admission = await repo.stage(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceByteSize: 200 }),
          ROOM,
        )

        expect(admission.refusal).toEqual({ reason: 'quotaExceeded', remaining: 100 })
        expect(await repo.findById(WEDDING, asClipJobId('job-2'))).toBeNull()
      })

      it('charges one event only, so a quota is never spent by another party', async () => {
        await repo.stage(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            sourceByteSize: 900,
          }),
          ROOM,
        )

        const admission = await repo.stage(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceByteSize: 200 }),
          ROOM,
        )

        expect(admission.refusal).toBeNull()
      })

      it('counts the album against the same quota line as the queue', async () => {
        // The half of the quota that is not the queue. The adapter reads `photos` inside
        // the same statement as its `SUM` over `clip_jobs`; the fake is handed the photo
        // repository. Without this case the fake's half was asserted nowhere, and it
        // passed only because two use-case tests happened to wire it by hand.
        await savePhotoBytes(WEDDING, 900)

        const admission = await repo.stage(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceByteSize: 200 }),
          ROOM,
        )

        expect(admission.refusal).toEqual({ reason: 'quotaExceeded', remaining: 100 })
      })

      it('never charges one event for another event’s album', async () => {
        await savePhotoBytes(GALA, 900)

        const admission = await repo.stage(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceByteSize: 200 }),
          ROOM,
        )

        expect(admission.refusal).toBeNull()
      })

      it('raises rather than admitting a second job for bytes this event already holds', async () => {
        // **The behaviour the port documents, and the one a caller must handle.** The
        // upload path checks `findBySourceHash` first, but that check and this insert are
        // separated by an `await` and an up-to-80 MB write, so two guests sending the
        // same video from the group chat both miss it. The unique index is what refuses
        // the second, and a caller that reads this as an ordinary failure deletes the
        // first guest's staged source.
        await repo.stage(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            sourceHash: hexOf('beef'),
            sourceByteSize: 10,
          }),
          ROOM,
        )

        await expect(
          repo.stage(
            aClipJob({
              id: 'job-2',
              eventId: 'evt-wedding',
              sourceHash: hexOf('beef'),
              sourceByteSize: 10,
            }),
            ROOM,
          ),
        ).rejects.toThrow()

        expect(await repo.findById(WEDDING, asClipJobId('job-2'))).toBeNull()
      })

      it('admits the same bytes in another event, because each event owns its copy', async () => {
        await repo.stage(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            sourceHash: hexOf('beef'),
            sourceByteSize: 10,
          }),
          ROOM,
        )

        const admission = await repo.stage(
          aClipJob({
            id: 'job-2',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            sourceHash: hexOf('beef'),
            sourceByteSize: 10,
          }),
          ROOM,
        )

        expect(admission.refusal).toBeNull()
      })

      it('refuses a clip when the queue is full, with the depth it saw', async () => {
        // Deliberately a different refusal from the quota's: one clears in ninety
        // seconds and the other does not, and the guest is told which.
        await repo.stage(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceByteSize: 10 }),
          ROOM,
        )
        await repo.stage(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceByteSize: 10 }),
          ROOM,
        )

        const admission = await repo.stage(
          aClipJob({ id: 'job-3', eventId: 'evt-wedding', sourceByteSize: 10 }),
          ROOM,
        )

        expect(admission.refusal).toEqual({ reason: 'queueFull', depth: 2 })
      })

      it('counts the depth across every event, because there is one worker', async () => {
        await repo.stage(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            sourceByteSize: 10,
          }),
          ROOM,
        )
        await repo.stage(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceByteSize: 10 }),
          ROOM,
        )

        const admission = await repo.stage(
          aClipJob({ id: 'job-3', eventId: 'evt-wedding', sourceByteSize: 10 }),
          ROOM,
        )

        expect(admission.refusal).toEqual({ reason: 'queueFull', depth: 2 })
      })

      it('lets a finished job give its slot and its bytes back', async () => {
        await repo.stage(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            sourceByteSize: 900,
            status: 'queued',
          }),
          ROOM,
        )
        expect(
          await repo.save(
            aClipJob({
              id: 'job-1',
              eventId: 'evt-wedding',
              sourceByteSize: 900,
              status: 'done',
            }),
          ),
        ).toBe(true)

        const admission = await repo.stage(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', sourceByteSize: 900 }),
          ROOM,
        )

        expect(admission.refusal).toBeNull()
      })
    })

    describe('stagedBytes', () => {
      it('charges an event for the sources still waiting on its disk', async () => {
        // Counting only the transcoded output would leave the database and the disk
        // disagreeing for the whole time the queue is draining.
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued', sourceByteSize: 100 }),
        )
        await insertJob(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'running', sourceByteSize: 30 }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(130)
      })

      it('stops charging once a job has given its bytes back', async () => {
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done', sourceByteSize: 100 }),
        )
        await insertJob(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed', sourceByteSize: 30 }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(0)
      })

      it('charges a reservation, because the row exists before the bytes do', async () => {
        // The whole point of reserving first: the quota is computed from rows, so an
        // upload that is admitted but whose bytes have not landed yet must already cost
        // the event — otherwise a burst of identical uploads fills the disk while every
        // individual check passes.
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'reserved',
            sourceByteSize: 100,
          }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(100)
      })
    })

    describe('stagedBytesOf', () => {
      it('answers what one job alone is charged', async () => {
        // The transcode worker's case: it inserts a clip's output while that clip's own
        // job is still `running`, so without crediting this back the event is charged for
        // the source and the result it became.
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running', sourceByteSize: 100 }),
        )
        await insertJob(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'queued', sourceByteSize: 30 }),
        )

        expect(await repo.stagedBytesOf(WEDDING, asClipJobId('job-1'))).toBe(100)
      })

      it('answers zero for a job that is holding nothing', async () => {
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done', sourceByteSize: 100 }),
        )

        expect(await repo.stagedBytesOf(WEDDING, asClipJobId('job-1'))).toBe(0)
      })

      it('answers zero for a job in another event', async () => {
        await insertJob(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running', sourceByteSize: 100 }),
        )

        expect(await repo.stagedBytesOf(GALA, asClipJobId('job-1'))).toBe(0)
      })
    })

    describe('stagedBytes, continued', () => {
      it('never charges one event for another event’s queue', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            sourceByteSize: 100,
          }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(0)
        expect(await repo.stagedBytes(GALA)).toBe(100)
      })
    })

    describe('listStagedSources', () => {
      it('names the digests this event still has staged', async () => {
        // The queue half of what the reconciliation sweep compares against. Asked per
        // event, because per object was a seek per digest on the connection serving
        // uploads and the projector.
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', sourceHash: hexOf('abc') }))

        expect([...(await repo.listStagedSources(WEDDING))]).toEqual([hexOf('abc')])
      })

      it('includes a reservation, whose bytes may be landing right now', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'reserved',
            sourceHash: hexOf('abc'),
          }),
        )

        expect([...(await repo.listStagedSources(WEDDING))]).toEqual([hexOf('abc')])
      })

      it('leaves out a job that has given its source back', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-wedding',
            status: 'done',
            sourceHash: hexOf('abc'),
          }),
        )

        expect([...(await repo.listStagedSources(WEDDING))]).toEqual([])
      })

      it('never names another event’s staged source', async () => {
        await insertJob(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            sourceHash: hexOf('abc'),
          }),
        )

        expect([...(await repo.listStagedSources(WEDDING))]).toEqual([])
      })
    })

    describe('countActive', () => {
      it('counts what is still holding disk, across every event', async () => {
        // Drives backpressure, and the number that matters to a waiting guest is the
        // global one: one worker serves every event on the box.
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued' }))
        await insertJob(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'running' }))
        await insertJob(
          aClipJob({
            id: 'job-3',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
            status: 'queued',
          }),
        )

        expect(await repo.countActive()).toBe(3)
      })

      it('stops counting a job once it has given its bytes back', async () => {
        await insertJob(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done' }))
        await insertJob(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed' }))

        expect(await repo.countActive()).toBe(0)
      })
    })
  })
}
