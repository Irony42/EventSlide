import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
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
  })
})
