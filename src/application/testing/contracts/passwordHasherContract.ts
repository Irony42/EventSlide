import { describe, expect, it } from 'vitest'
import { Password } from '../../../domain/users/password'
import type { PasswordHasher } from '../../ports/passwordHasher'

/**
 * What login leans on in `PasswordHasher`, held against the fake and bcrypt: a hash verifies
 * the password it was made from and no other, the `dummyHash` (compared when the account does
 * not exist, so the answer takes as long either way) verifies no real password, and a
 * hash it has just made is not stale.
 *
 * Not here: salting and cost, which the fake does not model (`hash:<password>`), and what
 * `needsRehash` says of an older hash, which the fake scripts.
 */
const aPassword = (raw: string): Password => {
  const created = Password.create(raw)
  if (!created.ok) throw new Error(`fixture "${raw}" is not a valid password`)
  return created.value
}

export const passwordHasherContract = (name: string, makeHasher: () => PasswordHasher): void => {
  describe(`PasswordHasher contract: ${name}`, () => {
    const SECRET = 'camille-et-sacha-2026'

    it('verifies the password a hash was made from', async () => {
      const hasher = makeHasher()

      expect(await hasher.verify(SECRET, await hasher.hash(aPassword(SECRET)))).toBe(true)
    })

    it('refuses any other attempt, a near miss included', async () => {
      const hasher = makeHasher()
      const hash = await hasher.hash(aPassword(SECRET))

      expect(await hasher.verify(`${SECRET}!`, hash)).toBe(false)
      expect(await hasher.verify('', hash)).toBe(false)
    })

    it('never verifies a real password against the dummy hash', async () => {
      const hasher = makeHasher()

      expect(await hasher.verify(SECRET, hasher.dummyHash)).toBe(false)
    })

    it('does not call a hash it has just made stale', async () => {
      const hasher = makeHasher()

      expect(hasher.needsRehash(await hasher.hash(aPassword(SECRET)))).toBe(false)
    })
  })
}
