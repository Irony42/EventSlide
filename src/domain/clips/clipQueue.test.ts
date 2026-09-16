import { describe, expect, it } from 'vitest'
import { admitsAnotherClip, clipQueueFull, retryAfterSecondsFor } from './clipQueue'

describe('admitsAnotherClip', () => {
  it('admits a clip while the queue is below its depth', () => {
    expect(admitsAnotherClip(0, 20)).toBe(true)
    expect(admitsAnotherClip(19, 20)).toBe(true)
  })

  it('refuses once the queue is at its depth', () => {
    expect(admitsAnotherClip(20, 20)).toBe(false)
  })
})

describe('retryAfterSecondsFor', () => {
  it('grows with the queue, so twenty waiting clients do not all retry at once', () => {
    expect(retryAfterSecondsFor(2)).toBe(20)
    expect(retryAfterSecondsFor(20)).toBe(120)
  })

  it('never advises an immediate retry', () => {
    // `Retry-After: 0` is an invitation to hammer the endpoint that just said no.
    expect(retryAfterSecondsFor(0)).toBe(1)
  })

  it('never advises a wait so long that a guest gives up', () => {
    expect(retryAfterSecondsFor(10_000)).toBe(120)
  })
})

describe('clipQueueFull', () => {
  it('is a rate limit, never the quota refusal', () => {
    // 413 event.quotaExceeded tells a guest in French that the gallery is full and to
    // find the organiser. This condition clears in ninety seconds.
    const error = clipQueueFull(20, 20)
    expect(error.kind).toBe('rateLimited')
    expect(error.code).toBe('clip.queueFull')
  })

  it('carries the wait the route turns into a Retry-After header', () => {
    expect(clipQueueFull(6, 20).details['retryAfterSeconds']).toBe(60)
  })
})
