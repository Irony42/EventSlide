import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('states that the screen is working and what happens next', () => {
    render(
      <EmptyState
        title="Rien à valider pour l’instant."
        description="Les nouvelles photos arrivent ici automatiquement."
      />,
    )

    expect(screen.getByRole('heading', { name: 'Rien à valider pour l’instant.' })).toBeVisible()
    expect(
      screen.getByText('Les nouvelles photos arrivent ici automatiquement.'),
    ).toBeInTheDocument()
  })

  it('renders its title at the level the page needs', () => {
    render(<EmptyState as="h1" title="Page introuvable" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible()
  })

  it('defaults to a second-level heading, so it can sit under a page title', () => {
    render(<EmptyState title="Aucune photo en attente" />)

    expect(screen.getByRole('heading', { level: 2 })).toBeVisible()
  })

  it('offers the single next action', async () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Aucune photo sélectionnée pour le moment."
        action={<Button onClick={onClick}>Ajouter des photos</Button>}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter des photos' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps a decorative icon out of the accessibility tree', () => {
    render(<EmptyState title="Aucune photo en attente" icon={<span>glyphe</span>} />)

    expect(screen.getByText('glyphe').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('carries the test id its screen is identified by end to end', () => {
    render(<EmptyState title="En attente des premières photos." data-testid="wall-empty" />)

    expect(screen.getByTestId('wall-empty')).toBeVisible()
  })
})
