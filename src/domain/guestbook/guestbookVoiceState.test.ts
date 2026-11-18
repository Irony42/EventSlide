import { describe, expect, it } from 'vitest'
import {
  VOICE_STATES,
  blocksVoiceResend,
  canTransitionVoice,
  countsAgainstVoiceLimits,
  holdsVoiceBytes,
  holdsVoiceSource,
  isVoiceInFlight,
  isVoiceState,
} from './guestbookVoiceState'

describe('voice states', () => {
  it('are the five of migration 032, in the order of a life', () => {
    expect([...VOICE_STATES]).toEqual(['reserved', 'queued', 'running', 'ready', 'failed'])
  })

  it('recognises its own words and nothing else', () => {
    expect(VOICE_STATES.every(isVoiceState)).toBe(true)
    expect(isVoiceState('done')).toBe(false)
    expect(isVoiceState(undefined)).toBe(false)
  })
})

describe('the voice machine', () => {
  const MOVES: readonly (readonly [string, string, boolean])[] = [
    ['reserved', 'queued', true],
    ['queued', 'running', true],
    ['running', 'queued', true],
    ['running', 'ready', true],
    ['running', 'failed', true],
    // What no path may do.
    ['reserved', 'running', false],
    ['reserved', 'ready', false],
    ['reserved', 'failed', false],
    ['queued', 'ready', false],
    ['queued', 'failed', false],
    ['queued', 'queued', false],
    ['running', 'running', false],
    ['ready', 'queued', false],
    ['ready', 'failed', false],
    ['failed', 'queued', false],
    ['failed', 'ready', false],
  ]

  it.each(MOVES)('%s to %s is %s', (from, to, allowed) => {
    expect(
      canTransitionVoice(
        from as (typeof VOICE_STATES)[number],
        to as (typeof VOICE_STATES)[number],
      ),
    ).toBe(allowed)
  })
})

describe('what each state holds', () => {
  it('holds its source on the disk while it is processed, and no longer once it is ready', () => {
    expect(VOICE_STATES.filter(holdsVoiceSource)).toEqual(['reserved', 'queued', 'running'])
    expect(VOICE_STATES.filter(isVoiceInFlight)).toEqual(['reserved', 'queued', 'running'])
  })

  it('is charged to the quota in every state but failed: the source, then the output', () => {
    expect(VOICE_STATES.filter(holdsVoiceBytes)).toEqual(['reserved', 'queued', 'running', 'ready'])
  })

  it('stops the same bytes being sent again in every state but failed', () => {
    expect(VOICE_STATES.filter(blocksVoiceResend)).toEqual([
      'reserved',
      'queued',
      'running',
      'ready',
    ])
  })

  it('counts toward the ceilings in every state but failed', () => {
    expect(VOICE_STATES.filter(countsAgainstVoiceLimits)).toEqual([
      'reserved',
      'queued',
      'running',
      'ready',
    ])
  })
})
