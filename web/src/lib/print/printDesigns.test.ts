import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINT_DESIGN,
  PRINT_DESIGNS,
  datePartOf,
  inkLoadOf,
  isPrintDesign,
  monogramOf,
  qrShareOf,
} from './printDesigns'

describe('the designs of the printed card', () => {
  it('offers fifteen, and opens on the plain one', () => {
    expect(PRINT_DESIGNS).toHaveLength(15)
    expect(new Set(PRINT_DESIGNS).size).toBe(15)
    expect(DEFAULT_PRINT_DESIGN).toBe('essentiel')
  })

  it('keeps every code at 4 cm or more on the A6 card, the size the single card had', () => {
    // An A6 card is 105 mm wide; printKit.qrMmOf multiplies the same two numbers.
    const smallest = Math.min(...PRINT_DESIGNS.map((design) => 105 * qrShareOf(design)))
    expect(smallest).toBeGreaterThanOrEqual(40)
  })

  it('never draws a code wider than half the card, which would crowd out the words', () => {
    for (const design of PRINT_DESIGNS) expect(qrShareOf(design)).toBeLessThanOrEqual(0.5)
  })

  it('names the designs that lay down a full background as heavy on ink', () => {
    const heavy = PRINT_DESIGNS.filter((design) => inkLoadOf(design) === 'high')
    expect(heavy).toEqual(['magazine', 'souvenir', 'affiche', 'nuit'])
  })

  it('reads back only a design it knows', () => {
    expect(isPrintDesign('guirlande')).toBe(true)
    expect(isPrintDesign('arche')).toBe(false)
    expect(isPrintDesign(3)).toBe(false)
  })
})

describe('the stand-in for a missing photograph', () => {
  it('gives a couple their two initials', () => {
    expect(monogramOf('Camille & Sacha')).toBe('C & S')
    expect(monogramOf('Léa et Hugo')).toBe('L & H')
  })

  it('gives a birthday its number', () => {
    expect(monogramOf('Les 40 ans de Léa')).toBe('40')
    expect(monogramOf('Les 50 ans de l’AS Saint-Romain')).toBe('50')
  })

  it('gives anything else the initials of its first two words that are not little words', () => {
    expect(monogramOf('Bivouac du Vercors')).toBe('BV')
    expect(monogramOf('Atelier Lumen')).toBe('AL')
  })

  it('never answers an empty string', () => {
    expect(monogramOf('')).toBe('★')
    expect(monogramOf('!!!')).toBe('★')
  })
})

describe('the date part of a "date · place" line', () => {
  it('keeps what comes before the first separator', () => {
    expect(datePartOf('14 juin 2026 · Domaine des Tilleuls')).toBe('14 juin 2026')
    expect(datePartOf('Samedi soir')).toBe('Samedi soir')
  })
})
