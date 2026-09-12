import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * `ApiError` already carries the French message chosen from the server's stable code,
 * so this only has to decide what to say about something that is not one — a bug in
 * the client, most likely, which the host can do nothing about beyond retrying.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof ApiError ? cause.message : fr.errors.unknown
