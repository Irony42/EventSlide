import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * `ApiError` already carries the French message chosen from the server's stable code,
 * so this only has to decide what to say about something that is not one. Duplicated
 * rather than shared with `features/auth`: a feature folder never imports from another
 * feature, and three lines of glue is a smaller price than a shared module nobody owns.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof ApiError ? cause.message : fr.errors.unknown
