import { describe, expect, it } from 'vitest'
import {
  CLIP_JOB_STATUSES,
  blocksReupload,
  canTransition,
  holdsStagedBytes,
  isClipJobStatus,
  isTerminal,
} from './clipJobStatus'

describe('clip job status', () => {
  it('does not overlap the photo moderation vocabulary', () => {
    // The point of the separate machine: a moderator can never be offered "transcoding"
    // as a decision, because it is not one of the states a photo can be in.
    expect([...CLIP_JOB_STATUSES]).toEqual(['reserved', 'queued', 'running', 'done', 'failed'])
  })

  it.each([...CLIP_JOB_STATUSES])('accepts %s', (status) => {
    expect(isClipJobStatus(status)).toBe(true)
  })

  it('refuses a status the table has no row for', () => {
    expect(isClipJobStatus('transcoding')).toBe(false)
  })

  it('refuses a value that is not a string', () => {
    expect(isClipJobStatus(7)).toBe(false)
  })
})

describe('canTransition', () => {
  it('lets the worker claim a queued job', () => {
    expect(canTransition('queued', 'running')).toBe(true)
  })

  it.each(['queued', 'done', 'failed'] as const)('lets a running job move to %s', (to) => {
    expect(canTransition('running', to)).toBe(true)
  })

  it('refuses a second claim of a job that is already running', () => {
    // Two workers holding the same output path is a corrupt file, not an idempotent
    // no-op — which is why this machine, unlike PhotoStatus, refuses a self-transition.
    expect(canTransition('running', 'running')).toBe(false)
  })

  it('refuses to reopen a finished job', () => {
    expect(canTransition('done', 'running')).toBe(false)
    expect(canTransition('failed', 'queued')).toBe(false)
  })

  it('refuses to run a job that was never queued', () => {
    expect(canTransition('queued', 'done')).toBe(false)
  })
})

describe('isTerminal', () => {
  it.each(['done', 'failed'] as const)('%s is the end of the job', (status) => {
    expect(isTerminal(status)).toBe(true)
  })

  it.each(['queued', 'running'] as const)('%s still has work left', (status) => {
    expect(isTerminal(status)).toBe(false)
  })
})

describe('holdsStagedBytes', () => {
  it.each(['queued', 'running'] as const)('%s still occupies the disk', (status) => {
    expect(holdsStagedBytes(status)).toBe(true)
  })

  it.each(['done', 'failed'] as const)('%s has given its bytes back', (status) => {
    // The quota counts the staged source only while it exists. A done job's bytes were
    // replaced by the transcoded photo row; a failed job's were removed.
    expect(holdsStagedBytes(status)).toBe(false)
  })
})

describe('blocksReupload', () => {
  it.each(['reserved', 'queued', 'running', 'done'] as const)(
    '%s stops the same bytes being staged again',
    (status) => {
      // The dedupe: two jobs for one upload would be two transcodes and two slides.
      //
      // **`reserved` is the one that carries the concurrency race**, and it was the one
      // this list left out. A reservation is the row that exists while the source is
      // being written, so the partial unique index covers the digest from the moment the
      // upload is admitted — which is what makes two guests sending the same video from
      // the group chat land on one job instead of two. Leaving it unasserted meant the
      // fix for that race was held by nothing but the column it happened to be listed in.
      expect(blocksReupload(status)).toBe(true)
    },
  )

  it('lets a guest send a clip again once the first attempt failed', () => {
    // `event.quotaExceeded` and `event.photoLimitReached` are permanent verdicts about
    // the **album**, not about the bytes, and an album empties — the host deletes fifty
    // photographs and the clip that was refused now fits. While a failed row blocked, no
    // route in the product could clear it, so that guest had lost their video for good.
    expect(blocksReupload('failed')).toBe(false)
  })
})
