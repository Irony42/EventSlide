import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fr } from '../../../lib/i18n/fr'
import { aWallMission } from '../../../testing/renderWithProviders'
import { WallMissions } from './WallMissions'

/**
 * The room's mission panel.
 *
 * Rendered bare rather than through `renderWithProviders`: the wall is French in every
 * language by decision (`translations.ts`), so this component reads `fr` directly and has
 * no locale to be given.
 */
describe('WallMissions', () => {
  it('renders nothing at all when the host set no prompts', () => {
    // What keeps every wall that does not use this feature exactly the wall it was —
    // committed visual baselines included.
    const { container } = render(<WallMissions missions={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('prints the prompts the host typed, in the order they arrived', () => {
    render(
      <WallMissions
        missions={[
          aWallMission({ id: 'm1', prompt: 'un selfie avec les mariés' }),
          aWallMission({ id: 'm2', prompt: 'la première danse' }),
        ]}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'un selfie avec les mariés',
      'la première danse',
    ])
  })

  it('shows a once-for-the-evening prompt as done, with the word and not only a colour', () => {
    render(
      <WallMissions
        missions={[aWallMission({ scope: 'event', achieved: true, completedByGuests: 1 })]}
      />,
    )

    expect(screen.getByRole('listitem')).toHaveTextContent(fr.wall.missionDone)
  })

  it('shows a per-guest prompt as a count of guests, because a tick would be wrong', () => {
    // Two hundred people can each answer it; "Fait" would say the room was finished with
    // something anybody can still do.
    render(
      <WallMissions
        missions={[aWallMission({ scope: 'guest', achieved: true, completedByGuests: 12 })]}
      />,
    )

    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent(fr.wall.missionGuests(12))
    expect(row).not.toHaveTextContent(fr.wall.missionDone)
  })

  it('says nothing beside a prompt the room has not answered', () => {
    render(<WallMissions missions={[aWallMission({ prompt: 'un selfie', achieved: false })]} />)

    expect(screen.getByRole('listitem')).toHaveTextContent('un selfie')
    expect(screen.getByRole('listitem').textContent).toBe('un selfie')
  })

  it('marks each row with its state, so a journey can measure it rather than photograph it', () => {
    render(
      <WallMissions
        missions={[
          aWallMission({ id: 'm1', prompt: 'faite', achieved: true }),
          aWallMission({ id: 'm2', prompt: 'à faire', achieved: false }),
        ]}
      />,
    )

    expect(
      screen.getAllByRole('listitem').map((row) => row.getAttribute('data-mission-answered')),
    ).toEqual(['true', 'false'])
  })

  it('renders a prompt as text, never as markup', () => {
    // A prompt is host-typed content on a projector in front of two hundred people.
    // React escapes it; this is the guard that says so out loud.
    render(<WallMissions missions={[aWallMission({ prompt: '<b>gras</b>' })]} />)

    expect(screen.getByRole('listitem')).toHaveTextContent('<b>gras</b>')
    expect(screen.getByRole('listitem').querySelector('b')).toBeNull()
  })
})
