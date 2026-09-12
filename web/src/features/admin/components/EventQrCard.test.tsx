import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import { EventQrCard } from './EventQrCard'
import { fr } from '../../../lib/i18n/fr'

/**
 * The card a host prints and puts on the tables.
 *
 * The 1.0 defect this whole component exists to prevent: the QR page emitted
 * `?partyname=` while the upload page read `?party`, so every guest silently uploaded
 * to the default event. The link is a path now, built by the server, and what is
 * asserted below is that the printed square encodes *that* and nothing else.
 */

const JOIN_URL = 'https://photos.example/join/H7K2QM'

const renderCard = (joinUrl = JOIN_URL) =>
  render(<EventQrCard eventName="Camille & Sacha" joinCode="H7K2QM" joinUrl={joinUrl} />)

/**
 * The module matrix, as the single `<path>` qrcode.react draws.
 *
 * Two strings never produce the same one, so comparing this against a reference built
 * from the value the card is *supposed* to carry is what makes "the QR points at the
 * wrong thing" a red test rather than a room of guests uploading to the wrong event.
 */
const matrixOf = (root: HTMLElement): string => {
  // The first path is the quiet-zone background; the modules are the second.
  const paths = root.querySelectorAll('svg path')
  const modules = paths[paths.length - 1]
  if (modules === undefined) throw new Error('no QR code was drawn')
  const drawn = modules.getAttribute('d')
  if (drawn === null || drawn.length < 100) throw new Error('the QR code drew no modules')
  return drawn
}

/** The same encoder, at the card's own error-correction level and quiet zone. */
const expectedMatrixFor = (value: string): string => {
  const reference = render(<QRCodeSVG value={value} level="M" marginSize={0} />)
  const matrix = matrixOf(reference.container)
  reference.unmount()
  return matrix
}

describe('EventQrCard', () => {
  it('encodes the join path the server built, not the code on its own', () => {
    const { container } = renderCard()

    expect(matrixOf(container)).toBe(expectedMatrixFor(JOIN_URL))
  })

  it('encodes a different event’s link differently, so two cards are never confusable', () => {
    // The negative half of the assertion above: without it, an encoder that ignored
    // its input entirely would pass.
    const { container } = renderCard('https://photos.example/join/ZX93PL')

    expect(matrixOf(container)).not.toBe(expectedMatrixFor(JOIN_URL))
  })

  it('names the square for a screen reader instead of reading out its paths', () => {
    renderCard()

    expect(screen.getByRole('img', { name: fr.admin.qrAlt('Camille & Sacha') })).toBeVisible()
  })

  it('prints the code under the square, for a guest who cannot scan', () => {
    // A phone with a dead camera app, or a guest holding a paper card in a dark room.
    renderCard()

    expect(screen.getByText('H7K2QM')).toBeVisible()
    expect(screen.getByText(fr.admin.qrScanPrompt)).toBeVisible()
  })

  it('does nothing when the browser has no print at all', async () => {
    // Some in-app browsers — the ones a QR scanned from a messaging app opens in —
    // ship no `window.print`. A click that threw would take the card down with it.
    const original = window.print
    Object.defineProperty(window, 'print', { configurable: true, value: undefined })
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: fr.admin.printQr }))

    expect(screen.getByText('H7K2QM')).toBeVisible()
    Object.defineProperty(window, 'print', { configurable: true, value: original })
  })

  it('asks the browser to print when it can', async () => {
    const print = vi.fn()
    Object.defineProperty(window, 'print', { configurable: true, value: print })
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: fr.admin.printQr }))

    expect(print).toHaveBeenCalledTimes(1)
  })
})
