import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { fr } from '../lib/i18n/fr'
import { renderWithProviders } from '../testing/renderWithProviders'
import { LeaveGuard } from './LeaveGuard'

/**
 * The guard behind "this page holds something you cannot get again" (H8, H10), on its own: which
 * clicks it stops, which it leaves to the browser, and what its two answers do.
 */

const TITLE = 'Quitter ?'

/** Shows what the page a link opened was handed. */
function Arrival() {
  return <p data-testid="arrival">{JSON.stringify(useLocation().state)}</p>
}

const renderGuard = (when: boolean) => {
  // The router here is in memory; the guard compares with the address the browser is at.
  window.history.pushState({}, '', '/ici')
  return renderWithProviders(
    <Routes>
      <Route
        path="/ici"
        element={
          <>
            <LeaveGuard
              when={when}
              title={TITLE}
              description="Ce qui est perdu."
              stayLabel="Rester"
              leaveLabel="Partir"
            />
            <Link to="/ailleurs">dans l’appli</Link>
            <a href="/ici">cette page</a>
            <a href="/ici#bas">plus bas</a>
            <Link to="/avec-etat" state={{ from: '/ici' }} replace>
              avec état
            </Link>
            <a href="https://autre.example/page">autre site</a>
            <a href="/ailleurs" target="_blank" rel="noreferrer">
              autre onglet
            </a>
            <a href="/ailleurs" download>
              télécharger
            </a>
          </>
        }
      />
      <Route path="/ailleurs" element={<p>Arrivé ailleurs</p>} />
      <Route path="/avec-etat" element={<Arrival />} />
    </Routes>,
    { route: '/ici' },
  )
}

describe('LeaveGuard', () => {
  it('stops a link inside the app and asks, naming what is lost', async () => {
    renderGuard(true)

    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))

    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible()
    expect(screen.queryByText('Arrivé ailleurs')).toBeNull()
  })

  it('follows the link it stopped when the person leaves anyway', async () => {
    renderGuard(true)
    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Partir' }))

    expect(await screen.findByText('Arrivé ailleurs')).toBeVisible()
  })

  it('keeps the person where they are when they stay, and the safe answer has the keyboard', async () => {
    renderGuard(true)
    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))

    const stay = await screen.findByRole('button', { name: 'Rester' })
    expect(stay).toHaveFocus()
    await userEvent.click(stay)

    expect(screen.queryByText('Arrivé ailleurs')).toBeNull()
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
  })

  it('asks nothing while there is nothing to lose', async () => {
    renderGuard(false)

    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))

    expect(await screen.findByText('Arrivé ailleurs')).toBeVisible()
  })

  it.each([
    ['a link to the page that is already open', 'cette page'],
    ['a link to another site, which the browser asks about itself', 'autre site'],
    ['a link that opens another tab', 'autre onglet'],
    ['a download', 'télécharger'],
  ])('does not stop %s', (_name, label) => {
    renderGuard(true)
    const link = screen.getByRole('link', { name: label })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })

    // Dispatched by hand: following a real link is not something jsdom does.
    link.dispatchEvent(click)

    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
    expect(click.defaultPrevented).toBe(false)
  })

  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const)(
    'does not stop a click with %s held, which does not leave this tab',
    (modifier) => {
      renderGuard(true)

      fireEvent.click(screen.getByRole('link', { name: 'dans l’appli' }), { [modifier]: true })

      expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
    },
  )

  it('has the browser ask when the tab is closed, and only while there is something to lose', () => {
    const { unmount } = renderGuard(true)
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(true)

    unmount()
    const closed = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closed)
    expect(closed.defaultPrevented).toBe(false)
  })

  it('speaks the language of the page: the buttons are the ones it was given', async () => {
    renderGuard(true)
    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))

    expect(await screen.findByRole('button', { name: 'Partir' })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.app.confirm })).toBeNull()
  })
})

describe('LeaveGuard: what it leaves alone, and what it hands on', () => {
  it('opens the link the way the link was written, with its state, when the person leaves anyway', async () => {
    renderGuard(true)
    await userEvent.click(screen.getByRole('link', { name: 'avec état' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Partir' }))

    // A bare `navigate(path)` would have dropped the `from` the link carried.
    expect(await screen.findByTestId('arrival')).toHaveTextContent(JSON.stringify({ from: '/ici' }))
  })

  it('does not stop a link to another part of the page that is already open', () => {
    renderGuard(true)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })

    screen.getByRole('link', { name: 'plus bas' }).dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
  })

  it('does not stop a middle click, which opens another tab', () => {
    renderGuard(true)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 })

    screen.getByRole('link', { name: 'dans l’appli' }).dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
  })

  it('stops stopping when the page it guards is gone, or has nothing to lose any more', () => {
    const { unmount } = renderGuard(true)
    const link = screen.getByRole('link', { name: 'dans l’appli' })
    unmount()
    document.body.append(link)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(click)

    // A listener left on the document would freeze every link of the app behind a dialog that
    // is no longer drawn.
    expect(click.defaultPrevented).toBe(false)
    link.remove()
  })
})

describe('LeaveGuard: the browser’s Back button (BUG-07)', () => {
  /** The browser's own entries: where the person came from, then the page that holds the secret. */
  const arriveFrom = (previous: string) => {
    window.history.pushState({}, '', previous)
  }
  const here = () => window.location.pathname

  it('asks when Back is pressed, and the page stays where it is', async () => {
    arriveFrom('/avant')
    renderGuard(true)

    window.history.back()

    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible()
    expect(here()).toBe('/ici')
  })

  it('keeps asking: staying does not disarm the guard', async () => {
    arriveFrom('/avant')
    renderGuard(true)
    window.history.back()
    await userEvent.click(await screen.findByRole('button', { name: 'Rester' }))
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()

    window.history.back()

    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible()
    expect(here()).toBe('/ici')
  })

  it('goes back to where the person came from when they leave anyway', async () => {
    arriveFrom('/avant')
    renderGuard(true)
    window.history.back()

    await userEvent.click(await screen.findByRole('button', { name: 'Partir' }))

    await waitFor(() => expect(here()).toBe('/avant'))
  })

  it('leaves no extra entry behind when the person leaves by a link', async () => {
    arriveFrom('/avant')
    renderGuard(true)
    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Partir' }))
    await screen.findByText('Arrivé ailleurs')

    window.history.back()

    await waitFor(() => expect(here()).toBe('/avant'))
  })

  it('with the real browser router, leaving by a link leaves no copy of the guarded page in history', async () => {
    window.history.replaceState(null, '', '/avant')
    window.history.pushState(null, '', '/ici')
    // The secret is lost with the page: coming back to it, nothing is held any more.
    let visits = 0
    const Guarded = () => {
      const [holding] = useState(() => {
        visits += 1
        return visits === 1
      })
      return (
        <>
          <LeaveGuard
            when={holding}
            title={TITLE}
            description="Ce qui est perdu."
            stayLabel="Rester"
            leaveLabel="Partir"
          />
          <Link to="/ailleurs">dans l’appli</Link>
        </>
      )
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
    await userEvent.click(screen.getByRole('link', { name: 'dans l’appli' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Partir' }))
    await screen.findByText('Arrivé ailleurs')

    window.history.back()
    await waitFor(() => expect(here()).toBe('/ici'))
    window.history.back()

    // Two presses from the page that was left: the guarded page, once, then where it came from.
    await waitFor(() => expect(here()).toBe('/avant'))
  })

  it('does not hold Back while there is nothing to lose', async () => {
    arriveFrom('/avant')
    renderGuard(false)

    window.history.back()

    await waitFor(() => expect(here()).toBe('/avant'))
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
  })

  it('leaves no extra entry behind once there is nothing left to lose', async () => {
    arriveFrom('/avant')
    const { unmount } = renderGuard(true)
    unmount()
    // Letting the guard take its own entry off the stack.
    await new Promise((resolve) => setTimeout(resolve, 50))

    window.history.back()

    await waitFor(() => expect(here()).toBe('/avant'))
  })
})
