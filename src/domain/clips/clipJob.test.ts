import { describe, expect, it } from 'vitest'
import { Caption } from '../photos/caption'
import { ContentHash } from '../photos/contentHash'
import { asClipJobId, asEventId, asGuestId, asPhotoId, asUserId } from '../shared/ids'
import type { Result } from '../shared/result'
import type { DomainError } from '../shared/errors'
import { ClipJob, type NewClipJob } from './clipJob'
import { ABANDONED_CODE } from './clipJob'
import { MAX_ATTEMPTS } from './clipFailure'

const AT = new Date('2026-06-20T21:00:00.000Z')
const later = (ms: number): Date => new Date(AT.getTime() + ms)

const SOURCE_HASH = 'a'.repeat(64)

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected by the domain: ${result.error.code}`)
  return result.value
}

const newJob = (overrides: Partial<NewClipJob> = {}): NewClipJob => ({
  eventId: asEventId('event-1'),
  author: { kind: 'guest', guestId: asGuestId('guest-1') },
  sourceHash: must(ContentHash.create(SOURCE_HASH)),
  sourceByteSize: 8_000_000,
  caption: must(Caption.create('Le premier slow')),
  ...overrides,
})

const aJob = (overrides: Partial<NewClipJob> = {}): ClipJob =>
  must(ClipJob.create(newJob(overrides), asClipJobId('job-1'), asPhotoId('photo-1'), AT))

/** A job the worker has already taken, which is where every interesting rule starts. */
const running = (): ClipJob => must(aJob().claim(AT))

describe('ClipJob.create', () => {
  it('stages a clip as queued and claimable at once', () => {
    const job = aJob()
    expect(job.status).toBe('queued')
    expect(job.attempts).toBe(0)
    expect(job.isDue(AT)).toBe(true)
  })

  it('fixes the photo id at staging, before any transcode has run', () => {
    // The whole recovery story: a crash after the row lands is a lookup, not a guess.
    expect(aJob().photoId).toBe('photo-1')
  })

  it('keeps the guest caption, so it survives the queue', () => {
    expect(aJob().caption?.value).toBe('Le premier slow')
  })

  it('records no failure and no reviewer decision yet', () => {
    expect(aJob().failureCode).toBeNull()
  })

  it('refuses a source size that is not a whole number of bytes', () => {
    // These bytes are charged to the event quota from this instant; a fractional size
    // would charge it something the disk does not hold.
    const result = ClipJob.create(
      newJob({ sourceByteSize: 1.5 }),
      asClipJobId('job-1'),
      asPhotoId('photo-1'),
      AT,
    )
    expect(!result.ok && result.error.code).toBe('clip.sourceByteSizeInvalid')
  })

  it('refuses an empty source', () => {
    const result = ClipJob.create(
      newJob({ sourceByteSize: 0 }),
      asClipJobId('job-1'),
      asPhotoId('photo-1'),
      AT,
    )
    expect(!result.ok && result.error.code).toBe('clip.sourceByteSizeInvalid')
  })
})

describe('ClipJob.isAuthoredBy', () => {
  it('recognises the guest who sent it', () => {
    expect(aJob().isAuthoredBy({ kind: 'guest', guestId: asGuestId('guest-1') })).toBe(true)
  })

  it('does not hand one guest another guest’s clip', () => {
    expect(aJob().isAuthoredBy({ kind: 'guest', guestId: asGuestId('guest-2') })).toBe(false)
  })

  it('recognises a host who uploaded from the venue’s own camera', () => {
    const hosted = aJob({ author: { kind: 'host', userId: asUserId('user-1') } })
    expect(hosted.isAuthoredBy({ kind: 'host', userId: asUserId('user-1') })).toBe(true)
    expect(hosted.isAuthoredBy({ kind: 'host', userId: asUserId('user-2') })).toBe(false)
  })

  it('does not match a host against a guest’s clip, or the reverse', () => {
    expect(aJob().isAuthoredBy({ kind: 'host', userId: asUserId('user-1') })).toBe(false)
    const hosted = aJob({ author: { kind: 'host', userId: asUserId('user-1') } })
    expect(hosted.isAuthoredBy({ kind: 'guest', guestId: asGuestId('guest-1') })).toBe(false)
  })
})

describe('ClipJob.claim', () => {
  it('counts the attempt as it is taken, not when it fails', () => {
    // A clip that takes the process down with it must still spend an attempt, or a file
    // that crashes a decoder is claimed again at every boot, forever.
    const claimed = running()
    expect(claimed.status).toBe('running')
    expect(claimed.attempts).toBe(1)
  })

  it('refuses a second claim of a job already running', () => {
    const result = running().claim(AT)
    expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
  })

  it('leaves the original untouched', () => {
    const job = aJob()
    must(job.claim(AT))
    expect(job.status).toBe('queued')
    expect(job.attempts).toBe(0)
  })
})

describe('ClipJob.isDue', () => {
  it('is not due while its backoff has not elapsed', () => {
    const backedOff = must(running().fail('clip.transcodeFailed', AT))
    expect(backedOff.status).toBe('queued')
    expect(backedOff.isDue(AT)).toBe(false)
    expect(backedOff.isDue(later(2_000))).toBe(true)
  })

  it('is never due while it is running', () => {
    expect(running().isDue(later(60_000))).toBe(false)
  })
})

describe('ClipJob.succeed', () => {
  it('ends the job once the photo row exists', () => {
    const done = must(running().succeed(later(9_000)))
    expect(done.status).toBe('done')
    expect(done.updatedAt).toEqual(later(9_000))
  })

  it('clears a failure recorded by an earlier attempt', () => {
    const retried = must(running().fail('clip.transcodeFailed', AT))
    const done = must(must(retried.claim(later(3_000))).succeed(later(9_000)))
    expect(done.failureCode).toBeNull()
  })

  it('refuses to finish a job nobody claimed', () => {
    const result = aJob().succeed(AT)
    expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
  })
})

describe('ClipJob.fail', () => {
  it('brings a transient failure back with a backoff', () => {
    const failed = must(running().fail('clip.transcodeFailed', AT))
    expect(failed.status).toBe('queued')
    expect(failed.notBefore).toEqual(later(2_000))
    expect(failed.failureCode).toBe('clip.transcodeFailed')
  })

  it('gives up at once on a file that will never transcode', () => {
    // A file with no video stream has no video stream the second time either.
    const failed = must(running().fail('clip.noVideoStream', AT))
    expect(failed.status).toBe('failed')
    expect(failed.failureCode).toBe('clip.noVideoStream')
  })

  it('gives up on a transient failure once the attempts are spent', () => {
    let job = aJob()
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      job = must(job.claim(AT))
      const outcome = job.fail('clip.transcodeFailed', AT)
      job = must(outcome)
    }
    expect(job.status).toBe('failed')
    expect(job.attempts).toBe(MAX_ATTEMPTS)
  })

  it('refuses to fail a job that was never claimed', () => {
    const result = aJob().fail('clip.transcodeFailed', AT)
    expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
  })
})

describe('ClipJob.recover', () => {
  it('puts a job the crash left running back on the queue with no backoff', () => {
    // The guest has already waited once for this clip; a restart must not cost them a
    // second wait on top of it.
    const recovered = must(running().recover(later(120_000)))
    expect(recovered.status).toBe('queued')
    expect(recovered.notBefore).toEqual(later(120_000))
    expect(recovered.isDue(later(120_000))).toBe(true)
  })

  it('keeps the attempts already spent, so recovery is bounded', () => {
    expect(must(running().recover(AT)).attempts).toBe(1)
  })

  it('gives up on a clip that has taken the process down as often as it is allowed to', () => {
    let job = aJob()
    for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt += 1) {
      job = must(must(job.claim(AT)).fail('clip.transcodeFailed', AT))
    }
    const stuck = must(job.claim(AT))
    const abandoned = must(stuck.recover(AT))
    expect(abandoned.status).toBe('failed')
    expect(abandoned.failureCode).toBe(ABANDONED_CODE)
  })

  it('refuses to recover a job that is not running', () => {
    const result = aJob().recover(AT)
    expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
  })
})

describe('ClipJob.restore', () => {
  it('round-trips every field a row carries', () => {
    const props = must(running().succeed(later(9_000))).toProps()
    expect(ClipJob.restore(props).toProps()).toEqual(props)
  })
})
