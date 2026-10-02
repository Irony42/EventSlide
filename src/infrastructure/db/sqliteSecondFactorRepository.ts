import type {
  SecondFactorRecord,
  SecondFactorRepository,
} from '../../application/ports/secondFactorRepository'
import { asUserId, type UserId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `user_totp` and `user_recovery_codes` (migration 011).
 *
 * **Every transition is one conditional statement**, and `better-sqlite3` is synchronous: a
 * statement runs to completion before any other on the connection starts, so two requests
 * carrying one code resolve one after the other and the second finds the step already spent.
 * That is what the port's "exactly one wins" rests on, and it is why nothing here reads a row,
 * decides, and writes it back. The two that touch more than one statement (`confirmEnrolment`
 * and `replaceRecoveryCodes`) run them in a transaction, so a half-installed set of codes
 * cannot exist.
 *
 * The secret arrives sealed and leaves sealed; the digests are the only form a recovery code
 * ever takes here. Neither the key nor a plaintext secret reaches this file.
 */

interface FactorRow {
  readonly user_id: string
  readonly secret_enc: string
  readonly key_version: number
  readonly confirmed_at: string | null
  readonly last_used_step: number | null
}

export class SqliteSecondFactorRepository implements SecondFactorRepository {
  constructor(private readonly db: Db) {}

  async find(userId: UserId): Promise<SecondFactorRecord | null> {
    const row = this.db
      .prepare(
        `SELECT user_id, secret_enc, key_version, confirmed_at, last_used_step
           FROM user_totp WHERE user_id = ?`,
      )
      .get(userId) as FactorRow | undefined
    if (row === undefined) return null
    return {
      userId: asUserId(row.user_id),
      sealedSecret: row.secret_enc,
      keyVersion: row.key_version,
      confirmedAt: fromNullableIsoText(row.confirmed_at),
      lastUsedStep: row.last_used_step,
    }
  }

  async beginEnrolment(
    userId: UserId,
    sealedSecret: string,
    keyVersion: number,
    at: Date,
  ): Promise<boolean> {
    // The `WHERE` on the conflict branch is the rule: a pending row is overwritten, a
    // confirmed one is not, and `changes` says which happened.
    const result = this.db
      .prepare(
        `INSERT INTO user_totp (user_id, secret_enc, key_version, created_at)
              VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE
            SET secret_enc = excluded.secret_enc,
                key_version = excluded.key_version,
                created_at = excluded.created_at
          WHERE user_totp.confirmed_at IS NULL`,
      )
      .run(userId, sealedSecret, keyVersion, toIsoText(at))
    return result.changes === 1
  }

  async confirmEnrolment(
    userId: UserId,
    step: number,
    at: Date,
    recoveryDigests: readonly string[],
  ): Promise<boolean> {
    return this.db.transaction((): boolean => {
      const confirmed = this.db
        .prepare(
          `UPDATE user_totp SET confirmed_at = ?, last_used_step = ?
            WHERE user_id = ? AND confirmed_at IS NULL`,
        )
        .run(toIsoText(at), step, userId)
      if (confirmed.changes !== 1) return false

      this.installCodes(userId, recoveryDigests)
      return true
    })()
  }

  async useStep(userId: UserId, step: number): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE user_totp SET last_used_step = ?
          WHERE user_id = ?
            AND confirmed_at IS NOT NULL
            AND (last_used_step IS NULL OR last_used_step < ?)`,
      )
      .run(step, userId, step)
    return result.changes === 1
  }

  async replaceRecoveryCodes(userId: UserId, digests: readonly string[]): Promise<boolean> {
    return this.db.transaction((): boolean => {
      const factor = this.db
        .prepare(
          `SELECT 1 AS present FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL`,
        )
        .get(userId)
      if (factor === undefined) return false

      this.installCodes(userId, digests)
      return true
    })()
  }

  async unusedRecoveryDigests(userId: UserId): Promise<readonly string[]> {
    const rows = this.db
      .prepare(`SELECT code_digest FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`)
      .all(userId) as { code_digest: string }[]
    return rows.map((row) => row.code_digest)
  }

  async useRecoveryCode(userId: UserId, digest: string, at: Date): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE user_recovery_codes SET used_at = ?
          WHERE user_id = ? AND code_digest = ? AND used_at IS NULL`,
      )
      .run(toIsoText(at), userId, digest)
    return result.changes === 1
  }

  async remove(userId: UserId): Promise<void> {
    // The codes follow by `ON DELETE CASCADE`.
    this.db.prepare(`DELETE FROM user_totp WHERE user_id = ?`).run(userId)
  }

  /** Called inside a transaction: the old set goes and the new one is written, or neither. */
  private installCodes(userId: UserId, digests: readonly string[]): void {
    this.db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ?`).run(userId)
    const insert = this.db.prepare(
      `INSERT INTO user_recovery_codes (user_id, code_digest) VALUES (?, ?)`,
    )
    for (const digest of digests) insert.run(userId, digest)
  }
}
