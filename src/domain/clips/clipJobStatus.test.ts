import { describe, expect, it } from 'vitest'
import {
  CLIP_JOB_STATUSES,
  canTransition,
  holdsStagedBytes,
  isClipJobStatus,
  isTerminal,
} from './clipJobStatus'

describe('clip job status', () => {
  it('does not overlap the photo moderation vocabulary', () => {
    // The point of the separate machine: a moderator can never be offered "transcoding"
    // as a decision, because it is not one of the states a photo can be in.
    expect([...CLIP_JOB_STATUSES]).toEqual(['queued', 'running', 'done', 'failed'])
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
