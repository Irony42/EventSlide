import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import type { WallChallengeDto } from '../../../lib/api/dto'
import styles from './WallChallenge.module.css'
import { ENDED_SHOWN_MS, WallChallenge } from './WallChallenge'

const NOW = new Date('2026-06-20T21:00:00.000Z')

const challenge = (overrides: Partial<WallChallengeDto> = {}): WallChallengeDto => ({
  id: 'c1',
  prompt: 'un selfie avec votre voisin',
  startedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  endsAt: new Date(NOW.getTime() + 102_000).toISOString(),
  state: 'running',
  answers: null,
  ...overrides,
})

const reducedMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

const mount = (
  props: Partial<Parameters<typeof WallChallenge>[0]> & { readonly challenge: WallChallengeDto },
) => {
  const onElapsed = vi.fn()
  const onLeave = vi.fn()
  const view = render(
    <LocaleProvider initialLocale="fr">
      <WallChallenge offsetMs={0} onElapsed={onElapsed} onLeave={onLeave} {...props} />
    </LocaleProvider>,
  )
  return { ...view, onElapsed, onLeave }
}

describe('WallChallenge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the title, the time left and the prompt', () => {
    mount({ challenge: challenge() })

    expect(screen.getByText('1:42')).toBeVisible()
    expect(screen.getByText(/Défi photo/)).toBeVisible()
    expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
  })

  it('changes one tick a second, and nothing else moves', async () => {
    mount({ challenge: challenge() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText('1:41')).toBeVisible()
  })

  it('says the start once, to a screen reader, and keeps the digits out of its sight', () => {
    const { container } = mount({ challenge: challenge() })

    expect(screen.getByRole('status')).toHaveTextContent(
      fr.challenge.announceStart('un selfie avec votre voisin'),
    )
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('1:42')
  })

  it('warns in the last ten seconds by the token and not by motion', () => {
    const { container } = mount({
      challenge: challenge({ endsAt: new Date(NOW.getTime() + 9_000).toISOString() }),
    })

    expect(container.firstElementChild).toHaveClass(styles['urgent'] ?? 'urgent')
    expect(container.querySelector('[data-wall-challenge]')?.className).not.toContain('pulse')
  })

  it('does not warn before the last ten seconds', () => {
    const { container } = mount({ challenge: challenge() })

    expect(container.firstElementChild).not.toHaveClass(styles['urgent'] ?? 'urgent')
  })

  it('enters with the short fade, unless the browser asks for no motion', () => {
    const { container, unmount } = mount({ challenge: challenge() })
    expect(container.firstElementChild).toHaveClass(styles['enters'] ?? 'enters')
    unmount()

    reducedMotion()
    const reduced = mount({ challenge: challenge() })

    expect(reduced.container.firstElementChild).not.toHaveClass(styles['enters'] ?? 'enters')
    // The countdown is information, not motion: it is unchanged.
    expect(screen.getByText('1:42')).toBeVisible()
  })

  it('asks for a fresh read once when the clock runs out while the server still says running', async () => {
    const { onElapsed } = mount({
      challenge: challenge({ endsAt: new Date(NOW.getTime() + 2_000).toISOString() }),
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(onElapsed).toHaveBeenCalledTimes(1)
    expect(screen.getByText(fr.challenge.ended)).toBeVisible()
  })

  it('does not ask again once the server has said it ended', () => {
    const { onElapsed } = mount({ challenge: challenge({ state: 'ended', answers: 2 }) })

    expect(onElapsed).not.toHaveBeenCalled()
    expect(screen.getByText(`${fr.challenge.ended} · 2 photos`)).toBeVisible()
  })

  it('counts the clock against the server’s: a machine three minutes ahead shows the same time', () => {
    // The server's clock runs three minutes behind this machine's and says 1:42 are left: the
    // challenge ends, on this machine's own clock, 78 seconds ago.
    const endsAt = new Date(NOW.getTime() - 180_000 + 102_000).toISOString()
    mount({ challenge: challenge({ endsAt }), offsetMs: -180_000 })

    expect(screen.getByText('1:42')).toBeVisible()
  })

  it('leaves ten seconds after the end, and says so once', async () => {
    const { container, onLeave } = mount({ challenge: challenge({ state: 'ended', answers: 2 }) })
    expect(container.firstElementChild).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENDED_SHOWN_MS - 1)
    })
    expect(onLeave).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(container.firstElementChild).toBeNull()
  })

  it('leaves no interval behind when it is removed', () => {
    const { unmount } = mount({ challenge: challenge() })
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
