import { describe, expect, it } from 'vitest'
import { ContentHash } from '../photos/contentHash'
import type { DomainError } from '../shared/errors'
import { asEventId, asPhotoId, asReelId } from '../shared/ids'
import type { Result } from '../shared/result'
import { ReelJob } from './reelJob'

const NOW = new Date('2026-11-01T10:00:00.000Z')
const LATER = new Date('2026-11-01T10:05:00.000Z')
const hash = (() => {
  const made = ContentHash.create('a'.repeat(64))
  if (!made.ok) throw new Error('fixture')
  return made.value
})()
const OUTPUT = { hash, byteSize: 1000, durationMs: 12_000 }

const queued = (): ReelJob =>
  ReelJob.request(
    {
      id: asReelId('reel-1'),
      eventId: asEventId('event-1'),
      photoIds: [asPhotoId('p1'), asPhotoId('p2'), asPhotoId('p3')],
    },
    NOW,
  )

const unwrap = (result: Result<ReelJob, DomainError>): ReelJob => {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('ReelJob', () => {
  it('starts queued, with no attempt, no failure and no file', () => {
    const job = queued()

    expect([job.status, job.attempts, job.failureCode, job.output]).toEqual([
      'queued',
      0,
      null,
      null,
    ])
    expect(job.notBefore).toEqual(NOW)
    expect(job.createdAt).toEqual(NOW)
  })

  it('knows which photographs it holds', () => {
    expect(queued().includes(asPhotoId('p2'))).toBe(true)
    expect(queued().includes(asPhotoId('p9'))).toBe(false)
  })

  it('counts an attempt when it is claimed', () => {
    const running = unwrap(queued().claim(LATER))

    expect([running.status, running.attempts, running.updatedAt]).toEqual(['running', 1, LATER])
  })

  it('goes back to the queue, attempt kept, after a recovered crash', () => {
    const recovered = unwrap(unwrap(queued().claim(NOW)).recover(LATER))

    expect([recovered.status, recovered.attempts, recovered.notBefore]).toEqual([
      'queued',
      1,
      LATER,
    ])
  })

  it('succeeds with its file', () => {
    const done = unwrap(unwrap(queued().claim(NOW)).succeed(OUTPUT, LATER))

    expect([done.status, done.output]).toEqual(['done', OUTPUT])
  })

  it('goes back to the queue after a transient failure, a little later', () => {
    const again = unwrap(unwrap(queued().claim(NOW)).fail('reel.renderFailed', NOW))

    expect(again.status).toBe('queued')
    expect(again.failureCode).toBe('reel.renderFailed')
    expect(again.notBefore.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('fails for good on a permanent failure, or when the third attempt fails', () => {
    expect(unwrap(unwrap(queued().claim(NOW)).fail('reel.notEnoughPhotos', NOW)).status).toBe(
      'failed',
    )

    let job = queued()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      job = unwrap(unwrap(job.claim(NOW)).fail('reel.renderFailed', NOW))
    }
    expect(job.status).toBe('failed')
  })

  it('goes stale from queued and done, keeping its file until it is deleted', () => {
    const done = unwrap(unwrap(queued().claim(NOW)).succeed(OUTPUT, NOW))
    const stale = unwrap(done.makeStale(LATER))

    expect([stale.status, stale.output]).toEqual(['stale', OUTPUT])
    expect(stale.withoutOutput(LATER).output).toBeNull()
    expect(unwrap(queued().makeStale(NOW)).status).toBe('stale')
  })

  it('is refused an illegal move with reel.illegalTransition', () => {
    const failed = unwrap(unwrap(queued().claim(NOW)).fail('reel.notEnoughPhotos', NOW))
    const result = failed.makeStale(NOW)

    expect(!result.ok && result.error.code).toBe('reel.illegalTransition')
  })

  it('is put back to the queue by a new request, with a fresh snapshot and no file', () => {
    const done = unwrap(unwrap(queued().claim(NOW)).succeed(OUTPUT, NOW))
    const fresh = unwrap(done.rerequest([asPhotoId('p7'), asPhotoId('p8'), asPhotoId('p9')], LATER))

    expect([fresh.status, fresh.attempts, fresh.output, fresh.failureCode]).toEqual([
      'queued',
      0,
      null,
      null,
    ])
    expect(fresh.photoIds).toEqual(['p7', 'p8', 'p9'])
    expect(fresh.notBefore).toEqual(LATER)
  })

  it('cannot be asked again while it is queued', () => {
    expect(queued().rerequest([], NOW).ok).toBe(false)
  })

  it('exposes its props for the repository', () => {
    expect(queued().toProps().eventId).toBe('event-1')
    expect(ReelJob.restore(queued().toProps()).id).toBe('reel-1')
    expect(queued().eventId).toBe('event-1')
  })
})
