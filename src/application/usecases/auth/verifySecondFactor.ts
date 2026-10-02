import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { canonicalRecoveryCode } from '../../../domain/users/recoveryCode'
import { matchTotpStep, parseTotpCode } from '../../../domain/users/totp'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { MfaVault } from '../../ports/mfaVault'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import type { TotpEngine } from '../../ports/totpEngine'
import type { UserRepository } from '../../ports/userRepository'

/** What the person typed: a code from the app, or one of the codes they were shown once. */
export type SecondFactorProof = { readonly code: string } | { readonly recoveryCode: string }

export interface VerifySecondFactorInput {
  /** From the half-finished sign-in or the session, never from a request body. */
  readonly userId: UserId
  readonly proof: SecondFactorProof
  /**
   * When the password this proof follows was verified, for a sign-in: if the account's
   * credentials changed after that instant — a reset, a password change, a switch-off — the
   * half-finished sign-in is void and the answer is `auth.secondFactorExpired`. Absent for a
   * step-up, which verifies the password in the same breath.
   */
  readonly passwordVerifiedAt?: Date
}

export interface VerifySecondFactorDeps {
  readonly users: UserRepository
  readonly factors: SecondFactorRepository
  /** `null` on a box with no key: a recovery code still works, a TOTP code cannot be checked. */
  readonly vault: MfaVault | null
  readonly engine: TotpEngine
  readonly secrets: SecretTokens
  readonly audit: AuditRecorder
  readonly clock: Clock
  readonly logger: Logger
}

export interface VerifiedSecondFactor {
  /** Which of the two the person used. */
  readonly method: 'totp' | 'recoveryCode'
  /** Recovery codes still unspent, for a person down to their last one. */
  readonly recoveryCodesRemaining: number | null
}

export type VerifySecondFactor = (
  input: VerifySecondFactorInput,
) => Promise<Result<VerifiedSecondFactor, DomainError>>

/**
 * The one wrong answer, whatever was wrong: a code that matches no step, one for a step
 * already spent, a recovery code that was never issued or already used, text that is neither.
 * What separates them is something only the owner of the factor may know.
 */
const invalidSecondFactor = (): DomainError =>
  DomainError.unauthenticated('auth.invalidSecondFactor')

/** The sign-in this proof belongs to is over; the person starts again from the password. */
const expired = (): DomainError => DomainError.unauthenticated('auth.secondFactorExpired')

/**
 * Judges a second-factor proof against the account's stored factor (roadmap §10.1, G2-13 /
 * P3-15). Used by the sign-in's second step and by the step-up; neither knows how a code is
 * judged.
 *
 * ## A code from the app (RFC 6238)
 *
 * The secret is opened from the vault, every step within one of now is computed, and the
 * presented code is accepted for the first one it matches **that is later than the last step
 * the account spent**. The step is then spent by one conditional statement
 * (`SecondFactorRepository.useStep`), so two requests carrying one code cannot both pass: the
 * loser gets `auth.invalidSecondFactor`, which is also what a replay gets.
 *
 * ## A recovery code
 *
 * Canonicalised (case, separators and confusables folded), hashed, and compared with every
 * unspent digest of the account in constant time (`SecretTokens.verify`), the comparison made
 * against all of them rather than stopping at a match. The match is then spent by one
 * conditional statement and **only then** is it audited: the spend decides whether there is a
 * use to record, and a line for a claim that lost the race would be false. It works on a box
 * whose key is gone, because a recovery code is stored as a digest, not encrypted — it is the
 * way back in when the key is the thing that was lost.
 */
export const makeVerifySecondFactor =
  ({
    users,
    factors,
    vault,
    engine,
    secrets,
    audit,
    clock,
    logger,
  }: VerifySecondFactorDeps): VerifySecondFactor =>
  async ({ userId, proof, passwordVerifiedAt }) => {
    const user = await users.findById(userId)
    if (user === null || !user.canSignIn()) return err(expired())
    const epoch = user.credentialsChangedAt
    if (
      passwordVerifiedAt !== undefined &&
      epoch !== null &&
      epoch.getTime() > passwordVerifiedAt.getTime()
    ) {
      return err(expired())
    }

    const record = await factors.find(userId)
    if (record === null || record.confirmedAt === null) return err(expired())

    const at = clock.now()

    if ('code' in proof) {
      const presented = parseTotpCode(proof.code)
      if (!presented.ok) return err(invalidSecondFactor())

      if (vault === null) return err(DomainError.unexpected('auth.secondFactorUnavailable'))
      const secret = vault.open(record.sealedSecret, record.keyVersion)
      if (secret === null) {
        // Not the person's mistake: the key changed, or the row was damaged. Said once, in
        // the log, with no secret and no address — and answered as the box being unable to
        // check, so the person reaches for a recovery code instead of retyping.
        logger.error('a stored second factor could not be opened with the configured key')
        return err(DomainError.unexpected('auth.secondFactorUnavailable'))
      }

      const step = matchTotpStep({
        presented: presented.value,
        at,
        lastUsedStep: record.lastUsedStep,
        codeAt: (candidate) => engine.codeAt(secret, candidate),
      })
      if (step === null || !(await factors.useStep(userId, step))) {
        return err(invalidSecondFactor())
      }
      return ok({ method: 'totp', recoveryCodesRemaining: null })
    }

    const canonical = canonicalRecoveryCode(proof.recoveryCode)
    if (canonical === null) return err(invalidSecondFactor())

    const unused = await factors.unusedRecoveryDigests(userId)
    let matched: string | null = null
    for (const digest of unused) {
      // Every digest is compared, whether or not an earlier one matched.
      if (secrets.verify(canonical, digest) && matched === null) matched = digest
    }
    if (matched === null || !(await factors.useRecoveryCode(userId, matched, at))) {
      return err(invalidSecondFactor())
    }

    const remaining = unused.length - 1
    const entry = AuditEntry.create({
      at,
      actor: { kind: user.isOperator() ? 'operator' : 'member', userId },
      action: 'account.recoveryCodeUsed',
      subject: { type: 'account', id: userId },
      clientId: null,
      details: { remaining },
    })
    // The code is already spent, so a line the log refuses cannot be allowed to give it back:
    // the sign-in fails closed and the person uses another.
    if (!entry.ok) return entry
    await audit.record(entry.value)

    return ok({ method: 'recoveryCode', recoveryCodesRemaining: remaining })
  }
