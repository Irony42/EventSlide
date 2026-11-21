import { describe, expect, it } from 'vitest'
import { PrintCard, type PrintCardInvitation } from './PrintCard'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import {
  INVITATION_DESIGNS,
  invitationQrShareOf,
  invitationUsesPhoto,
  qrShareOf,
  type PrintDesign,
} from '../../../lib/print/printDesigns'

const INVITATION: PrintCardInvitation = {
  eyebrow: 'Invitation',
  day: 'samedi 11 décembre 2027',
  dayShort: '11/12/2027',
  hours: '19 h – 2 h',
  venue: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  message: 'Apéro à 19 h.',
  more: 'La suite est sur la page.',
  link: 'photos.example.test/i/ABC',
}

const card = (
  design: PrintDesign,
  invitation: PrintCardInvitation = INVITATION,
  photoUrl: string | null = null,
) =>
  renderWithProviders(
    <PrintCard
      design={design}
      qr={<svg role="img" aria-label="QR" />}
      focusX={50}
      focusY={50}
      texts={{ title: 'Léa', tagline: null, note: null, date: null, table: null }}
      steps={false}
      photoUrl={photoUrl}
      joinCode=""
      address={null}
      invitation={invitation}
    />,
  )

describe('PrintCard, as an invitation', () => {
  it.each(INVITATION_DESIGNS)('%s prints every line the invitation carries', (design) => {
    const { container } = card(design)

    // The day is said long or as numbers depending on the room the design has, never both missing.
    expect(container.textContent).toMatch(/samedi 11 décembre 2027|11\/12\/2027/)
    for (const line of [
      'Léa',
      '19 h',
      'La Guinguette du Port',
      '12 quai de la Loire',
      '44000 Nantes',
      'Apéro à 19 h.',
      'La suite est sur la page.',
      'photos.example.test/i/ABC',
    ]) {
      expect(container).toHaveTextContent(line)
    }
    expect(container.querySelectorAll('[aria-label="QR"]')).toHaveLength(1)
  })

  it.each(INVITATION_DESIGNS)('%s keeps its own design and prints no join code', (design) => {
    const { container } = card(design)

    expect(container.querySelector('article')).toHaveAttribute('data-print-card', design)
    expect(container).not.toHaveTextContent('ABC123')
  })

  it.each(INVITATION_DESIGNS)(
    '%s leaves out a place, an address and a word the host did not give',
    (design) => {
      const { container } = card(design, {
        ...INVITATION,
        venue: null,
        address: null,
        message: null,
        more: null,
      })

      expect(container).not.toHaveTextContent('Guinguette')
      expect(container).not.toHaveTextContent('quai de la Loire')
      expect(container).not.toHaveTextContent('Apéro')
      expect(container).not.toHaveTextContent('La suite est')
    },
  )

  it('shows no line about the rest being on the page when the word is whole, but keeps one in reserve for a clipped word', () => {
    for (const design of INVITATION_DESIGNS) {
      const { container, unmount } = card(design, { ...INVITATION, more: null })
      // Whatever is shown on the card: the line held back for a clipped word is hidden by the
      // stylesheet until the fit clips the word, and is the only place that line is.
      const lines = [...container.querySelectorAll('p')].filter((p) =>
        /détails sur la page/i.test(p.textContent ?? ''),
      )
      expect(lines.length, design).toBeLessThanOrEqual(1)
      for (const line of lines) expect(line, design).toHaveAttribute('data-more-when-clamped')
      unmount()
    }
  })

  it('draws the host’s photograph in the designs that carry one', () => {
    for (const design of INVITATION_DESIGNS.filter(invitationUsesPhoto)) {
      const { container, unmount } = card(design, INVITATION, 'data:image/jpeg;base64,AAAA')
      expect(container.querySelector('img[src^="data:image/jpeg"]'), design).not.toBeNull()
      unmount()
    }
  })

  it('wears the Essentiel card, stylesheet included, for a design with no invitation layout', () => {
    const { container } = card('bd')

    const article = container.querySelector('article')
    expect(article).toHaveAttribute('data-print-card', 'essentiel')
    expect(article?.className).toMatch(/essentiel/)
    expect(article?.className).not.toMatch(/\bbd\b/)
  })

  it('draws the QR of the invitation at its own share of the card', () => {
    const { container } = card('guirlande')

    const share = (container.querySelector('article') as HTMLElement).style.getPropertyValue(
      '--qr-share',
    )
    expect(Number(share)).toBe(invitationQrShareOf('guirlande'))
    expect(invitationQrShareOf('guirlande')).toBeLessThan(qrShareOf('guirlande'))
    // A design with no override of its own draws the table card's share.
    expect(invitationQrShareOf('billet')).toBe(qrShareOf('billet'))
  })
})
