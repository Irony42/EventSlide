import type { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { DeleteAccount } from '../site/deleteAccount'
import type { StepUp } from './stepUp'
import type { SecondFactorProof } from './verifySecondFactor'

export interface DeleteOwnAccountInput {
  /** From the session, never from the request: this erases the caller and nobody else. */
  readonly userId: UserId
  /** The account's current password, asked again because the act is not undone. */
  readonly password: string
  /** Required, and only, when the account has an authenticator: a code or a recovery code. */
  readonly proof?: SecondFactorProof
}

export interface DeleteOwnAccountDeps {
  /** The same confirmation a sensitive operator act asks: password, plus the factor if enrolled. */
  readonly stepUp: StepUp
  /** The same use case the operator's erasure route calls: one set of refusals, one erasure. */
  readonly deleteAccount: DeleteAccount
}

export type DeleteOwnAccount = (input: DeleteOwnAccountInput) => Promise<Result<void, DomainError>>

/**
 * A host or moderator erases their own account (GDPR art. 17).
 *
 * **It is the operator's erasure, asked by the person, behind the confirmation a step-up is**:
 * the password, and a code from the authenticator when the account has one (`stepUp`, so a
 * stolen session with a guessed password is not enough to erase an account that has a factor).
 * A wrong password is `401 auth.invalidCredentials`, a missing or wrong code
 * `401 auth.invalidSecondFactor`, and nothing is touched. Past that, `deleteAccount` keeps every
 * refusal it has (`account.operatorProtected`, `account.holdsEvents`, `account.holdsMedia`,
 * `account.holdsReviews`, `account.lastClientOwner`) and writes the `account.deleted` line as
 * **the account itself** (`member`), whose actor pointer the deletion then sets to null like
 * every line the account ever wrote.
 */
export const makeDeleteOwnAccount =
  ({ stepUp, deleteAccount }: DeleteOwnAccountDeps): DeleteOwnAccount =>
  async ({ userId, password, proof }) => {
    const confirmed = await stepUp({ userId, password, ...(proof === undefined ? {} : { proof }) })
    if (!confirmed.ok) return confirmed

    return deleteAccount({ userId, actor: { kind: 'member', userId } })
  }
