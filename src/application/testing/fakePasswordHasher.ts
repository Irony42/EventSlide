import type { Password } from '../../domain/users/password'
import type { PasswordHash } from '../../domain/users/user'
import type { PasswordHasher } from '../ports/passwordHasher'

export interface FakePasswordHasherOptions {
  /**
   * What `hash` answers for a password. Default `hash:<password>`.
   *
   * A test chooses it to reach what a well-behaved hasher never does: hand back the hash
   * already on file, hand back an empty string, or take time while it hashes (the callback
   * runs when `hash` does, so it can move a clock).
   */
  readonly produces?: (password: Password) => PasswordHash
  /** Which stored hashes `needsRehash` calls stale, as a cost increase would. Default: none. */
  readonly stale?: (hash: PasswordHash) => boolean
  /**
   * A second shape of stored hash that `verify` accepts for an attempt, besides `hash:<attempt>`:
   * a row written at the old cost, which verifies fine and is only visible as stale. A rehash
   * is observable only when the new hash differs from the stored one that verified.
   */
  readonly alsoVerifies?: (attempt: string) => PasswordHash
  /**
   * `verify` waits for this before it answers. The means to put a crowd of guesses in flight
   * at once: they have all started (see `verifications`) and none has finished.
   */
  readonly gate?: Promise<void> | undefined
}

/**
 * `hash:<password>`, fast, and it remembers what it was asked to compare.
 *
 * The shape `aUser()`'s default hash already uses, so a fixture and a login agree. The
 * record is there because some rules are only visible in it: "a dead link is refused
 * before any hash is compared" answers the same either way, and the only way to hold it
 * in place is to see that no comparison happened. A comparison is recorded when it starts,
 * so `verifications.length` is also how many are in flight behind a `gate`.
 *
 * Real bcrypt costs ~200 ms by design and there is no seam that makes it cheaper, which is
 * the whole reason `PasswordHasher` is a port. The fake still behaves: a wrong password
 * genuinely fails to verify. The options reach the few outcomes a test cannot get from an
 * honest hasher; each is a thing a test file used to build a whole class for.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly verifications: { readonly attempt: string; readonly hash: PasswordHash }[] = []
  readonly dummyHash: PasswordHash = 'hash:mot-de-passe-factice'

  constructor(private readonly options: FakePasswordHasherOptions = {}) {}

  async hash(password: Password): Promise<PasswordHash> {
    return this.options.produces?.(password) ?? `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    this.verifications.push({ attempt, hash })
    await this.options.gate
    return hash === `hash:${attempt}` || hash === this.options.alsoVerifies?.(attempt)
  }

  needsRehash(hash: PasswordHash): boolean {
    return this.options.stale?.(hash) ?? false
  }
}
