import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLeaveWarning } from './useLeaveWarning'

/**
 * Leaving a page that holds something shown nowhere else: the browser's own prompt for closing
 * the tab, and the page's question for a link inside the app. `useBlocker` is not available on
 * this router, so the second is a click listener, and what it must let through matters as much
 * as what it stops: a warning on every link would be a warning nobody reads.
 */

const MESSAGE = 'Quitter quand même ?'

function Page({ active, links }: { readonly active: boolean; readonly links?: ReactNode }) {
  useLeaveWarning(active, MESSAGE)
  return <nav>{links}</nav>
}

// Made per test: the config restores every spy between tests, and a spy made once would be gone.
let confirm: MockInstance<typeof window.confirm>

beforeEach(() => {
  confirm = vi.spyOn(window, 'confirm')
})

const click = (name: string): boolean => fireEvent.click(screen.getByRole('link', { name }))

describe('useLeaveWarning', () => {
  it('asks the browser to confirm closing the page, only while active', () => {
    const { rerender } = render(<Page active />)
    const asked = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(asked)
    expect(asked.defaultPrevented).toBe(true)

    rerender(<Page active={false} />)
    const notAsked = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(notAsked)
    expect(notAsked.defaultPrevented).toBe(false)
  })

  it('stops a link inside the app when the host says no, and lets it through when they say yes', () => {
    render(<Page active links={<a href="/admin">Vos évènements</a>} />)

    confirm.mockReturnValueOnce(false)
    expect(click('Vos évènements')).toBe(false)
    expect(confirm).toHaveBeenCalledWith(MESSAGE)

    confirm.mockReturnValueOnce(true)
    expect(click('Vos évènements')).toBe(true)
  })

  it('asks nothing when it is not active', () => {
    render(<Page active={false} links={<a href="/admin">Vos évènements</a>} />)

    expect(click('Vos évènements')).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('lets through what cannot lose the page: a new tab, a download, another origin, this very page', () => {
    render(
      <Page
        active
        links={
          <>
            <a href="/e/mariage/display" target="_blank">
              Mur
            </a>
            <a href="/api/events/mariage/album.zip" download>
              Album
            </a>
            <a href="https://example.org/">Ailleurs</a>
            <a href={`${window.location.pathname}#haut`}>Haut</a>
          </>
        }
      />,
    )

    for (const name of ['Mur', 'Album', 'Ailleurs', 'Haut']) expect(click(name)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('lets a modified click through: it opens a tab and leaves this one alone', () => {
    render(<Page active links={<a href="/admin">Vos évènements</a>} />)

    expect(fireEvent.click(screen.getByRole('link'), { ctrlKey: true })).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('stops listening when the page goes', () => {
    const { unmount } = render(<Page active />)
    unmount()

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
