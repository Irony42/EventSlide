import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import {
  applyMailPreferencesPatch,
  type MailPreferences,
} from '../../../domain/notices/mailPreferences'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Mailer } from '../../ports/mailer'
import type { MailPreferenceRepository } from '../../ports/mailPreferenceRepository'
import type { UserRepository } from '../../ports/userRepository'

/**
 * What an account chose to receive by mail (spec 32, ADR 0019): the two switches of its "E-mails" section,
 * `rsvp` (the guests' replies) and `event` (the life of its events). **Only the account itself** reads and
 * changes them: the user id comes from the session, never from the request, so there is no way to ask
 * for somebody else's.
 *
 * - `available` tells the page whether the switches mean anything on this box: the mailer delivers
 *   **and** `HOST_MAIL_NOTICES` is not `off`. It is the same answer as `features.hostMail` of `/api/about`,
 *   read from the same two facts. The switches can still be set when it is `false` (a box that gets a relay
 *   later keeps what the host chose); the page just does not offer them.
 * - The security mails and the warning before the replies are erased have no switch, so there is
 *   nothing to read or write for them.
 */

export interface MailPreferencesView extends MailPreferences {
  readonly available: boolean
}

export interface GetMailPreferencesDeps {
  readonly users: Pick<UserRepository, 'findById'>
  readonly preferences: Pick<MailPreferenceRepository, 'forUser'>
  readonly mailer: Pick<Mailer, 'canDeliver'>
  /** `HOST_MAIL_NOTICES` is not `off`. */
  readonly hostMailNotices: boolean
}

export type GetMailPreferences = (input: {
  /** From the session. */
  readonly userId: UserId
}) => Promise<Result<MailPreferencesView, DomainError>>

export const makeGetMailPreferences =
  ({ users, preferences, mailer, hostMailNotices }: GetMailPreferencesDeps): GetMailPreferences =>
  async ({ userId }) => {
    // The id came from a session, so a miss means the account was deleted underneath it.
    if ((await users.findById(userId)) === null) return err(DomainError.notFound('user.notFound'))
    const current = await preferences.forUser(userId)
    return ok({ ...current, available: mailer.canDeliver && hostMailNotices })
  }

export interface SetMailPreferencesDeps {
  readonly users: Pick<UserRepository, 'findById'>
  readonly preferences: Pick<MailPreferenceRepository, 'forUser' | 'save'>
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export interface SetMailPreferencesInput {
  /** From the session, never from the request: this changes *that* account's switches. */
  readonly userId: UserId
  readonly rsvp?: boolean | undefined
  readonly event?: boolean | undefined
}

export type SetMailPreferences = (
  input: SetMailPreferencesInput,
) => Promise<Result<void, DomainError>>

/**
 * Changes the switches the request names and leaves the other as it was. A change that changes nothing
 * writes nothing and records nothing; one that does is recorded as `account.mailPreferencesChanged`
 * (the account, no content: not which switch, not the address) **before** it is stored (write-ahead, like
 * the other account acts), so an entry the log refuses stops the change.
 */
export const makeSetMailPreferences =
  ({ users, preferences, audit, clock }: SetMailPreferencesDeps): SetMailPreferences =>
  async ({ userId, rsvp, event }) => {
    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))

    const current = await preferences.forUser(userId)
    const next = applyMailPreferencesPatch(current, { rsvp, event })
    if (next.rsvp === current.rsvp && next.event === current.event) return ok(undefined)

    const entry = AuditEntry.create({
      at: clock.now(),
      actor: { kind: user.isOperator() ? 'operator' : 'member', userId },
      action: 'account.mailPreferencesChanged',
      subject: { type: 'account', id: userId },
      clientId: null,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await preferences.save(userId, next)
    return ok(undefined)
  }
