import type { GuestRsvp, RsvpAnswer, RsvpSource } from './rsvp'
import type { GuestHousehold } from './household'
import type { RsvpMoment } from './rsvpForm'
import { narrowMoments } from './rsvpFormMoments'

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
 * - **moments** (lot 4): one column per moment **of the form today**, headed by its label (neutralised
 *   like any header). In the full file the cell is the number 1 when the reply (a yes or a maybe)
 *   comes to it; in the caterer's file it is the people of that yes reply, and the total line adds
 *   them up. A removed moment has no column: its id means nothing any more.
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
  readonly companions: string
  readonly meals: string
  /** The caterer's last line: the sum of what is above it. */
  readonly total: string
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

/** A question as a column: its id (what answers point at) and the label of today. */
export interface RsvpCsvQuestion {
  readonly id: string
  readonly label: string
}

const LIST_SEPARATOR = ', '

/**
 * The columns of the questions: the form's, in its order, then one for every question that was
 * removed but still has answers, in the order they are met. A removed question's header is the label
 * of **the most recently updated reply** that answered it (a host who reworded it before removing it
 * sees the last wording), ties going to the first met. A question removed and added again is a new
 * question, with a column of its own.
 */
const questionColumns = (
  rsvps: readonly GuestRsvp[],
  questions: readonly RsvpCsvQuestion[],
): readonly RsvpCsvQuestion[] => {
  const asked = new Set(questions.map((question) => question.id))
  const orphans = new Map<string, { label: string; at: number }>()
  for (const rsvp of rsvps) {
    for (const { questionId, label } of rsvp.details.answers) {
      if (asked.has(questionId)) continue
      const at = rsvp.updatedAt.getTime()
      const seen = orphans.get(questionId)
      if (seen === undefined || at > seen.at) orphans.set(questionId, { label, at })
    }
  }
  return [...questions, ...[...orphans].map(([id, { label }]) => ({ id, label }))]
}

const answerOf = (rsvp: GuestRsvp, questionId: string): string | null => {
  const value = rsvp.details.answers.find((answer) => answer.questionId === questionId)?.value
  return value === undefined || value === '' ? null : value
}

/** The entries written, the blank ones (a person who gave nothing) left out. */
const listOf = (items: readonly string[]): string | null => {
  const written = items.filter((item) => item !== '')
  return written.length === 0 ? null : written.join(LIST_SEPARATOR)
}

/**
 * The menus of one reply, or of all of them, as a caterer reads them: each menu once, with how many
 * when more than one (\"Poisson ×2, Végé\"), in the order they are first met. Blank entries (a person
 * who chose none) count for nobody.
 */
export const mealsSummary = (meals: readonly string[]): string | null => {
  const counts = new Map<string, number>()
  for (const meal of meals) if (meal !== '') counts.set(meal, (counts.get(meal) ?? 0) + 1)
  if (counts.size === 0) return null
  return [...counts]
    .map(([meal, count]) => (count === 1 ? meal : `${meal} ×${count}`))
    .join(LIST_SEPARATOR)
}

/** What the host's form asks, for the caterer's file: a column the form does not ask is not written. */
export interface RsvpCsvAsked {
  readonly meals: boolean
  readonly diet: boolean
}

/** 1 when the reply comes to the moment, or nothing. */
const comesTo = (rsvp: GuestRsvp, moment: RsvpMoment): Cell =>
  (rsvp.answer === 'yes' || rsvp.answer === 'maybe') && rsvp.details.moments.includes(moment.id)
    ? 1
    : null

export const rsvpCsv = (
  rsvps: readonly GuestRsvp[],
  view: RsvpCsvView,
  labels: RsvpCsvLabels,
  questions: readonly RsvpCsvQuestion[] = [],
  asked: RsvpCsvAsked = { meals: true, diet: true },
  moments: readonly RsvpMoment[] = [],
  households: readonly GuestHousehold[] = [],
): string => {
  // A reply is only written at a moment that exists today and that its household is invited to.
  rsvps = moments.length === 0 ? rsvps : narrowMoments(rsvps, moments, households)
  if (view === 'caterer') {
    const coming = rsvps.filter((rsvp) => rsvp.answer === 'yes')
    // Only the columns the form asks: a menu or a diet the host no longer asks is not told to the
    // caterer, as the panel and the printed list do not tell it.
    const cells = (
      name: Cell,
      adults: Cell,
      kids: Cell,
      meals: Cell,
      diet: Cell,
      atMoments: readonly Cell[],
    ): Cell[] => [
      name,
      adults,
      kids,
      ...atMoments,
      ...(asked.meals ? [meals] : []),
      ...(asked.diet ? [diet] : []),
    ]
    const rows = coming.map((rsvp) =>
      line(
        cells(
          rsvp.name,
          rsvp.adults,
          rsvp.kids,
          mealsSummary(rsvp.details.meals),
          rsvp.diet,
          moments.map((moment) => (comesTo(rsvp, moment) === null ? null : rsvp.people)),
        ),
      ),
    )
    // The last line adds it up, so the caterer reads the order without a formula.
    const total = line(
      cells(
        labels.total,
        coming.reduce((sum, rsvp) => sum + rsvp.adults, 0),
        coming.reduce((sum, rsvp) => sum + rsvp.kids, 0),
        mealsSummary(coming.flatMap((rsvp) => rsvp.details.meals)),
        null,
        moments.map((moment) =>
          coming.reduce((sum, rsvp) => sum + (comesTo(rsvp, moment) === null ? 0 : rsvp.people), 0),
        ),
      ),
    )
    return (
      BOM +
      line(
        cells(
          labels.name,
          labels.adults,
          labels.kids,
          labels.meals,
          labels.diet,
          moments.map((moment) => moment.label),
        ),
      ) +
      rows.join('') +
      (coming.length === 0 ? '' : total)
    )
  }
  const columns = questionColumns(rsvps, questions)
  const rows = rsvps.map((rsvp) =>
    line([
      rsvp.name,
      labels.answers[rsvp.answer],
      rsvp.adults,
      rsvp.kids,
      listOf(rsvp.details.companions),
      listOf(rsvp.details.meals),
      rsvp.diet,
      ...moments.map((moment) => comesTo(rsvp, moment)),
      ...columns.map((column) => answerOf(rsvp, column.id)),
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
      labels.companions,
      labels.meals,
      labels.diet,
      ...moments.map((moment) => moment.label),
      ...columns.map((column) => column.label),
      labels.message,
      labels.source,
      labels.updatedAt,
    ]) +
    rows.join('')
  )
}
