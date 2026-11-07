import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { GuestChallengeDto } from '../../lib/api/dto'
import { useServerCountdown } from '../../lib/useServerCountdown'
import { isChallengeRunning } from './challengeRunning'

/**
 * `isChallengeRunning` and the countdown hook's `over` are the same rule written twice, once
 * as a snapshot and once for a ticking banner. This pins them together: they never disagree.
 */
describe('isChallengeRunning agrees with the countdown hook', () => {
  const NOW = new Date('2026-06-20T21:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['running with time left', 'running', 5_000, 0],
    ['running, ends this very instant', 'running', 0, 0],
    ['running but past its end', 'running', -5_000, 0],
    ['ended by the server with time left', 'ended', 5_000, 0],
    ['over only by the server clock offset', 'running', 2_000, 3_000],
  ] as const)('%s', (_name, state, endsInMs, offsetMs) => {
    const challenge: GuestChallengeDto = {
      id: 'c1',
      missionId: null,
      prompt: 'Une photo de groupe',
      state,
      endsAt: new Date(NOW.getTime() + endsInMs).toISOString(),
    }

    const { result } = renderHook(() => useServerCountdown(challenge, offsetMs))

    expect(isChallengeRunning(challenge, offsetMs, NOW.getTime())).toBe(!result.current.over)
  })
})
