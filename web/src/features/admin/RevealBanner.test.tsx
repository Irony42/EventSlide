import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatDateTime, formatTime } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { anEventDto, fakeApi } from '../../testing/renderWithProviders'
import { HOUR, MINUTE, NOW, held, renderReveal } from './testing/revealHarness'

/**
 * The banner at the top of the event page (spec 23b, point 4), next to the section it shares its
 * state with: what it says, when it is there, and that its button is the section's button.
 */

const banner = (): HTMLElement => screen.getByTestId('reveal-banner')

describe('RevealBanner (spec 23b)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads "Appareil jetable · Révélation à 22:00 · dans 1 h 33 · 14 photos attendent"', () => {
    const atMs = NOW + HOUR + 33 * MINUTE
    renderReveal(held({ inMs: HOUR + 33 * MINUTE, readyCount: 14 }), { banner: true })

    expect(banner()).toHaveTextContent(
      [
        fr.reveal.title,
        // "Tonight" by this machine's own zone: the day is only said when the hour is not today.
        new Date(atMs).toDateString() === new Date(NOW).toDateString()
          ? fr.reveal.guestAt(formatTime(atMs, 'fr') ?? '')
          : fr.reveal.guestOn(formatDateTime(new Date(atMs).toISOString(), 'fr') ?? ''),
        fr.reveal.guestLeft(1, 33),
        fr.reveal.bannerWaiting(14),
      ].join(' · '),
    )
  })

  it('says "Révélation au bouton" when no hour is set', () => {
    renderReveal(held({ inMs: null, readyCount: 3 }), { banner: true })

    expect(banner()).toHaveTextContent(`${fr.reveal.title} · ${fr.reveal.bannerManual}`)
    expect(banner()).not.toHaveTextContent(fr.reveal.guestSoon)
  })

  it('says "in under a minute" for the last minute', () => {
    renderReveal(held({ inMs: 40_000 }), { banner: true })

    expect(banner()).toHaveTextContent(fr.reveal.guestSoon)
  })

  it('names the day when the hour is not tonight', () => {
    renderReveal(held({ inMs: 30 * HOUR }), { banner: true })

    expect(banner()).toHaveTextContent(/Révélation le /)
  })

  it('leaves the count out while no photograph waits, rather than saying zero', () => {
    renderReveal(held({ readyCount: 0 }), { banner: true })

    expect(banner()).not.toHaveTextContent('0 photo')
    expect(banner()).toHaveTextContent(fr.reveal.title)
  })

  it('says a single waiting photograph in the singular', () => {
    renderReveal(held({ readyCount: 1 }), { banner: true })

    expect(banner()).toHaveTextContent(fr.reveal.bannerWaiting(1))
  })

  it('is not drawn once the evening is revealed', () => {
    renderReveal(held({ revealed: true }), { banner: true })

    expect(screen.queryByTestId('reveal-banner')).toBeNull()
  })

  it('is not drawn on an evening without the mode', () => {
    renderReveal(anEventDto(), { banner: true })

    expect(screen.queryByTestId('reveal-banner')).toBeNull()
  })

  it('is a plain region with no live announcement', () => {
    renderReveal(held(), { banner: true })

    expect(banner().closest('[aria-live]')).toBeNull()
    expect(banner()).not.toHaveAttribute('role', 'status')
  })

  it.each(['the banner', 'the section'] as const)(
    'opens the one shared confirmation from %s, and calls the one reveal once confirmed',
    async (from) => {
      const api = fakeApi({ revealEvent: vi.fn(async () => held({ revealed: true })) })
      renderReveal(held(), { api, banner: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const buttons = screen.getAllByRole('button', { name: fr.reveal.revealNow })
      const inBanner = buttons.filter((b) => banner().contains(b))
      const inSection = buttons.filter((b) => !banner().contains(b))
      expect(inBanner).toHaveLength(1)
      expect(inSection).toHaveLength(1)

      await user.click((from === 'the banner' ? inBanner : inSection)[0]!)
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(screen.getByRole('dialog')).toHaveTextContent(fr.reveal.confirmTitle)
      expect(api.revealEvent).not.toHaveBeenCalled()

      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: fr.reveal.revealNow }),
      )
      await vi.waitFor(() => expect(api.revealEvent).toHaveBeenCalledTimes(1))
    },
  )
})
