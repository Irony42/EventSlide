import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
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
  const {
    current,
    next,
    paused,
    generation,
    advance,
    pause,
    resume,
    // What the slide clock is actually running on, which is what a layout animating
    // across a slide has to time itself from.
    intervalMs: cadenceMs,
  } = useSlideshow({ items, intervalMs })

  return (
    <div>
      <p>à l’écran {current?.caption ?? 'rien'}</p>
      <p>ensuite {next?.caption ?? 'rien'}</p>
      <p>génération {generation}</p>
      <p>cadence {cadenceMs}</p>
      <p>{paused ? 'en pause' : 'en cours'}</p>
      <button onClick={() => advance(1)}>suivante</button>
      <button onClick={() => advance(-1)}>précédente</button>
      <button onClick={pause}>pause</button>
      <button onClick={resume}>reprendre</button>
    </div>
  )
}

const wrapper = (route: string) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  }

const renderProbe = (props: ProbeProps, route = '/e/mariage/display') =>
  render(<Probe {...props} />, { wrapper: wrapper(route) })

const step = (direction: 'suivante' | 'précédente') => {
  fireEvent.click(screen.getByRole('button', { name: direction }))
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

  it('keeps the first photo on screen when the playlist grows before any slide change', () => {
    // The same 1.0 defect, one frame later: a wall that has not changed slide yet has
    // no stored index to be shifted, but it had no anchor either, so the newest photo
    // arriving at the head of the playlist took the screen from whatever the room was
    // looking at. A guest publishing during a speech must not move the wall.
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const { rerender } = renderProbe({ items: [confettis, gateau] })

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()

    rerender(<Probe items={[aPhoto('c', 'La première danse'), confettis, gateau]} />)

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
    // Adopting the photo already on screen is not a slide change, so the two crossfade
    // layers stay where they are rather than dissolving one photo into itself.
    expect(screen.getByText('génération 0')).toBeInTheDocument()
  })

  it('holds the photo it fell back to when the playlist grows again', () => {
    // Falling back to the newest is only half the rule. Without re-anchoring there, the
    // wall is back to naming a photo that is gone — and the next publication moves it.
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const { rerender } = renderProbe({ items: [confettis, gateau] })

    tick(INTERVAL_MS)
    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()

    // The host hides the photo on screen, then a guest publishes a newer one.
    rerender(<Probe items={[confettis]} />)
    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
    rerender(<Probe items={[aPhoto('c', 'La première danse'), confettis]} />)

    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
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

  /**
   * The one number a layout may time an animation from.
   *
   * 1.0 configured the Ken Burns duration beside the slide interval and shipped a 20s
   * zoom against a 10s slide, so every image snapped back mid-slide. The filmstrip's
   * drift is the same shape of animation — it runs for a whole slide — so it reads the
   * interval the slide clock above is genuinely using rather than the one the server
   * proposed, and there is no second setting left to fall out of step with the first.
   */
  it('reports the interval its own clock is running on', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    expect(screen.getByText(/cadence 8000/)).toBeInTheDocument()
  })

  it('reports the e2e override, not the interval the server proposed', () => {
    renderProbe(
      { items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] },
      '/e/mariage/display?e2e_interval=250',
    )

    // A layout timing itself off the server's number would drift apart from the wall
    // under the e2e hooks — which is exactly where nobody would notice.
    expect(screen.getByText(/cadence 250/)).toBeInTheDocument()
  })

  it('reports no cadence at all when nothing is going to advance', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis')] })

    // A one-photo wall is a still frame, not a slideshow running very slowly. An
    // animation given a duration here would finish its travel and freeze mid-move.
    expect(screen.getByText(/cadence 0/)).toBeInTheDocument()
  })

  it('reports no cadence while the wall is paused', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    fireEvent.click(screen.getByRole('button', { name: 'pause' }))

    // The host holds a photo for a speech. This reported the full interval while the
    // slide timer was cleared, so the filmstrip went on drifting to the end of its
    // travel and stayed there for as long as the wall was paused — a tenth of the screen
    // black, in front of the room, during the speech somebody paused the wall for.
    expect(screen.getByText(/cadence 0/)).toBeInTheDocument()
  })

  it('reports the cadence again once the wall is resumed', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))

    fireEvent.click(screen.getByRole('button', { name: 'reprendre' }))

    expect(screen.getByText(/cadence 8000/)).toBeInTheDocument()
  })

  it('reports no cadence while the projector tab is hidden', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] })

    tabHidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Same rule, the other way a wall stops: a minimised projector must not be running
    // an animation nobody is watching, and must not come back part-way through one.
    expect(screen.getByText(/cadence 0/)).toBeInTheDocument()
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

  it('has nothing to show and nothing to schedule for an empty playlist', () => {
    // The first twenty minutes of the party, and the whole of a well-moderated start.
    renderProbe({ items: [] })

    expect(screen.getByText(/à l’écran rien/)).toBeInTheDocument()
    expect(screen.getByText(/ensuite rien/)).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stays where it is when the host steps an empty playlist', () => {
    renderProbe({ items: [] })

    step('suivante')

    // A host pressing the arrow at an empty wall must get nothing, not a cursor
    // pointing at a photo that does not exist.
    expect(screen.getByText(/à l’écran rien/)).toBeInTheDocument()
    expect(screen.getByText('génération 0')).toBeInTheDocument()
  })

  it('keeps the two layers in their slots when there is only one photo', () => {
    renderProbe({ items: [aPhoto('a', 'Les confettis')] })

    step('suivante')
    step('suivante')
    step('suivante')

    // The cursor already names the only photo there is, so every one of those steps is
    // standing still. Counting one as a change would swap the two crossfade layers with
    // nothing to put in the incoming one.
    expect(screen.getByText('génération 0')).toBeInTheDocument()
    expect(screen.getByText(/à l’écran Les confettis/)).toBeInTheDocument()
  })

  it('steps from the photo actually on screen after the one it held was taken down', () => {
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const danse = aPhoto('c', 'La première danse')
    const { rerender } = renderProbe({ items: [confettis, gateau, danse] })

    tick(INTERVAL_MS)
    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
    rerender(<Probe items={[confettis, danse]} />)

    step('suivante')

    // The cursor still names the photo the host hid. The arrow has to move relative to
    // what the room is looking at, which is the photo the fallback put there.
    expect(screen.getByText(/à l’écran La première danse/)).toBeInTheDocument()
  })

  it('keeps playing when the playlist shrinks under it while it runs', () => {
    const confettis = aPhoto('a', 'Les confettis')
    const gateau = aPhoto('b', 'Le gâteau')
    const danse = aPhoto('c', 'La première danse')
    const { rerender } = renderProbe({ items: [confettis, gateau, danse] })

    tick(INTERVAL_MS)
    tick(INTERVAL_MS)
    expect(screen.getByText(/à l’écran La première danse/)).toBeInTheDocument()
    rerender(<Probe items={[confettis, gateau]} />)

    tick(INTERVAL_MS)

    // A host refusing photos during the speeches is normal. The wall shortens its loop
    // and carries on, rather than stopping on the last photo it knew about.
    expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
  })

  it('starts a second wall without moving the one already playing', () => {
    // 1.0 kept the index in `sessionStorage`, so a host who opened the wall on a second
    // screen dragged the projector's slideshow back with them.
    const items = [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')]
    renderProbe({ items })
    tick(INTERVAL_MS)

    render(<Probe items={items} />, { wrapper: wrapper('/e/mariage/display') })

    const onScreen = screen.getAllByText(/à l’écran/).map((line) => line.textContent)
    expect(onScreen).toEqual(['à l’écran Le gâteau', 'à l’écran Les confettis'])
  })

  it('puts two walls on the same photo for the same playlist and the same elapsed time', () => {
    const items = [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')]
    render(
      <div>
        <Probe items={items} />
        <Probe items={items} />
      </div>,
      { wrapper: wrapper('/e/mariage/display') },
    )

    tick(INTERVAL_MS)

    // The position is derived from the playlist, so two projectors at one venue agree
    // without sharing anything at all.
    expect(screen.getAllByText(/à l’écran Le gâteau/)).toHaveLength(2)
  })

  it.each(['abc', '-250', '12,5'])(
    'ignores an interval override of "%s" rather than reconfiguring the room’s screen',
    (override) => {
      renderProbe(
        { items: [aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')] },
        `/e/mariage/display?e2e_interval=${encodeURIComponent(override)}`,
      )

      tick(INTERVAL_MS)

      // A typo in a query string must not silently take the wall off the interval the
      // host configured — nor stop it, which a clamp to zero would do.
      expect(screen.getByText(/à l’écran Le gâteau/)).toBeInTheDocument()
    },
  )

  it('assumes the tab is visible when there is no document to ask', () => {
    tabHidden = true

    const html = renderToString(
      <MemoryRouter initialEntries={['/e/mariage/display']}>
        <Probe items={[aPhoto('a', 'Les confettis'), aPhoto('b', 'Le gâteau')]} />
      </MemoryRouter>,
    )

    // A render with no browser behind it has no visibility to read, and reporting the
    // wall as paused would put the "en pause" notice into the first frame the room sees.
    expect(html).toContain('en cours')
  })
})
