import { describe, expect, it } from 'vitest'
import {
  REEL_STATUSES,
  canGoStale,
  canTransition,
  holdsOutputBytes,
  isActive,
  isReelStatus,
} from './reelStatus'

describe('reel status machine', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'stale'],
    ['running', 'queued'],
    ['running', 'done'],
    ['running', 'failed'],
    ['running', 'stale'],
    ['done', 'stale'],
    ['done', 'queued'],
    ['failed', 'queued'],
    ['stale', 'queued'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each([
    ['queued', 'done'],
    ['queued', 'failed'],
    ['done', 'running'],
    ['failed', 'done'],
    ['failed', 'stale'],
    ['stale', 'done'],
    ['stale', 'running'],
  ] as const)('refuses %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it('only a queued or running reel is active, which is what blocks asking for another', () => {
    expect(REEL_STATUSES.filter(isActive)).toEqual(['queued', 'running'])
  })

  it('a failed reel has nothing to spoil, the others do', () => {
    expect(REEL_STATUSES.filter(canGoStale)).toEqual(['queued', 'running', 'done'])
  })

  it('only a finished or a stale reel holds a file against the quota', () => {
    expect(REEL_STATUSES.filter(holdsOutputBytes)).toEqual(['done', 'stale'])
  })

  it('recognises its own statuses and nothing else', () => {
    expect(REEL_STATUSES.every(isReelStatus)).toBe(true)
    expect(isReelStatus('reserved')).toBe(false)
    expect(isReelStatus(3)).toBe(false)
  })
})
