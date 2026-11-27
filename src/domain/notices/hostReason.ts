import { DomainError } from '../shared/errors'
import { toParagraphs } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/** The longest "reason for the host" an operator may write (spec 32, A4): a few sentences, not an essay. */
export const HOST_REASON_MAX = 500

/**
 * The operator's **reason for the host** that rides an operator act's e-mail (spec 32, A4): a field of its own, distinct from the
 * audit reason (which the host never reads). Typed text, so it is folded to lines (`toParagraphs`: no control character, no
 * blank line), bounded **after** that fold, and may be left out (`null`).
 *
 * `400 takedown.hostReasonInvalid` beyond {@link HOST_REASON_MAX} characters.
 */
export const parseHostReason = (raw: string | undefined): Result<string | null, DomainError> => {
  if (raw === undefined) return ok(null)
  const text = toParagraphs(raw)
  if (text.length === 0) return ok(null)
  if ([...text].length > HOST_REASON_MAX)
    return err(DomainError.invalid('takedown.hostReasonInvalid'))
  return ok(text)
}
