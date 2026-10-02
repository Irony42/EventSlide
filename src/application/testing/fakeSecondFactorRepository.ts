import type { UserId } from '../../domain/shared/ids'
import type { SecondFactorRecord, SecondFactorRepository } from '../ports/secondFactorRepository'

/**
 * In-memory `SecondFactorRepository`.
 *
 * What has to behave is what the SQLite adapter's constraints and conditional statements do:
 * a pending enrolment is replaceable and a confirmed one is not, a step is spent only if it is
 * strictly later than the last, a recovery code is spent only if it is the account's and
 * unused, and the sealed secret and the digests have the shapes the `CHECK`s insist on. Every
 * method runs to completion before another starts, so two concurrent `useStep` calls resolve
 * one after the other and the second sees the step spent — exactly as the database makes them.
 *
 * The foreign key on `user_id` is mirrored by {@link FakeSecondFactorRepository.withAccounts}:
 * a fake that accepted a factor for an account that does not exist would pass tests the real
 * table would fail. A repository built without it knows no account and refuses every
 * enrolment.
 */

interface Row {
  userId: UserId
  sealedSecret: string
  keyVersion: number
  createdAt: Date
  confirmedAt: Date | null
  lastUsedStep: number | null
  /** digest → when it was spent, or `null` while it can still be. */
  codes: Map<string, Date | null>
}

/** Exactly two dots, and nothing outside the base64url alphabet: the table's `CHECK`. */
const isSealedShape = (text: string): boolean =>
  /^[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/.test(text)

const isDigestShape = (text: string): boolean => /^[0-9a-f]{64}$/.test(text)

export class FakeSecondFactorRepository implements SecondFactorRepository {
  private readonly rows = new Map<UserId, Row>()
  private readonly accounts = new Set<UserId>()

  /** The accounts that exist, for the foreign key on `user_id`. */
  withAccounts(...ids: readonly UserId[]): this {
    for (const id of ids) this.accounts.add(id)
    return this
  }

  /** Whether an account has any row at all. For a test to look at. */
  has(userId: UserId): boolean {
    return this.rows.has(userId)
  }

  /** The digests held for an account, spent or not. For a test to look at. */
  digestsOf(userId: UserId): readonly string[] {
    return [...(this.rows.get(userId)?.codes.keys() ?? [])]
  }

  async find(userId: UserId): Promise<SecondFactorRecord | null> {
    const row = this.rows.get(userId)
    return row === undefined
      ? null
      : {
          userId: row.userId,
          sealedSecret: row.sealedSecret,
          keyVersion: row.keyVersion,
          confirmedAt: row.confirmedAt,
          lastUsedStep: row.lastUsedStep,
        }
  }

  async beginEnrolment(
    userId: UserId,
    sealedSecret: string,
    keyVersion: number,
    at: Date,
  ): Promise<boolean> {
    if (!this.accounts.has(userId)) throw new Error('FOREIGN KEY constraint failed')
    if (!isSealedShape(sealedSecret) || (sealedSecret.match(/\./g) ?? []).length !== 2) {
      throw new Error('CHECK constraint failed: user_totp.secret_enc')
    }
    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      throw new Error('CHECK constraint failed: user_totp.key_version')
    }

    const existing = this.rows.get(userId)
    if (existing !== undefined && existing.confirmedAt !== null) return false

    this.rows.set(userId, {
      userId,
      sealedSecret,
      keyVersion,
      createdAt: new Date(at.getTime()),
      confirmedAt: null,
      lastUsedStep: null,
      codes: new Map(),
    })
    return true
  }

  async confirmEnrolment(
    userId: UserId,
    sealedSecret: string,
    step: number,
    at: Date,
    recoveryDigests: readonly string[],
  ): Promise<boolean> {
    const row = this.rows.get(userId)
    if (row === undefined || row.confirmedAt !== null || row.sealedSecret !== sealedSecret) {
      return false
    }
    this.assertDigests(recoveryDigests)

    row.confirmedAt = new Date(at.getTime())
    row.lastUsedStep = step
    row.codes = new Map(recoveryDigests.map((digest) => [digest, null]))
    return true
  }

  async useStep(userId: UserId, step: number): Promise<boolean> {
    const row = this.rows.get(userId)
    if (row === undefined || row.confirmedAt === null) return false
    if (row.lastUsedStep !== null && row.lastUsedStep >= step) return false
    row.lastUsedStep = step
    return true
  }

  async replaceRecoveryCodes(userId: UserId, digests: readonly string[]): Promise<boolean> {
    const row = this.rows.get(userId)
    if (row === undefined || row.confirmedAt === null) return false
    this.assertDigests(digests)

    row.codes = new Map(digests.map((digest) => [digest, null]))
    return true
  }

  async unusedRecoveryDigests(userId: UserId): Promise<readonly string[]> {
    const row = this.rows.get(userId)
    if (row === undefined) return []
    return [...row.codes].filter(([, usedAt]) => usedAt === null).map(([digest]) => digest)
  }

  async useRecoveryCode(userId: UserId, digest: string, at: Date): Promise<boolean> {
    const row = this.rows.get(userId)
    if (row === undefined || row.codes.get(digest) !== null) return false
    row.codes.set(digest, new Date(at.getTime()))
    return true
  }

  async remove(userId: UserId): Promise<void> {
    this.rows.delete(userId)
  }

  private assertDigests(digests: readonly string[]): void {
    if (!digests.every(isDigestShape)) {
      throw new Error('CHECK constraint failed: user_recovery_codes.code_digest')
    }
    if (new Set(digests).size !== digests.length) {
      throw new Error('UNIQUE constraint failed: user_recovery_codes.user_id, code_digest')
    }
  }
}
