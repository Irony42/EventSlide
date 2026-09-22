import { ApiError } from '../../lib/http'
import { messageForCode, type UiText } from '../../lib/i18n/translations'

/**
 * A thrown value turned into a sentence a host can read.
 *
 * In the reader's own language, like the rest of the sign-in surface: a moderator is
 * invited by e-mail address and handed a temporary password, and nothing about that
 * implies they read French. The table arrives as an argument because this is a plain
 * function — the component or hook calling it is the one holding the context. Anything
 * that is not an `ApiError` is a bug in this client, which the host can do nothing about
 * beyond retrying.
 */
export const errorMessage = (cause: unknown, text: UiText): string =>
  cause instanceof ApiError ? messageForCode(cause.code, text) : text.errors.unknown
