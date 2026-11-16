import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { aWallAnnouncement } from '../../../testing/renderWithProviders'
import styles from './WallAnnouncementBand.module.css'
import { WallAnnouncementBand } from './WallAnnouncementBand'

const NOW = Date.parse('2026-11-16T21:00:00.000Z')

const mount = (leftMs: number, offsetMs = 0) =>
  render(
    <LocaleProvider initialLocale="fr">
      <WallAnnouncementBand
        announcement={aWallAnnouncement(NOW + leftMs + offsetMs)}
        offsetMs={offsetMs}
      />
    </LocaleProvider>,
  )

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

describe('WallAnnouncementBand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the sentence over the time left', () => {
    mount(272_000)

    expect(screen.getByText('Le gâteau arrive')).toBeInTheDocument()
    expect(screen.getByText(fr.wall.announcementIn('4:32'))).toBeInTheDocument()
  })

  it('counts one tick a second', async () => {
    mount(272_000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByText(fr.wall.announcementIn('4:31'))).toBeInTheDocument()
  })

  it('is hidden from assistive technology, whole', () => {
    const { container } = mount(272_000)

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the last ten seconds by the word and the token, not by the colour alone', () => {
    const { container } = mount(10_000)

    expect(screen.getByText(fr.wall.announcementImminent('0:10'))).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass(styles['urgent'] ?? 'urgent')
  })

  it('does not warn at eleven seconds', () => {
    const { container } = mount(11_000)

    expect(screen.getByText(fr.wall.announcementIn('0:11'))).toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass(styles['urgent'] ?? 'urgent')
  })

  it('counts against the server clock: a machine three minutes ahead shows the same time', () => {
    mount(102_000, -180_000)

    expect(screen.getByText(fr.wall.announcementIn('1:42'))).toBeInTheDocument()
  })

  it('stops its one-second interval when it goes away', () => {
    const { unmount } = mount(272_000)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('enters with the short fade, unless the browser asks for no motion', () => {
    const { container, unmount } = mount(272_000)
    expect(container.firstElementChild).toHaveClass(styles['enters'] ?? 'enters')
    unmount()

    reducedMotion()
    const reduced = mount(272_000)

    expect(reduced.container.firstElementChild).not.toHaveClass(styles['enters'] ?? 'enters')
    expect(screen.getByText(fr.wall.announcementIn('4:32'))).toBeInTheDocument()
  })
})
