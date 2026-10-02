import { mailFailure, type Mailer } from '../../application/ports/mailer'
import { err } from '../../domain/shared/result'

/**
 * The mailer for a box with no SMTP relay: it sends nothing, and says so.
 *
 * A Null Object rather than a `null` in the container, for the reason
 * `nullVideoTranscoder` is one — "there is no mail server here" becomes one answer with one
 * code, decided where everything else is, instead of a branch at every call site. And it is
 * the **default**: a self-hosted install that never set `SMTP_URL` is not misconfigured, it
 * is working as designed, so nothing here logs, warns or fails the boot.
 *
 * Its answer is `mail.notConfigured`, and what a caller does with it is the product: it
 * shows the invitation or reset link on screen for the operator to copy into whatever
 * channel they already use with their client (roadmap §10.3). The caller can ask
 * `canDeliver` first and skip the attempt, and a use case that asks anyway gets the same
 * answer — which is why the message is not even validated: nothing about it matters when
 * it is going nowhere.
 */
export const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}
