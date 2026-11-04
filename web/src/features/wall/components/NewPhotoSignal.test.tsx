import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { fr } from '../../../lib/i18n/fr'
import { arrivalLabel } from '../arrivalLabel'
import { NewPhotoSignal } from './NewPhotoSignal'

const bubble = (photos: number, clips: number) => ({ photos, clips, until: 1 })

describe('arrivalLabel (spec 11, rule 7)', () => {
  it.each([
    [1, 0, 'Nouvelle photo ajoutée'],
    [0, 1, 'Nouvelle vidéo ajoutée'],
    [7, 0, '7 nouvelles photos'],
    [0, 3, '3 nouvelles vidéos'],
    [2, 1, '3 nouveaux souvenirs'],
  ])('says %i photos and %i clips as « %s »', (photos, clips, expected) => {
    expect(arrivalLabel(fr, bubble(photos, clips))).toBe(expected)
  })
})

describe('NewPhotoSignal', () => {
  it('is an empty polite region of its own when nothing is announced', () => {
    const { container } = render(<NewPhotoSignal bubble={null} />)

    expect(container.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement()
  })

  it('speaks the wall’s language, and never a name', () => {
    render(
      <LocaleOverride locale="de">
        <NewPhotoSignal bubble={bubble(1, 0)} />
      </LocaleOverride>,
    )

    expect(screen.getByTestId('new-photo-signal')).toHaveTextContent('Neues Foto hinzugefügt')
  })
})
