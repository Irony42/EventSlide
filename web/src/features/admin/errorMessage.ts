import { ApiError } from '../../lib/http'
import { messageForCode } from '../../lib/i18n/translations'
import type { UiText } from '../../lib/i18n/translations'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * In the language the host is reading, which is why the table arrives as a parameter:
 * this is not a component and cannot call `useTranslations`, so whichever hook or screen
 * caught the failure hands it the active table. Duplicated rather than shared with
 * `features/auth`: a feature folder never imports from another feature, and three lines
 * of glue is a smaller price than a shared module nobody owns.
 */
export const errorMessage = (cause: unknown, text: UiText): string =>
  cause instanceof ApiError ? messageForCode(cause.code, text) : text.errors.unknown
