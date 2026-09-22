import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { aWallMission } from '../../../testing/renderWithProviders'
import { WallMissions } from './WallMissions'

/**
 * The room's mission panel.
 *
 * Rendered bare for the cases about layout and state: outside a provider the locale
 * context answers with the French table, which is the default `localeContext` declares,
 * so these read exactly as they always did. The two cases at the bottom put it inside a
 * `LocaleOverride`, because the panel is the clearest place in the product where a
 * translated frame sits directly on top of untranslated content.
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

  it('translates its own heading', () => {
    render(
      <LocaleOverride locale="de">
        <WallMissions missions={[aWallMission({ prompt: 'un selfie avec les mariés' })]} />
      </LocaleOverride>,
    )

    expect(screen.getByRole('heading', { name: de.wall.missionsTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.wall.missionsTitle })).toBeNull()
  })

  it('leaves the host’s prompt exactly as the host typed it', () => {
    // The other half of the same panel, and the more important one. A German wall over a
    // French wedding prints a German heading above French prompts, and that is right: the
    // heading is the product speaking and the prompt is the host speaking. A translation
    // pass that routed a prompt through a table would be a real defect and would look,
    // in review, like somebody being thorough.
    render(
      <LocaleOverride locale="de">
        <WallMissions
          missions={[
            aWallMission({ id: 'm1', prompt: 'un selfie avec les mariés' }),
            aWallMission({
              id: 'm2',
              prompt: 'la première danse',
              scope: 'guest',
              achieved: true,
              completedByGuests: 12,
            }),
          ]}
        />
      </LocaleOverride>,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]?.textContent).toBe('un selfie avec les mariés')
    // The count beside it is the product's sentence and is German; the prompt beside the
    // count is the host's and is not.
    expect(rows[1]).toHaveTextContent('la première danse')
    expect(rows[1]).toHaveTextContent(de.wall.missionGuests(12))
  })
})
