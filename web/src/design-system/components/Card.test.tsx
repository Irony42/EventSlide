import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button'
import { Card } from './Card'

describe('Card', () => {
  it('puts its title in the page outline as a heading', () => {
    render(
      <Card title="Modérateurs">
        <p>Aucun pour l’instant.</p>
      </Card>,
    )

    expect(screen.getByRole('heading', { name: 'Modérateurs' })).toBeVisible()
  })

  it('adds nothing to the outline when it has no title', () => {
    render(
      <Card>
        <p>Aucun pour l’instant.</p>
      </Card>,
    )

    // A plain panel is grouping, not structure: a heading nobody wrote would put an
    // empty level in the outline a screen-reader user has to walk past.
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('Aucun pour l’instant.')).toBeVisible()
  })

  it('takes the level of its title from the page it sits on', () => {
    render(
      <Card as="h1" title="Camille & Sacha">
        <p>En cours</p>
      </Card>,
    )

    // Heading order is a property of the page, not of the component: the moderation
    // console's cards sit under an h1, the dashboard's under an h2.
    expect(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
  })

  it('shows its title and its actions before it has any content', () => {
    render(<Card title="Invités" footer={<Button>Rafraîchir</Button>} />)

    // A panel whose rows are still on their way still has a title to read and an action
    // to press; an empty body would sit between them as a gap for no reason.
    expect(screen.getByRole('heading', { name: 'Invités' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Rafraîchir' })).toBeVisible()
  })
})
