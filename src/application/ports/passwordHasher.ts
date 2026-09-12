import type { Password } from '../../domain/users/password'
import type { PasswordHash } from '../../domain/users/user'

/**
 * Password hashing, behind a port for two reasons: the algorithm is an infrastructure
 * choice (bcrypt today, see docs/adr/), and a real hash costs ~200 ms by design, which
 * would make every authentication test slow enough that nobody runs them.
 */
export interface PasswordHasher {
  hash(password: Password): Promise<PasswordHash>

  /**
   * Takes a raw string, not a `Password`. A login attempt is not policy-checked: an
   * account whose password predates a policy change must still be able to sign in, and
   * refusing the attempt at the policy layer would leak which passwords are valid.
   */
  verify(attempt: string, hash: PasswordHash): Promise<boolean>

  /**
   * A hash of a fixed dummy value, used to spend the same time on an unknown email as
   * on a known one.
   *
   * Without it, "no such account" returns in microseconds while a real account takes
   * ~200 ms, and the difference is a reliable account-enumeration oracle. The
   * authentication use case verifies against this when the lookup misses.
   */
  readonly dummyHash: PasswordHash

  /**
   * Whether a stored hash was produced with weaker parameters than the current
   * configuration — after a cost increase, for example. The login use case
   * transparently rehashes when this is true, since it holds the plaintext at that
   * moment and will not again.
   */
  needsRehash(hash: PasswordHash): boolean
}
