import bcrypt from 'bcrypt'
import type { PasswordHasher } from '../../application/ports/passwordHasher'
import type { Password } from '../../domain/users/password'
import type { PasswordHash } from '../../domain/users/user'

/**
 * bcrypt at cost 12.
 *
 * Why bcrypt and not argon2id: argon2id is the better algorithm, but every Node
 * binding for it is a native module that a self-hosted operator has to build, and the
 * threat here is an offline attack against a handful of host accounts on a box the
 * operator already controls. bcrypt at cost 12 is roughly 250 ms per attempt, which
 * with the per-IP login rate limit puts online guessing out of reach and makes offline
 * cracking of a decent password uneconomic. See docs/SECURITY.md.
 *
 * 1.0 used cost 10 and shipped a hardcoded hash of the string `password` in
 * `src/database.ts`, recreated on every boot.
 */

/** bcrypt hashes are `$2b$<cost>$<22 char salt><31 char digest>`. */
const COST_PATTERN = /^\$2[aby]\$(\d{2})\$/

export interface BcryptOptions {
  readonly cost: number
}

export const createBcryptPasswordHasher = ({ cost }: BcryptOptions): PasswordHasher => {
  if (!Number.isInteger(cost) || cost < 10 || cost > 15) {
    throw new Error(`bcrypt cost must be an integer between 10 and 15, got ${cost}`)
  }

  /**
   * Hashed once at construction so that a login attempt for an unknown email spends
   * the same ~250 ms as one for a known email. Without it the timing difference is a
   * reliable account-enumeration oracle. `hashSync` is deliberate: this happens once,
   * at startup, before the server listens.
   */
  const dummyHash = bcrypt.hashSync(
    'eventslide-timing-equalisation-value-not-a-real-password',
    cost,
  )

  return {
    hash: async (password: Password): Promise<PasswordHash> => bcrypt.hash(password.value, cost),

    verify: async (attempt: string, hash: PasswordHash): Promise<boolean> => {
      try {
        return await bcrypt.compare(attempt, hash)
      } catch {
        // A malformed stored hash — hand-edited, or migrated from another system —
        // must read as "wrong password", not as a 500 that tells the caller the
        // account exists and is broken.
        return false
      }
    },

    dummyHash,

    needsRehash: (hash: PasswordHash): boolean => {
      const match = COST_PATTERN.exec(hash)
      // Unparseable means it was not produced by this hasher, so rehashing it on the
      // next successful login is exactly right.
      if (!match?.[1]) return true
      return Number(match[1]) < cost
    },
  }
}
