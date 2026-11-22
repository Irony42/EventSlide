import type { GuestRsvp, RsvpAnswer, RsvpSource } from './rsvp'

/**
 * The replies as a spreadsheet (spec 30, section 4.5), for the host and the caterer.
 *
 * - separator `;` (what a French spreadsheet opens), a UTF-8 byte-order mark, lines ended `\r\n`,
 *   quotes doubled;
 * - **formulas are neutralised**: a text cell starting with `=`, `+`, `-`, `@`, a tab or a
 *   carriage return gets a leading apostrophe, headers included (a question's label is the host's
 *   own text). Numeric columns are written as numbers and are not touched, or a negative count
 *   would be turned into text.
 *
 * The file is written in the host's language: the labels come in, the domain translates nothing.
 */
export type RsvpCsvView = 'all' | 'caterer'

export interface RsvpCsvLabels {
  readonly name: string
  readonly answer: string
  readonly adults: string
  readonly kids: string
  readonly diet: string
  readonly message: string
  readonly source: string
  readonly updatedAt: string
  readonly answers: Readonly<Record<RsvpAnswer, string>>
  readonly sources: Readonly<Record<RsvpSource, string>>
}

const BOM = String.fromCharCode(0xfeff)
const FORMULA_START = /^[=+\-@\t\r]/

type Cell = string | number | null

/** One cell, written. Numbers are bare; text is guarded, then quoted when it must be. */
const writeCell = (cell: Cell): string => {
  if (cell === null) return ''
  if (typeof cell === 'number') return String(cell)
  const guarded = FORMULA_START.test(cell) ? `'${cell}` : cell
  return /[;"\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

const line = (cells: readonly Cell[]): string => `${cells.map(writeCell).join(';')}\r\n`

export const rsvpCsv = (
  rsvps: readonly GuestRsvp[],
  view: RsvpCsvView,
  labels: RsvpCsvLabels,
): string => {
  if (view === 'caterer') {
    const rows = rsvps
      .filter((rsvp) => rsvp.answer === 'yes')
      .map((rsvp) => line([rsvp.name, rsvp.adults, rsvp.kids, rsvp.diet]))
    return BOM + line([labels.name, labels.adults, labels.kids, labels.diet]) + rows.join('')
  }
  const rows = rsvps.map((rsvp) =>
    line([
      rsvp.name,
      labels.answers[rsvp.answer],
      rsvp.adults,
      rsvp.kids,
      rsvp.diet,
      rsvp.message,
      labels.sources[rsvp.source],
      rsvp.updatedAt.toISOString(),
    ]),
  )
  return (
    BOM +
    line([
      labels.name,
      labels.answer,
      labels.adults,
      labels.kids,
      labels.diet,
      labels.message,
      labels.source,
      labels.updatedAt,
    ]) +
    rows.join('')
  )
}
