import type { RsvpFormInput } from '../api/client/invite'

/**
 * The host's questions and menus as data (spec 30, lot 2, no React): how a typed list becomes the
 * list the server takes. **The server judges every value** (2 to 6 menus, 3 questions, the lengths);
 * this only reads lines and keeps the ids of the questions already saved.
 */

export const QUESTIONS_MAX = 3
export const MOMENTS_MAX = 4

/** A question as the panel holds it: `id` is `''` until the server has given it one. */
export interface QuestionDraft {
  readonly id: string
  readonly label: string
  readonly kind: 'text' | 'choice'
  readonly options?: readonly string[]
}

/** A moment as the panel holds it: `id` is `''` until the server has given it one. */
export interface MomentDraft {
  readonly id: string
  readonly label: string
}

/** The list the server takes: an existing moment keeps its id, a new one has none. */
export const momentsInput = (
  moments: readonly MomentDraft[],
): NonNullable<NonNullable<RsvpFormInput['form']>['moments']> =>
  moments.map((moment) => ({
    ...(moment.id === '' ? {} : { id: moment.id }),
    label: moment.label,
  }))

/** The non-empty lines of a text, each trimmed: "one per line". */
export const linesOf = (raw: string): readonly string[] =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** The list the server takes: an existing question keeps its id, a new one has none and gets it there. */
export const questionsInput = (
  questions: readonly QuestionDraft[],
): NonNullable<NonNullable<RsvpFormInput['form']>['questions']> =>
  questions.map((question) => ({
    ...(question.id === '' ? {} : { id: question.id }),
    label: question.label,
    kind: question.kind,
    ...(question.kind === 'choice' ? { options: question.options ?? [] } : {}),
  }))
