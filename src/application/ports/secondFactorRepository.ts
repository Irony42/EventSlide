import type { UserId } from '../../domain/shared/ids'

/**
 * An account's TOTP enrolment, as stored (roadmap §10.1, G2-13 / P3-15).
 *
 * The secret is **sealed** — encrypted under `MFA_ENCRYPTION_KEY` — and this port never
 * sees it in the clear: the use case seals before it writes and opens after it reads, so an
 * adapter, a backup archive and a database dump hold nothing an authenticator could be
 * cloned from without the key.
 */
export interface SecondFactorRecord {
  readonly userId: UserId
  /** `iv.tag.ciphertext`, base64url, as the vault wrote it. */
  readonly sealedSecret: string
  /** Which key sealed it. Stored beside the secret so a rotation can tell old rows from new. */
  readonly keyVersion: number
  /** `null` while the enrolment is pending: the secret was shown but no code was proven yet. */
  readonly confirmedAt: Date | null
  /** The TOTP step of the last accepted code. `null` until a code has been accepted. */
  readonly lastUsedStep: number | null
}

/**
 * The storage of a second factor and its recovery codes.
 *
 * **Every transition is one conditional statement** in the SQLite adapter and one
 * synchronous method in the fake, for the reason `AccountTokenRepository` gives: two requests
 * carrying one code resolve one after the other, and the second finds it spent. That is what
 * the replay refusal and the single-use recovery code rest on, and why neither is a read
 * followed by a write.
 *
 * Recovery codes are stored as digests (`SecretTokens.digestOf`), never as codes, and can
 * exist only for an account with a factor: removing the factor removes them.
 */
export interface SecondFactorRepository {
  find(userId: UserId): Promise<SecondFactorRecord | null>

  /**
   * Starts an enrolment, or restarts one that was never confirmed, with a fresh secret.
   *
   * `false` — and nothing changed — when the account already has a **confirmed** factor:
   * replacing one is removing it first (`remove`), which is a step-up-gated act of its own,
   * never a side effect of starting an enrolment.
   */
  beginEnrolment(
    userId: UserId,
    sealedSecret: string,
    keyVersion: number,
    at: Date,
  ): Promise<boolean>

  /**
   * Confirms the pending enrolment, records `step` as spent, and installs the recovery
   * digests — all or nothing.
   *
   * `sealedSecret` is **the secret the code was checked against**, and the enrolment is
   * confirmed only if that is still the pending one: a code proves one secret, and if a second
   * enrolment replaced it between the read and this call, confirming would make the account
   * hold a factor nobody has proven. A compare-and-set, in one statement.
   *
   * `false` when there is no pending enrolment (none, already confirmed, or replaced). The step
   * is spent here and not by a separate `useStep` call, so a code that confirms an enrolment
   * cannot be replayed to sign in a moment later.
   */
  confirmEnrolment(
    userId: UserId,
    sealedSecret: string,
    step: number,
    at: Date,
    recoveryDigests: readonly string[],
  ): Promise<boolean>

  /**
   * Spends a TOTP step: `true` only if the account has a confirmed factor and `step` is
   * **strictly later** than the last one spent. Concurrent calls with one step: one `true`.
   */
  useStep(userId: UserId, step: number): Promise<boolean>

  /**
   * Replaces every recovery digest, used or not, with these. `false` when the account has no
   * confirmed factor.
   */
  replaceRecoveryCodes(userId: UserId, digests: readonly string[]): Promise<boolean>

  /** The digests that can still be spent. Order is not meaningful. */
  unusedRecoveryDigests(userId: UserId): Promise<readonly string[]>

  /**
   * Spends one recovery code: `true` only if `digest` is one of this account's and unused.
   * Concurrent calls with one digest: one `true`.
   */
  useRecoveryCode(userId: UserId, digest: string, at: Date): Promise<boolean>

  /** Removes the factor and its recovery codes. Removing nothing is not an error. */
  remove(userId: UserId): Promise<void>
}
