import {
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  recoveryCodeFromBytes,
} from '../../../domain/users/recoveryCode'
import type { IdGenerator } from '../../ports/idGenerator'
import type { SecretTokens } from '../../ports/secretTokens'

/**
 * A fresh set of recovery codes: what is shown to the person once, and what is stored.
 *
 * The codes come from the `IdGenerator`'s entropy and are hashed with the same
 * `SecretTokens` digest every other secret token in the product is stored as, over the
 * **canonical** form (`canonicalRecoveryCode`), so a code typed in lower case, with spaces or
 * with a confusable character reaches the digest it was minted under. The formatted codes go
 * to the person and nowhere else; only the digests are ever handed to a repository.
 */
export interface RecoveryCodeSet {
  /** As shown: `K7QM-2XTR-9PHD-4VNB`. Returned once and never stored, logged or re-derived. */
  readonly codes: readonly string[]
  /** As stored: SHA-256 of the canonical code. */
  readonly digests: readonly string[]
}

export const mintRecoveryCodes = (ids: IdGenerator, secrets: SecretTokens): RecoveryCodeSet => {
  const canonical = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    recoveryCodeFromBytes(ids.bytes(RECOVERY_CODE_BYTES)),
  )
  return {
    codes: canonical.map(formatRecoveryCode),
    digests: canonical.map((code) => secrets.digestOf(code)),
  }
}
