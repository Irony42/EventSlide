import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { messageForCode } from '../../lib/i18n/translations'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * French, and unconditionally so: the admin console is not translated (see
 * `web/src/lib/i18n/translations.ts` for the argument), so this resolves the server's
 * stable code against the French table rather than against whatever language a guest
 * picked on another surface. Duplicated rather than shared with `features/auth`: a
 * feature folder never imports from another feature, and three lines of glue is a
 * smaller price than a shared module nobody owns.
 */
export const errorMessage = (cause: unknown): string =>
  cause instanceof ApiError ? messageForCode(cause.code, fr) : fr.errors.unknown
