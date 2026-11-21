import { describe, expect, it } from 'vitest'
import { PrintCard, type PrintCardInvitation } from './PrintCard'
import { renderWithProviders } from '../../../testing/renderWithProviders'

const INVITATION: PrintCardInvitation = {
  eyebrow: 'Invitation',
  day: 'samedi 11 décembre 2027',
  hours: '19 h – 2 h',
  venue: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  message: 'Apéro à 19 h.',
  more: null,
  link: 'photos.example.test/i/ABC',
}

const card = (design: 'essentiel' | 'ticket') =>
  renderWithProviders(
    <PrintCard
      design={design}
      qr={<svg role="img" aria-label="QR" />}
      focusX={50}
      focusY={50}
      texts={{ title: 'Léa', tagline: null, note: null, date: null, table: null }}
      steps={false}
      photoUrl={null}
      joinCode=""
      address={null}
      invitation={INVITATION}
    />,
  )

describe('PrintCard, as an invitation', () => {
  it('wears the Essentiel card, stylesheet included, for a design with no invitation layout yet', () => {
    const { container } = card('ticket')

    const article = container.querySelector('article')
    expect(article).toHaveAttribute('data-print-card', 'essentiel')
    expect(article?.className).toMatch(/essentiel/)
    expect(article?.className).not.toMatch(/ticket/)
  })

  it('keeps its own design when it has an invitation layout', () => {
    const { container } = card('essentiel')

    expect(container.querySelector('article')).toHaveAttribute('data-print-card', 'essentiel')
  })

  it('prints every line the invitation carries', () => {
    const { container } = card('essentiel')

    for (const line of [
      'Invitation',
      '19 h – 2 h',
      'La Guinguette du Port',
      '44000 Nantes',
      'Apéro à 19 h.',
      'photos.example.test/i/ABC',
    ]) {
      expect(container).toHaveTextContent(line)
    }
  })
})
