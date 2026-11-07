import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import type { GuestChallengeDto } from '../../../lib/api/dto'
import { ParticipateBox } from './ParticipateBox'

const NOW = new Date('2026-06-20T21:00:00.000Z')

const challenge = (overrides: Partial<GuestChallengeDto> = {}): GuestChallengeDto => ({
  id: 'c1',
  missionId: null,
  prompt: 'un selfie avec votre voisin',
  endsAt: new Date(NOW.getTime() + 5_000).toISOString(),
  state: 'running',
  ...overrides,
})

const box = (c: GuestChallengeDto) => (
  <LocaleProvider initialLocale="fr">
    <ParticipateBox challenge={c} offsetMs={0} checked onChange={() => {}} />
  </LocaleProvider>
)

describe('ParticipateBox', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the checkbox while the challenge runs and goes at zero', async () => {
    render(box(challenge()))
    expect(screen.getByRole('checkbox', { name: fr.challenge.participate })).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('is not shown for a challenge the server says is over', () => {
    render(box(challenge({ state: 'ended' })))

    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reads the clock again when a new challenge arrives after the box has been idle', async () => {
    const first = challenge({ endsAt: new Date(NOW.getTime() + 1_000).toISOString() })
    const { rerender } = render(box(first))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.queryByRole('checkbox')).toBeNull()

    // The box was idle (no interval) for a minute; the next challenge is already over by the
    // clock, though a `now` frozen at the first one's end would still call it running.
    await act(async () => {
      vi.setSystemTime(NOW.getTime() + 60_000)
    })
    rerender(
      box(
        challenge({
          id: 'c2',
          endsAt: new Date(NOW.getTime() + 30_000).toISOString(),
        }),
      ),
    )

    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
