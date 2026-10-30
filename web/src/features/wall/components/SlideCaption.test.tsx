import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fr } from '../../../lib/i18n/fr'
import { SlideCaption } from './SlideCaption'

/**
 * Guest-supplied text, projected.
 *
 * A caption arrives from a phone with no account behind it and is then shown four
 * metres wide to a room. What it may and may not do on the way to the wall is the whole
 * subject of this file.
 */
describe('SlideCaption', () => {
  it('shows the caption and the author over the photo', () => {
    render(<SlideCaption caption="Les confettis" authorName="Léa" />)

    expect(screen.getByText('Les confettis')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
  })

  it('shows the caption alone when the guest sent no name', () => {
    const { container } = render(<SlideCaption caption="Les confettis" authorName={null} />)

    // An empty author line under the caption is a blank row of chrome across the
    // bottom of a photo, at projector size.
    expect(screen.getByText('Les confettis')).toBeVisible()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('shows the author alone when the guest wrote no caption', () => {
    const { container } = render(<SlideCaption caption={null} authorName="Léa" />)

    expect(screen.getByText('Léa')).toBeVisible()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders no panel at all for an anonymous photo with no caption', () => {
    const { container } = render(<SlideCaption caption={null} authorName={null} />)

    // The photo is the hero. An empty scrim across the bottom of it is chrome for
    // nothing, and it covers a sixth of the picture on a projector.
    expect(container).toBeEmptyDOMElement()
  })

  it('treats text the guest left blank as nothing to show', () => {
    // A phone keyboard sends an empty string where the server stores nothing.
    const { container } = render(<SlideCaption caption="" authorName="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('puts a caption on the screen as text, never as markup', () => {
    const { container } = render(<SlideCaption caption="<b>Vive les mariés</b>" authorName="Léa" />)

    // The caption is the one string on the wall a stranger controls. It reaches the
    // projector as the characters the guest typed, not as elements.
    expect(screen.getByText('<b>Vive les mariés</b>')).toBeVisible()
    expect(container.querySelector('b')).toBeNull()
  })

  describe('the first photo of a guest', () => {
    it('says whose first photo it is, above the caption', () => {
      const { container } = render(
        <SlideCaption caption="Les confettis" authorName="Julie" firstFromGuest />,
      )

      const lines = [...container.querySelectorAll('p')].map((line) => line.textContent)
      expect(lines).toEqual([fr.wall.firstPhotoOf('Julie'), 'Les confettis', 'Julie'])
    })

    it('says it on a photo with no caption too, which is the common case', () => {
      render(<SlideCaption caption={null} authorName="Julie" firstFromGuest />)

      expect(screen.getByText(fr.wall.firstPhotoOf('Julie'))).toBeVisible()
    })

    it('says nothing without it', () => {
      render(<SlideCaption caption="Les confettis" authorName="Julie" />)

      expect(screen.queryByText(fr.wall.firstPhotoOf('Julie'))).toBeNull()
    })

    it('says nothing for a sender nobody can name', () => {
      const { container } = render(
        <SlideCaption caption="Les confettis" authorName={null} firstFromGuest />,
      )

      expect(container.querySelectorAll('p')).toHaveLength(1)
    })

    it('puts the guest’s name in as typed', () => {
      render(<SlideCaption caption={null} authorName="Zoé <b>M.</b>" firstFromGuest />)

      expect(screen.getByText(fr.wall.firstPhotoOf('Zoé <b>M.</b>'))).toBeVisible()
    })
  })
})
