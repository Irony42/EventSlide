import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import type { GuestChallengeDto } from '../../../lib/api/dto'
import { ChallengeBand, ENDED_SHOWN_MS } from './ChallengeBand'

const NOW = new Date('2026-06-20T21:00:00.000Z')

const challenge = (overrides: Partial<GuestChallengeDto> = {}): GuestChallengeDto => ({
  id: 'c1',
  missionId: 'm1',
  prompt: 'un selfie avec votre voisin',
  endsAt: new Date(NOW.getTime() + 102_000).toISOString(),
  state: 'running',
  ...overrides,
})

const mount = (
  props: Partial<Parameters<typeof ChallengeBand>[0]> & { readonly challenge: GuestChallengeDto },
) => {
  const onTakeUp = vi.fn()
  const view = render(
    <LocaleProvider initialLocale="fr">
      <ChallengeBand offsetMs={0} onTakeUp={onTakeUp} {...props} />
    </LocaleProvider>,
  )
  return { ...view, onTakeUp }
}

describe('ChallengeBand', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the title, the time left and the mission sentence', () => {
    mount({ challenge: challenge() })

    expect(screen.getByText('1:42')).toBeVisible()
    expect(screen.getByText(/Défi photo/)).toBeVisible()
    expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
  })

  it('chooses the challenge mission when the guest takes it up', async () => {
    const { onTakeUp } = mount({ challenge: challenge() })

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: fr.challenge.takeUp }))

    expect(onTakeUp).toHaveBeenCalledWith('m1')
  })

  it('offers no button for a challenge whose mission was just deleted', () => {
    mount({ challenge: challenge({ missionId: null }) })

    expect(screen.queryByRole('button', { name: fr.challenge.takeUp })).not.toBeInTheDocument()
  })

  it('counts against the server clock: a phone three minutes ahead shows the same time', () => {
    // The server clock is three minutes behind this phone and says 1:42 are left.
    const endsAt = new Date(NOW.getTime() - 180_000 + 102_000).toISOString()

    mount({ challenge: challenge({ endsAt }), offsetMs: -180_000 })

    expect(screen.getByText('1:42')).toBeVisible()
  })

  it('counts down once a second', async () => {
    mount({ challenge: challenge() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('1:41')).toBeVisible()
  })

  it('says it is over at zero, takes the button away, and goes after ten seconds', async () => {
    const { container } = mount({
      challenge: challenge({ endsAt: new Date(NOW.getTime() + 2_000).toISOString() }),
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(screen.getByText(fr.challenge.ended)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.challenge.takeUp })).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENDED_SHOWN_MS)
    })
    expect(container.firstElementChild).toBeNull()
  })

  it('leaves no interval behind when it is removed', () => {
    const { unmount } = mount({ challenge: challenge() })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('asks nothing of the guest: no sound, no vibration, no dialog', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })

    mount({ challenge: challenge() })

    expect(vibrate).not.toHaveBeenCalled()
    expect(document.querySelector('audio')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
