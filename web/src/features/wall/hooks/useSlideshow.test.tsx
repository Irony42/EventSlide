import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallItemDto } from '../../../lib/api/dto'
import { useSlideshow } from './useSlideshow'

/**
 * The slideshow, exercised through what a room would see.
 *
 * The probe renders the caption of the photo on screen, so every assertion below is
 * about the picture the projector is showing rather than about the hook's internals.
 */

const aPhoto = (id: string, caption: string): WallItemDto => ({
  id,
  displayUrl: `/api/events/mariage/photos/${id}/display`,
  thumbUrl: `/api/events/mariage/photos/${id}/thumb`,
  width: 2560,
  height: 1707,
  caption,
  authorName: 'Léa',
  createdAt: '2026-06-20T21:04:11.031Z',
})

const INTERVAL_MS = 8_000

interface ProbeProps {
  readonly items: readonly WallItemDto[]
  readonly intervalMs?: number
}

function Probe({ items, intervalMs = INTERVAL_MS }: ProbeProps) {
  const { current, next, paused, advance, pause, resume } = useSlideshow({ items, intervalMs })

  return (
    <div>
      <p>à l’écran {current?.caption ?? 'rien'}</p>
      <p>ensuite {next?.caption ?? 'rien'}</p>
      <p>{paused ? 'en pause' : 'en cours'}</p>
      <button onClick={() => advance(1)}>suivante</button>
      <button onClick={() => advance(-1)}>précédente</button>
      <button onClick={pause}>pause</button>
      <button onClick={resume}>reprendre</button>
    </div>
  )
}

const renderProbe = (props: ProbeProps, route = '/e/mariage/display') => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  )
  return render(<Probe {...props} />, { wrapper })
}

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

/**
 * jsdom's `document.hidden` is a prototype getter with no setter, so a test that needs
 * a hidden tab has to stand one in. Same category as the `EventSource` and `<dialog>`
 * shims in `web/src/testing/` — a browser API, never application code.
 */
let tabHidden = false

describe('useSlideshow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    tabHidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => tabHidden })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'hidden')
  })

  it('moves to the next photo when the server’s interval has elapsed', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()

    tick(INTERVAL_MS)

    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
  })

  it('wraps back to the first photo at the end of the playlist', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    tick(INTERVAL_MS)
    tick(INTERVAL_MS)

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
  })

  it('keeps the same photo on screen when the playlist grows', () => {
    // The 1.0 defect: the position was an index, so a photo published mid-slide pushed
    // the list along under it and the room saw the picture jump.
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const { rerender } = renderProbe({ items: [confettis, gateau] })

    tick(INTERVAL_MS)
    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()

    // A newer photo arrives at the head of the playlist, as the wall read returns it.
    rerender(<Probe items={[aPhoto('c', 'La première danse'), confettis, gateau]} />)

    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
  })

  it('falls back to the newest photo when the one on screen is taken down', () => {
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const { rerender } = renderProbe({ items: [confettis, gateau] })

    tick(INTERVAL_MS)
    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()

    // The host hid it: it must leave the screen at once, not stay because the cursor
    // still names it.
    rerender(<Probe items={[confettis]} />)

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
  })

  it('stops advancing while the tab is hidden, and resumes when it is shown again', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    tabHidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByText('en pause')).toBeInTheDocument()

    // A projector whose tab is minimised for ten minutes must not come back showing a
    // photo from the middle of the evening.
    tick(INTERVAL_MS * 5)
    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()

    tabHidden = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    tick(INTERVAL_MS)

    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
  })

  it('honours the e2e interval override so a projector journey need not wait', () => {
    renderProbe(
      { items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] },
      '/e/mariage/display?e2e_interval=250',
    )

    tick(250)

    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
  })

  it('leaves no timer behind when the wall is unmounted', () => {
    const { unmount } = renderProbe({
      items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')],
    })

    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    // Eight hours at eight seconds a slide is 3600 slides. One leaked timer per slide
    // is what ends an evening with a frozen projector.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not schedule anything for a single photo', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis')] })

    expect(vi.getTimerCount()).toBe(0)
    expect(screen.getByText(/ensuite Les confettis/)).toBeInTheDocument()
  })
})
