import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '../../../lib/format'
import { fr } from '../../../lib/i18n/fr'
import { WallEmptyState } from './WallEmptyState'
import { WallRevealWait } from './WallRevealWait'

// Noon by this machine's own clock, so "tonight" is the same day in every time zone.
const NOW = new Date(2026, 5, 20, 12, 0, 0).getTime()
const HOUR = 3_600_000
const MINUTE = 60_000
const JOIN = { code: 'H7K2QM', url: 'https://photos.example.com/join/H7K2QM' }

describe('WallRevealWait (spec 23)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says the hour, the time left and how many photographs are being developed', () => {
    render(<WallRevealWait atMs={NOW + 3 * HOUR + 10 * MINUTE} readyCount={128} offsetMs={0} />)

    expect(screen.getByTestId('wall-reveal-at')).toHaveTextContent(
      fr.reveal.wallAt(formatTime(NOW + 3 * HOUR + 10 * MINUTE, 'fr') ?? ''),
    )
    expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent('Révélation dans 3 h 10')
    expect(screen.getByTestId('wall-reveal-count')).toHaveTextContent(
      '128 photos en cours de développement',
    )
  })

  it('counts down on the server’s clock: a machine five minutes ahead or behind says the same', () => {
    for (const skew of [5 * MINUTE, -5 * MINUTE]) {
      // This machine reads `NOW + skew` when the server's clock says `NOW`: the offset is `-skew`.
      vi.setSystemTime(NOW + skew)
      const { unmount } = render(
        <WallRevealWait atMs={NOW + 2 * HOUR} readyCount={null} offsetMs={-skew} />,
      )

      expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent('Révélation dans 2 h 00')
      unmount()
    }
  })

  it('keeps counting as time passes, with no live region', () => {
    render(<WallRevealWait atMs={NOW + 2 * HOUR} readyCount={null} offsetMs={0} />)
    expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent('Révélation dans 2 h 00')

    act(() => {
      vi.advanceTimersByTime(30 * MINUTE)
    })

    expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent('Révélation dans 1 h 30')
    expect(screen.getByTestId('wall-reveal').closest('[aria-live]')).toBeNull()
  })

  it('names the day when the hour is not today by the server’s clock', () => {
    const tomorrow = NOW + 20 * HOUR
    render(<WallRevealWait atMs={tomorrow} readyCount={null} offsetMs={0} />)

    expect(screen.getByTestId('wall-reveal-at').textContent).toMatch(/^Révélation le /)
  })

  it('says "bientôt" with no hour, and no countdown', () => {
    render(<WallRevealWait atMs={null} readyCount={4} offsetMs={0} />)

    expect(screen.getByTestId('wall-reveal-at')).toHaveTextContent(fr.reveal.wallSoon)
    expect(screen.queryByTestId('wall-reveal-left')).toBeNull()
  })

  it('says one photograph in the singular, and draws no line for none or an unknown count', () => {
    const { rerender } = render(<WallRevealWait atMs={null} readyCount={1} offsetMs={0} />)
    expect(screen.getByTestId('wall-reveal-count')).toHaveTextContent(
      '1 photo en cours de développement',
    )

    rerender(<WallRevealWait atMs={null} readyCount={0} offsetMs={0} />)
    expect(screen.queryByTestId('wall-reveal-count')).toBeNull()

    rerender(<WallRevealWait atMs={null} readyCount={null} offsetMs={0} />)
    expect(screen.queryByTestId('wall-reveal-count')).toBeNull()
  })

  it('is added to the invitation of the empty wall, which keeps its QR and its code', () => {
    render(
      <WallEmptyState
        eventName="Camille & Sacha"
        join={JOIN}
        reveal={{ atMs: NOW + HOUR, readyCount: 2, offsetMs: 0 }}
      />,
    )

    expect(screen.getByTestId('wall-reveal')).toBeVisible()
    expect(screen.getByTestId('wall-join')).toBeVisible()
    expect(screen.getByText(JOIN.code)).toBeVisible()
  })

  it('adds nothing to an empty wall that waits for no reveal', () => {
    render(<WallEmptyState eventName="Camille & Sacha" join={JOIN} />)

    expect(screen.queryByTestId('wall-reveal')).toBeNull()
  })

  describe('the line under the name (spec 23b, point 2)', () => {
    it('drops "the first photos will arrive soon" when photographs already wait for the reveal', () => {
      render(
        <WallEmptyState
          eventName="Camille & Sacha"
          join={JOIN}
          reveal={{ atMs: NOW + HOUR, readyCount: 14, offsetMs: 0 }}
        />,
      )

      expect(screen.queryByText(fr.wall.empty)).toBeNull()
      expect(screen.queryByTestId('wall-empty-title')).toBeNull()
      expect(screen.getByTestId('wall-reveal-count')).toHaveTextContent(fr.reveal.developing(14))
    })

    it('says the photographs will be developed at the reveal when none waits yet, not the empty wall’s line', () => {
      render(
        <WallEmptyState
          eventName="Camille & Sacha"
          join={JOIN}
          reveal={{ atMs: NOW + HOUR, readyCount: 0, offsetMs: 0 }}
        />,
      )

      expect(screen.getByTestId('wall-empty-title')).toHaveTextContent(fr.reveal.wallDeveloping)
      expect(screen.queryByText(fr.wall.empty)).toBeNull()
    })

    it('says the same while the server has no count yet', () => {
      render(
        <WallEmptyState
          eventName="Camille & Sacha"
          join={JOIN}
          reveal={{ atMs: null, readyCount: null, offsetMs: 0 }}
        />,
      )

      expect(screen.getByTestId('wall-empty-title')).toHaveTextContent(fr.reveal.wallDeveloping)
    })

    it('keeps the empty wall’s own line, word for word, on an evening without the mode', () => {
      render(<WallEmptyState eventName="Camille & Sacha" join={JOIN} />)

      expect(screen.getByTestId('wall-empty-title')).toHaveTextContent(fr.wall.empty)
      expect(screen.queryByText(fr.reveal.wallDeveloping)).toBeNull()
    })

    it('keeps the thanks of a closed evening, whatever waits', () => {
      render(
        <WallEmptyState
          eventName="Camille & Sacha"
          join={JOIN}
          acceptsGuests={false}
          reveal={{ atMs: NOW + HOUR, readyCount: 0, offsetMs: 0 }}
        />,
      )

      expect(screen.getByTestId('wall-empty-title')).toHaveTextContent(fr.wall.emptyClosed)
    })
  })
})
