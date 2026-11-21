import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
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
      // An HTML picture, or an SVG one (the garland draws its own): both are the host's photograph.
      expect(
        container.querySelector('img[src^="data:image/jpeg"], image[href^="data:image/jpeg"]'),
        design,
      ).not.toBeNull()
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
  describe('the garland’s photograph', () => {
    const original = globalThis.Image

    /** An `Image` that knows its size as soon as it is given an address, as a browser's does a moment later. */
    const imagesOfSize = (width: number, height: number) => {
      class SizedImage {
        naturalWidth = width
        naturalHeight = height
        onload: (() => void) | null = null
        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      }
      globalThis.Image = SizedImage as unknown as typeof Image
    }

    afterEach(() => {
      globalThis.Image = original
    })

    const garland = (focusX: number, focusY: number) =>
      renderWithProviders(
        <PrintCard
          design="guirlande"
          qr={<svg role="img" aria-label="QR" />}
          focusX={focusX}
          focusY={focusY}
          texts={{ title: 'Léa', tagline: null, note: null, date: null, table: null }}
          steps={false}
          photoUrl="data:image/jpeg;base64,AAAA"
          joinCode=""
          address={null}
          invitation={INVITATION}
        />,
      )

    /** The photograph's box, and the frame it is clipped to, in the banner's units. */
    const boxes = (container: HTMLElement) => {
      const photo = container.querySelector('svg image') as SVGElement
      const clipId = /url\(#([^)]+)\)/.exec(photo.getAttribute('clip-path') ?? '')?.[1] ?? ''
      const frame = container.querySelector(`clipPath[id="${clipId}"] rect`) as SVGElement
      const number = (element: Element, name: string) => Number(element.getAttribute(name))
      return {
        photo: {
          x: number(photo, 'x'),
          y: number(photo, 'y'),
          width: number(photo, 'width'),
          height: number(photo, 'height'),
        },
        frame: {
          x: number(frame, 'x'),
          y: number(frame, 'y'),
          width: number(frame, 'width'),
          height: number(frame, 'height'),
        },
      }
    }

    it('is an SVG image under a rounded clip, over the tint, with no foreignObject', () => {
      const { container } = garland(50, 50)

      expect(container.querySelector('foreignObject')).toBeNull()
      expect(container.querySelector('svg image[href^="data:image/jpeg"]')).not.toBeNull()
      expect(container.querySelector('clipPath rect')).toHaveAttribute('rx', '1')
      expect(container.querySelector('svg rect[class*="glPhotoBack"]')).not.toBeNull()
    })

    it('keeps a landscape photograph where the host put it, exactly: 20 % stays 20 %', async () => {
      imagesOfSize(400, 200)
      const { container } = garland(20, 80)

      await waitFor(() =>
        expect(boxes(container).photo.width).toBeCloseTo(boxes(container).frame.width * 2),
      )
      const { photo, frame } = boxes(container)
      expect(photo.height).toBeCloseTo(frame.height)
      expect(photo.x).toBeCloseTo(frame.x - 0.2 * frame.width, 1)
      expect(photo.y).toBeCloseTo(frame.y, 1)
    })

    it('keeps a portrait photograph where the host put it, exactly: 80 % stays 80 %', async () => {
      imagesOfSize(200, 400)
      const { container } = garland(20, 80)

      await waitFor(() =>
        expect(boxes(container).photo.height).toBeCloseTo(boxes(container).frame.height * 2),
      )
      const { photo, frame } = boxes(container)
      expect(photo.width).toBeCloseTo(frame.width)
      expect(photo.x).toBeCloseTo(frame.x, 1)
      expect(photo.y).toBeCloseTo(frame.y - 0.8 * frame.height, 1)
    })

    it('moves with the framing between two values of one bucket', async () => {
      imagesOfSize(400, 200)
      const near = garland(34, 50)
      await waitFor(() =>
        expect(boxes(near.container).photo.width).toBeGreaterThan(
          boxes(near.container).frame.width * 1.5,
        ),
      )
      const far = garland(66, 50)
      await waitFor(() =>
        expect(boxes(far.container).photo.width).toBeGreaterThan(
          boxes(far.container).frame.width * 1.5,
        ),
      )

      expect(boxes(near.container).photo.x).toBeGreaterThan(boxes(far.container).photo.x)
    })

    it('is drawn at its frame, clipped, until the browser has told its size', () => {
      const { container } = garland(20, 80)

      const { photo, frame } = boxes(container)
      expect(photo).toEqual(frame)
    })
  })
})
