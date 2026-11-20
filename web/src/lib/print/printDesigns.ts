/**
 * The looks a printed card can wear (spec 28): fifteen designs over one set of host texts.
 *
 * Pure and DOM-free. A design is a drawing in `cqw` on an A6 portrait card; A6, A5 and A4 share
 * the ratio 1 : √2, so the same drawing grows with the paper and only the QR's size in millimetres
 * changes. Each design declares the share of the card's width its QR takes ({@link qrShareOf}):
 * the stylesheet sizes the code from that very number (`--qr-share`), and `printKit` judges the
 * printed module from it, so the two cannot drift apart.
 */

export const PRINT_DESIGNS = [
  'essentiel',
  'classique',
  'ticket',
  'bd',
  'magazine',
  'souvenir',
  'postale',
  'billet',
  'embarquement',
  'jetable',
  'affiche',
  'confettis',
  'seventies',
  'nuit',
  'guirlande',
] as const

export type PrintDesign = (typeof PRINT_DESIGNS)[number]

/** The card that was the only one before spec 28, improved: a host who chooses nothing gets it. */
export const DEFAULT_PRINT_DESIGN: PrintDesign = 'essentiel'

export const isPrintDesign = (value: unknown): value is PrintDesign =>
  typeof value === 'string' && (PRINT_DESIGNS as readonly string[]).includes(value)

/** How much ink a design lays down: the host is told before printing a whole sheet of black. */
export type InkLoad = 'low' | 'medium' | 'high'

interface DesignSpec {
  /** Side of the QR, quiet zone included, as a share of the card's width. */
  readonly qrShare: number
  readonly ink: InkLoad
}

/**
 * Every share keeps the code at 40 mm or more on the A6 card (0.39 x 105 mm = 41 mm), the size
 * the single card had before spec 28.
 */
const SPECS: Readonly<Record<PrintDesign, DesignSpec>> = {
  essentiel: { qrShare: 0.48, ink: 'low' },
  classique: { qrShare: 0.4, ink: 'low' },
  ticket: { qrShare: 0.4, ink: 'low' },
  bd: { qrShare: 0.43, ink: 'medium' },
  magazine: { qrShare: 0.41, ink: 'high' },
  souvenir: { qrShare: 0.45, ink: 'high' },
  postale: { qrShare: 0.41, ink: 'medium' },
  billet: { qrShare: 0.39, ink: 'medium' },
  embarquement: { qrShare: 0.4, ink: 'low' },
  jetable: { qrShare: 0.43, ink: 'medium' },
  affiche: { qrShare: 0.44, ink: 'high' },
  confettis: { qrShare: 0.42, ink: 'low' },
  seventies: { qrShare: 0.4, ink: 'medium' },
  nuit: { qrShare: 0.42, ink: 'high' },
  guirlande: { qrShare: 0.41, ink: 'low' },
}

export const qrShareOf = (design: PrintDesign): number => SPECS[design].qrShare
export const inkLoadOf = (design: PrintDesign): InkLoad => SPECS[design].ink

/**
 * What stands in for the photograph when the host gave none: the two initials of a couple
 * ("Camille & Sacha" gives "C & S"), else the first number of the title ("Les 40 ans de Léa"
 * gives "40"), else the initials of its first two words that are not little words.
 */
export const monogramOf = (title: string): string => {
  const words = title
    .split(/[\s&,·]+/)
    .filter((word) => /\p{L}/u.test(word) && !LITTLE_WORDS.has(word.toLowerCase()))
  if (/&|\set\s|\sand\s/i.test(title) && words.length >= 2) {
    return `${initialOf(words[0])} & ${initialOf(words[1])}`
  }
  const number = /[0-9]+/.exec(title)
  if (number !== null) return number[0]
  const letters = words.slice(0, 2).map(initialOf).join('')
  return letters === '' ? '★' : letters
}

const LITTLE_WORDS = new Set(['et', 'and', 'de', 'des', 'du', 'la', 'le', 'les', 'the', 'of', 'l'])

const initialOf = (word: string | undefined): string =>
  (word ?? '')
    .replace(/[^\p{L}0-9]/gu, '')
    .charAt(0)
    .toUpperCase()

/** The part of a "date · place" line before its first separator: the date, for a stamp. */
export const datePartOf = (line: string): string => line.split('·')[0]?.trim() ?? line

/** Host texts, each capped where the longest design still lays it out. */
export const PRINT_TEXT_LIMITS = {
  title: 60,
  tagline: 70,
  note: 140,
  date: 50,
  table: 18,
} as const

export type PrintTextField = keyof typeof PRINT_TEXT_LIMITS
