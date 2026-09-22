import type { Password } from '../../domain/users/password'
import type { PasswordHash } from '../../domain/users/user'
import type { PasswordHasher } from '../ports/passwordHasher'

/**
 * `hash:<password>`, fast, and it remembers what it was asked to compare.
 *
 * The shape `aUser()`'s default hash already uses, so a fixture and a login agree. The
 * record is there because some rules are only visible in it: "a dead link is refused
 * before any hash is compared" answers the same either way, and the only way to hold it
 * in place is to see that no comparison happened.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly verifications: { readonly attempt: string; readonly hash: PasswordHash }[] = []
  readonly dummyHash: PasswordHash = 'hash:mot-de-passe-factice'

  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    this.verifications.push({ attempt, hash })
    return hash === `hash:${attempt}`
  }

  needsRehash(): boolean {
    return false
  }
}
