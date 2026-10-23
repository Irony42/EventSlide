import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { InvitationTarget } from '../../../domain/users/accountToken'
import { AccountName } from '../../../domain/users/accountName'
import { Password, passwordContextFor } from '../../../domain/users/password'
import { User } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { InvitationAcceptance } from '../../ports/invitationAcceptance'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { UserRepository } from '../../ports/userRepository'
import {
  invitationNotFound,
  makeResolveInvitation,
  type InvitationPlace,
  type ResolveInvitationDeps,
} from './previewInvitation'

/**
 * How the holder of a link accepts it: by choosing a password for an address that has no
 * account, or by being signed in as the account that uses the address. Nothing else — in
 * particular, never by *saying* which account they are.
 */
export type AcceptInvitationInput = { readonly token: string } & (
  | {
      /** The address has no account yet: this is the person it is for, choosing how they sign in. */
      readonly credentials: { readonly password: string; readonly displayName: string }
      readonly signedInUserId?: never
    }
  | {
      readonly credentials?: never
      /**
       * From the **session**, never from the request. An id a client could send would let
       * anyone attach any account to any invitation they hold.
       */
      readonly signedInUserId: UserId
    }
)

export interface AcceptedInvitation {
  readonly userId: UserId
  /** What was granted, and where it is: the page lands the person there. */
  readonly target: InvitationTarget
  readonly place: InvitationPlace
}

export interface AcceptInvitationDeps extends ResolveInvitationDeps {
  readonly users: Pick<UserRepository, 'findById' | 'findByEmail'>
  readonly hasher: PasswordHasher
  readonly acceptance: InvitationAcceptance
  readonly ids: Pick<IdGenerator, 'userId'>
  readonly clock: Clock
}

export type AcceptInvitation = (
  input: AcceptInvitationInput,
) => Promise<Result<AcceptedInvitation, DomainError>>

/**
 * Accepts an invitation (docs/ROADMAP.md §10.3; free plan G2-09, paid plan P3-10): **the
 * moment an account first exists, or first gains a place, and never before.**
 *
 * ## The rules, in the order they are applied
 *
 * 1. **The link is found and checked** (`makeResolveInvitation`): unspent, unrevoked,
 *    unexpired, an invitation, its event or client still there, and for an event its inviter
 *    still an owner. Anything else is `404 invitation.notFound`, the same answer.
 * 2. **Who is accepting.**
 *    - *With a password.* The address the link was **written to** — read from the link and
 *      never from the request — must have no account. If it has one the answer is
 *      `409 invitation.signInRequired` and **nothing is spent**: the person signs in and
 *      accepts as that account. An account is never created on top of one, and an existing
 *      one is never attached by someone who only knows a link. (A disabled account is
 *      answered like an unknown link: there is nothing for it to sign in to.)
 *    - *Signed in.* The account must be enabled and use the address the link was written to.
 *      Another account is `403 invitation.wrongAccount`: a link is for one mailbox, and
 *      holding it does not make any signed-in stranger that mailbox's owner.
 * 3. **The password is judged before the link is spent** (and its name before that). A
 *    password that is too short costs the person nothing — the form says so and the same
 *    link still works — and the hash, which takes ~200 ms, is computed outside the
 *    transaction that holds the database's one writer.
 * 4. **One transaction does the rest** (`InvitationAcceptance`): spends the link, creates the
 *    account, grants the role and stamps the mailbox. Of any number of simultaneous
 *    acceptances of one link exactly one wins; the others are `404 invitation.notFound`. An
 *    address that became taken in the meantime is `409 invitation.signInRequired`, with the
 *    link still alive.
 *
 * ## What an account made here is
 *
 * - **Its address is the link's**, never the request's.
 * - **Its password is the person's own**: `mustChangePassword` is `false`. This is what
 *   replaces a password read out loud, which is why that flag need not be set.
 * - **Its authority on the box is none.** `siteRole` is written out as `none` and never
 *   derived from whoever invited: an invitation that carried its inviter's authority across
 *   would hand the box to a moderator (roadmap §10.1).
 * - **Verified only if the link came by mail.** `emailVerifiedAt` is the instant of acceptance
 *   when the token's `delivery` is `mail`, because only then did the link travel through the
 *   mailbox. A link the inviter was handed proves nothing: the inviter could have accepted it.
 *
 * ## What accepting never does to an existing account
 *
 * Its password, name and authority on the box are not touched, and a role it already holds in
 * that place is not lowered (an owner who is invited to moderate stays an owner). A link
 * spent by it is spent either way.
 */
export const makeAcceptInvitation = (deps: AcceptInvitationDeps): AcceptInvitation => {
  const { users, hasher, acceptance, ids, clock } = deps
  const resolve = makeResolveInvitation(deps)

  return async (input) => {
    const now = clock.now()

    const resolved = await resolve(input.token, now)
    if (!resolved.ok) return resolved
    const { record, target, place } = resolved.value

    // Mail proves the mailbox; a link the inviter held proves nothing about it.
    const emailVerifiedAt = record.delivery === 'mail' ? now : null

    if ('signedInUserId' in input) {
      const account = await users.findById(input.signedInUserId)
      if (account === null || !account.canSignIn()) return err(invitationNotFound())
      if (!account.email.equals(record.email)) {
        return err(DomainError.forbidden('invitation.wrongAccount'))
      }

      const outcome = await acceptance.accept({
        tokenId: record.id,
        now,
        account: { kind: 'existing', userId: account.id, emailVerifiedAt },
        grant: target,
      })
      if (outcome !== 'accepted') return err(invitationNotFound())
      return ok({ userId: account.id, target, place })
    }

    const existing = await users.findByEmail(record.email)
    if (existing !== null) {
      return err(
        existing.canSignIn()
          ? DomainError.conflict('invitation.signInRequired')
          : invitationNotFound(),
      )
    }

    const name = AccountName.create(input.credentials.displayName)
    if (!name.ok) return name

    const password = Password.create(
      input.credentials.password,
      passwordContextFor(record.email, name.value.value),
    )
    if (!password.ok) return password

    const created = User.create(
      {
        email: record.email,
        displayName: name.value.value,
        passwordHash: await hasher.hash(password.value),
        // The person chose this password just now; there is nothing to force them to change.
        mustChangePassword: false,
        // Never the inviter's, never derived: written out and asserted by name.
        siteRole: 'none',
        emailVerifiedAt,
      },
      ids.userId(),
      now,
    )
    if (!created.ok) return created

    const outcome = await acceptance.accept({
      tokenId: record.id,
      now,
      account: { kind: 'new', user: created.value },
      grant: target,
    })
    if (outcome === 'emailTaken') return err(DomainError.conflict('invitation.signInRequired'))
    if (outcome !== 'accepted') return err(invitationNotFound())
    return ok({ userId: created.value.id, target, place })
  }
}
