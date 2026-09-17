import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { messageForCode } from '../../lib/i18n/translations'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * French, like the rest of the sign-in surface: only a host or an invited moderator ever
 * reaches a login form, and a guest has no account by construction. Anything that is not
 * an `ApiError` is a bug in this client, which the host can do nothing about beyond
 * retrying.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof ApiError ? messageForCode(cause.code, fr) : fr.errors.unknown
