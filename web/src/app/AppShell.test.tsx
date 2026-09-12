import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell, MAIN_CONTENT_ID } from './AppShell'
import { fr } from '../lib/i18n/fr'

describe('AppShell', () => {
  it('puts a skip link first in the tab order, pointing at the main landmark', async () => {
    render(
      <AppShell surface="host">
        <p>Contenu</p>
      </AppShell>,
    )

    await userEvent.tab()

    const skip = screen.getByRole('link', { name: fr.shell.skipToContent })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID)
  })

  it('renders its children inside the main landmark', () => {
    render(
      <AppShell surface="guest">
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByRole('main')).toContainElement(screen.getByText('Contenu'))
  })

  it('renders a header above the main landmark when one is given', () => {
    render(
      <AppShell surface="host" header={<header>Barre</header>}>
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByText('Barre')).toBeVisible()
  })

  it.each([
    ['guest', 'guest'],
    ['host', 'host'],
    ['wall', 'wall'],
  ] as const)('gives the %s surface its own container', (surface, expected) => {
    render(
      <AppShell surface={surface}>
        <p>Contenu</p>
      </AppShell>,
    )

    // The container width is the whole job of this component, and it is per surface:
    // a laptop-comfortable measure is unreadable held at arm's length on a phone.
    expect(screen.getByRole('main').className).toContain(expected)
  })
})
