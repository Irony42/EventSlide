import { useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLeaveWarning } from './useLeaveWarning'

/**
 * Leaving a page that holds something shown nowhere else: the browser's own prompt for closing
 * the tab, and the page's question for a link inside the app. `useBlocker` is not available on
 * this router, so the second is a click listener, and what it must let through matters as much
 * as what it stops: a warning on every link would be a warning nobody reads.
 */

const MESSAGE = 'Quitter quand même ?'

function Page({
  active,
  links,
  message = MESSAGE,
}: {
  readonly active: boolean
  readonly links?: ReactNode
  readonly message?: string
}) {
  useLeaveWarning(active, message)
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

  it('stops a link inside the app when the host says no, and follows it again when they say yes', async () => {
    render(<Page active links={<a href="/admin">Vos évènements</a>} />)
    // What the router would see: a click that was not prevented.
    const followed = vi.fn((event: MouseEvent) => event.preventDefault())
    document.addEventListener('click', followed)

    confirm.mockReturnValueOnce(false)
    expect(click('Vos évènements')).toBe(false)
    expect(confirm).toHaveBeenCalledWith(MESSAGE)
    expect(followed).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    click('Vos évènements')
    // The spare history entry comes off first, then the very same link is pressed again.
    await waitFor(() => expect(followed).toHaveBeenCalledTimes(1))
    document.removeEventListener('click', followed)
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
            <a href="https://example.org/elsewhere">Ailleurs</a>
            <a href={`${window.location.pathname}#haut`}>Haut</a>
          </>
        }
      />,
    )

    for (const name of ['Mur', 'Album', 'Ailleurs', 'Haut']) expect(click(name)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])(
    'lets a modified click through: it opens a tab or a window and leaves this one alone (%o)',
    (modifier) => {
      render(<Page active links={<a href="/admin">Vos évènements</a>} />)

      expect(fireEvent.click(screen.getByRole('link'), modifier)).toBe(true)
      expect(confirm).not.toHaveBeenCalled()
    },
  )

  it('lets a link through that names another browsing context, whatever it is called', () => {
    render(
      <Page
        active
        links={
          <a href="/admin" target="_top">
            Vos évènements
          </a>
        }
      />,
    )

    expect(click('Vos évènements')).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks for another query on this very page, which is another screen', () => {
    render(<Page active links={<a href={`${window.location.pathname}?autre=1`}>Filtre</a>} />)

    confirm.mockReturnValueOnce(false)
    expect(click('Filtre')).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('asks in the language now on screen', () => {
    const { rerender } = render(<Page active links={<a href="/admin">Vos évènements</a>} />)
    rerender(<Page active message="Leave anyway?" links={<a href="/admin">Vos évènements</a>} />)

    confirm.mockReturnValueOnce(false)
    click('Vos évènements')

    expect(confirm).toHaveBeenCalledWith('Leave anyway?')
  })

  it('stops listening when the page goes', () => {
    const { unmount } = render(<Page active />)
    unmount()

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('useLeaveWarning: the browser’s Back button', () => {
  const here = () => window.location.pathname
  /** The entries of the browser: where the host came from, then the page that shows the secret. */
  const arrive = () => {
    window.history.pushState({}, '', '/avant')
    window.history.pushState({}, '', '/ici')
  }

  it('asks when Back is pressed, and the page stays where it is when the host says no', async () => {
    arrive()
    render(<Page active />)
    confirm.mockReturnValue(false)

    window.history.back()

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(MESSAGE))
    expect(here()).toBe('/ici')

    // Staying does not disarm it.
    window.history.back()
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(here()).toBe('/ici')
  })

  it('goes back to where the host came from when they say yes', async () => {
    arrive()
    render(<Page active />)
    confirm.mockReturnValue(true)

    window.history.back()

    await waitFor(() => expect(here()).toBe('/avant'))
  })

  it('holds nothing while it is not active, and leaves no entry behind once it stops', async () => {
    arrive()
    const { rerender } = render(<Page active />)
    rerender(<Page active={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    window.history.back()

    await waitFor(() => expect(here()).toBe('/avant'))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('keeps holding Back for the second secret when the first is taken, and asks only once', async () => {
    arrive()
    const Two = ({ first }: { readonly first: boolean }) => {
      useLeaveWarning(first, 'premier')
      useLeaveWarning(true, 'second')
      return null
    }
    const { rerender } = render(<Two first />)
    confirm.mockReturnValue(false)

    window.history.back()
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('premier'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(confirm).toHaveBeenCalledTimes(1)

    // The first secret was copied: the second still has to be held.
    rerender(<Two first={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Taking the first one off asked nothing by itself.
    expect(confirm).toHaveBeenCalledTimes(1)
    window.history.back()
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(confirm).toHaveBeenLastCalledWith('second')
    expect(here()).toBe('/ici')
  })

  it('leaves no copy of the page in history when the host leaves by a link', async () => {
    window.history.replaceState(null, '', '/avant')
    window.history.pushState(null, '', '/ici')
    let visits = 0
    const Guarded = () => {
      // The secret is lost with the page: coming back to it, nothing is held any more.
      const [holding] = useState(() => {
        visits += 1
        return visits === 1
      })
      useLeaveWarning(holding, MESSAGE)
      return <Link to="/ailleurs">Vos évènements</Link>
    }
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/ici" element={<Guarded />} />
          <Route path="/ailleurs" element={<p>Arrivé ailleurs</p>} />
          <Route path="*" element={<p>Avant</p>} />
        </Routes>
      </BrowserRouter>,
    )
    confirm.mockReturnValue(true)

    fireEvent.click(screen.getByRole('link', { name: 'Vos évènements' }))
    await screen.findByText('Arrivé ailleurs')
    window.history.back()
    await waitFor(() => expect(here()).toBe('/ici'))
    window.history.back()

    // Two presses from the page that was left: the page, once, then where it came from.
    await waitFor(() => expect(here()).toBe('/avant'))
  })
})
