import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'

export interface RevokeOtherSessionsInput {
  /** From the session, never from the request body: this signs *that* account out. */
  readonly userId: UserId
}

export interface RevokeOtherSessionsDeps {
  readonly users: UserRepository
  readonly clock: Clock
}

export type RevokeOtherSessions = (
  input: RevokeOtherSessionsInput,
) => Promise<Result<void, DomainError>>

/**
 * "Sign out everywhere" (G2-08 / P3-09): every session of this account issued before now
 * stops being valid, on every device — the lost laptop, the shared office machine, the
 * cookie someone else may hold.
 *
 * It raises the account's credentials epoch and nothing else. There is no list of sessions
 * to walk, because the store has no `user_id` to walk it by; `enforceSessionAge` refuses
 * each stale session on its next request, and a cookie that is never used again simply
 * ages out of the store.
 *
 * **The caller's own session dies with the rest.** That is the honest meaning of the epoch,
 * and the route's job is to put a fresh one in its place (new `issuedAt`, new CSRF token) so
 * the person who pressed the button is not signed out by it. This use case cannot know which
 * session is "current" — it has none — and a rule that depended on it would be a rule
 * somebody could forget to pass.
 */
export const makeRevokeOtherSessions =
  ({ users, clock }: RevokeOtherSessionsDeps): RevokeOtherSessions =>
  async ({ userId }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))

    await users.save(user.revokeSessionsBefore(clock.now()))
    return ok(undefined)
  }
