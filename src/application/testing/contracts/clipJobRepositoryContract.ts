import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asClipJobId, asEventId } from '../../../domain/shared/ids'
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

export const clipJobRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: ClipJobRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`ClipJobRepository contract: ${name}`, () => {
    let repo: ClipJobRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    describe('findById', () => {
      it('returns a job it was given', async () => {
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.id).toBe('job-1')
      })

      it('returns null for a job that belongs to another event', async () => {
        await repo.save(
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
        await repo.save(job)

        const found = await repo.findBySourceHash(WEDDING, hashOf('abc'))
        expect(found?.id).toBe('job-1')
      })

      it('does not find another event’s upload of the same bytes', async () => {
        await repo.save(
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
        await repo.save(job)

        const claimed = job.claim(AT)
        expect(claimed.ok).toBe(true)
        if (claimed.ok) await repo.save(claimed.value)

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.status).toBe('running')
        expect(await repo.countActive()).toBe(1)
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
        await repo.save(job)

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.toProps()).toEqual(job.toProps())
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
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        const first = await repo.claimNext(AT)
        const second = await repo.claimNext(AT)

        expect(first?.id).toBe('job-1')
        expect(first?.status).toBe('running')
        expect(second).toBeNull()
      })

      it('counts the attempt as it claims', async () => {
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

        expect((await repo.claimNext(AT))?.attempts).toBe(1)
      })

      it('will not claim a job whose backoff has not elapsed', async () => {
        await repo.save(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', notBefore: atPlus(10_000) }),
        )

        expect(await repo.claimNext(AT)).toBeNull()
        expect((await repo.claimNext(atPlus(10_000)))?.id).toBe('job-1')
      })

      it('takes the oldest due job first, so nobody is starved behind a late arrival', async () => {
        await repo.save(
          aClipJob({ id: 'job-late', eventId: 'evt-wedding', createdAt: atPlus(5_000) }),
        )
        await repo.save(aClipJob({ id: 'job-early', eventId: 'evt-wedding', createdAt: AT }))

        expect((await repo.claimNext(atPlus(10_000)))?.id).toBe('job-early')
      })

      it('drains every event, because there is one worker for the box', async () => {
        // The deliberate exception to "every read is scoped by eventId": the worker
        // cannot name the event whose guest is about to upload.
        await repo.save(
          aClipJob({
            id: 'job-1',
            eventId: 'evt-gala',
            author: { kind: 'guest', id: 'guest-sam' },
          }),
        )

        expect((await repo.claimNext(AT))?.eventId).toBe('evt-gala')
      })

      it('does not claim a job that has already finished', async () => {
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done' }))
        await repo.save(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed' }))

        expect(await repo.claimNext(AT)).toBeNull()
      })
    })

    describe('recoverAbandoned', () => {
      it('puts a job the crash left running back on the queue', async () => {
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running' }))

        const recovered = await repo.recoverAbandoned(atPlus(60_000))

        expect(recovered.map((job) => job.id)).toEqual(['job-1'])
        expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.status).toBe('queued')
      })

      it('makes the recovered job claimable straight away', async () => {
        // The guest has already waited once; a restart must not cost them a second wait.
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running' }))
        await repo.recoverAbandoned(atPlus(60_000))

        expect((await repo.claimNext(atPlus(60_000)))?.id).toBe('job-1')
      })

      it('gives up on a job that has spent its attempts rather than looping forever', async () => {
        await repo.save(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'running', attempts: 3 }),
        )

        await repo.recoverAbandoned(atPlus(60_000))

        const found = await repo.findById(WEDDING, asClipJobId('job-1'))
        expect(found?.status).toBe('failed')
        expect(found?.failureCode).toBe('clip.abandoned')
      })

      it('leaves queued and finished jobs alone', async () => {
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued' }))
        await repo.save(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'done' }))

        expect(await repo.recoverAbandoned(atPlus(60_000))).toEqual([])
      })
    })

    describe('stagedBytes', () => {
      it('charges an event for the sources still waiting on its disk', async () => {
        // Counting only the transcoded output would leave the database and the disk
        // disagreeing for the whole time the queue is draining.
        await repo.save(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued', sourceByteSize: 100 }),
        )
        await repo.save(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'running', sourceByteSize: 30 }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(130)
      })

      it('stops charging once a job has given its bytes back', async () => {
        await repo.save(
          aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done', sourceByteSize: 100 }),
        )
        await repo.save(
          aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed', sourceByteSize: 30 }),
        )

        expect(await repo.stagedBytes(WEDDING)).toBe(0)
      })

      it('never charges one event for another event’s queue', async () => {
        await repo.save(
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

    describe('countActive', () => {
      it('counts what is still holding disk, across every event', async () => {
        // Drives backpressure, and the number that matters to a waiting guest is the
        // global one: one worker serves every event on the box.
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'queued' }))
        await repo.save(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'running' }))
        await repo.save(
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
        await repo.save(aClipJob({ id: 'job-1', eventId: 'evt-wedding', status: 'done' }))
        await repo.save(aClipJob({ id: 'job-2', eventId: 'evt-wedding', status: 'failed' }))

        expect(await repo.countActive()).toBe(0)
      })
    })
  })
}
