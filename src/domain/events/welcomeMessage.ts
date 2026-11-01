import { DomainError } from '../shared/errors'
import { toParagraphs } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * The few words a host shows guests when they join ("Bienvenue ! Une photo du gâteau...").
 *
 * **Content, not interface**: written in the guests' language, stored as typed (after
 * cleaning), never translated. It is a plain `string | null` in the settings, already
 * normalised: `EventSettings.build` is what calls these functions, so no handler ever
 * assembles a rule.
 *
 * No markup, no Markdown, no link, no variable: React escapes on render, and a variable
 * would put guest data inside a host's text.
 */

export const WELCOME_MAX_CHARS = 280
export const WELCOME_MAX_LINES = 4

/**
 * What a stored message may reach before the read path gives up on it. Wider than the
 * rule on purpose: a rule tightened later must not make a live event's message vanish.
 */
const RESTORE_MAX_CHARS = 2_000

const codePoints = (text: string): number => [...text].length

/**
 * A host's choice, judged. Empty after cleaning is `null` ("no message"), never an error:
 * a host who clears the field wants no message.
 */
export const normalizeWelcomeMessage = (raw: unknown): Result<string | null, DomainError> => {
  if (raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid('eventSettings.welcomeInvalid'))

  const cleaned = toParagraphs(raw)
  if (cleaned.length === 0) return ok(null)
  if (cleaned.split('\n').length > WELCOME_MAX_LINES) {
    return err(
      DomainError.invalid('eventSettings.welcomeTooManyLines', { maxLines: WELCOME_MAX_LINES }),
    )
  }
  if (codePoints(cleaned) > WELCOME_MAX_CHARS) {
    return err(DomainError.invalid('eventSettings.welcomeTooLong', { max: WELCOME_MAX_CHARS }))
  }
  return ok(cleaned)
}

/**
 * A stored message read back, judged on shape only and never failing: a cosmetic field
 * must not be able to fail `findById` and take the wall and the join page with it.
 */
export const restoreWelcomeMessage = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const cleaned = toParagraphs(raw)
  if (cleaned.length === 0) return null
  return codePoints(cleaned) > RESTORE_MAX_CHARS ? null : cleaned
}
