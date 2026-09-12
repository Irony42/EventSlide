import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * `prefers-reduced-motion` is a health requirement, not a preference.
 *
 * Ken Burns on a four-metre projection and a full-screen crossfade can both trigger
 * vestibular symptoms, and the person affected is sitting in a dark room with no way to
 * look away. So the wall reads the query in JavaScript and declines to declare the
 * animation at all, rather than shortening it in CSS.
 */

/**
 * A `MediaQueryList` a test can change its mind with.
 *
 * jsdom ships no `matchMedia`, and the stub in `web/src/testing/setup.ts` answers
 * `false` and never fires. This one is the same category of shim — a browser API,
 * never application code — with a `matches` a test can flip and an event it can send.
 */
class FakeMediaQueryList extends EventTarget {
  matches = false

  constructor(readonly media: string) {
    super()
  }
}

const lists = new Map<string, FakeMediaQueryList>()

/** One list per query, so a snapshot read after a change sees the change. */
const listFor = (query: string): FakeMediaQueryList => {
  const known = lists.get(query)
  if (known !== undefined) return known
  const created = new FakeMediaQueryList(query)
  lists.set(query, created)
  return created
}

const REDUCE = '(prefers-reduced-motion: reduce)'

function Probe() {
  return <p>{usePrefersReducedMotion() ? 'immobile' : 'animé'}</p>
}

describe('usePrefersReducedMotion', () => {
  beforeEach(() => {
    lists.clear()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      // A hand-written stub cannot satisfy a whole DOM interface, which is the one place
      // the web app allows a structural cast.
      (query: string) => listFor(query) as unknown as MediaQueryList,
    )
  })

  it('reports the preference the browser already holds at first paint', () => {
    listFor(REDUCE).matches = true

    render(<Probe />)

    // Read during render rather than in an effect: a first frame of animation, later
    // corrected, is the frame that does the harm.
    expect(screen.getByText('immobile')).toBeInTheDocument()
  })

  it('follows a change to the preference without a reload', () => {
    render(<Probe />)
    expect(screen.getByText('animé')).toBeInTheDocument()

    act(() => {
      listFor(REDUCE).matches = true
      listFor(REDUCE).dispatchEvent(new Event('change'))
    })

    // The projector page is opened once and left for eight hours. Someone who turns the
    // setting on partway through the evening cannot be told to reload the wall.
    expect(screen.getByText('immobile')).toBeInTheDocument()
  })

  it('goes back to allowing motion when the preference is turned off again', () => {
    listFor(REDUCE).matches = true
    render(<Probe />)

    act(() => {
      listFor(REDUCE).matches = false
      listFor(REDUCE).dispatchEvent(new Event('change'))
    })

    expect(screen.getByText('animé')).toBeInTheDocument()
  })

  it('assumes motion is allowed when there is no media query to ask', () => {
    // A render with no browser behind it — no `matchMedia` to consult — reports the
    // documented default instead of throwing, which is what the third snapshot argument
    // of `useSyncExternalStore` exists for.
    expect(renderToString(<Probe />)).toContain('animé')
  })
})
