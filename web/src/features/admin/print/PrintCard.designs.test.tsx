import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { PrintCard } from './PrintCard'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { PRINT_DESIGNS, type PrintDesign } from '../../../lib/print/printDesigns'

/** A tiny photograph the card can draw, as the host's own would arrive from `printPhoto`. */
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const FULL = {
  title: 'Camille & Sacha',
  tagline: 'Partagez vos photos',
  note: 'Merci d’être là',
  date: '14 juin 2026 · Domaine des Tilleuls',
  table: 'Table 4',
}
const EMPTY = { title: 'Camille & Sacha', tagline: null, note: null, date: null, table: null }

const card = (
  design: PrintDesign,
  options: {
    readonly texts?: typeof FULL | typeof EMPTY
    readonly photoUrl?: string | null
    readonly steps?: boolean
    readonly address?: string | null
  } = {},
) =>
  renderWithProviders(
    <PrintCard
      design={design}
      qr={<svg role="img" aria-label="QR" />}
      focusX={30}
      focusY={70}
      texts={options.texts ?? FULL}
      steps={options.steps ?? true}
      photoUrl={options.photoUrl ?? null}
      joinCode="H7K2QM"
      address={options.address ?? 'photos.example.test'}
    />,
  )

describe('every table card design', () => {
  it.each(PRINT_DESIGNS)(
    '%s prints the QR and the event’s title with every text filled in',
    (design) => {
      const { unmount } = card(design, { photoUrl: PHOTO })

      expect(screen.getByRole('img', { name: 'QR' })).toBeInTheDocument()
      // Some designs set the title letter by letter: read the card's text, not one element's.
      expect(document.body.textContent).toContain('Camille')
      unmount()
    },
  )

  it.each(PRINT_DESIGNS)(
    '%s still prints its QR with no photograph, no optional text and no steps',
    (design) => {
      const { unmount } = card(design, {
        texts: EMPTY,
        photoUrl: null,
        steps: false,
        address: null,
      })

      expect(screen.getByRole('img', { name: 'QR' })).toBeInTheDocument()
      expect(screen.queryByText('Table 4')).toBeNull()
      unmount()
    },
  )
})
