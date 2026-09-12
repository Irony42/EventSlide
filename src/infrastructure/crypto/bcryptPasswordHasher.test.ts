import { describe, expect, it } from 'vitest'
import { createBcryptPasswordHasher } from './bcryptPasswordHasher'
import { Password } from '../../domain/users/password'

/**
 * Ring 3, against real bcrypt. Cost 10 — the lowest the adapter accepts — keeps the
 * suite fast; cost 11 appears only where the point of the test is that the cost comes
 * from configuration rather than from a constant in this file.
 *
 * Constructed at module scope because the adapter is stateless and its constructor
 * spends a full bcrypt round on `dummyHash`; rebuilding it per test would add a
 * hundred milliseconds a test and prove nothing.
 */
const hasher = createBcryptPasswordHasher({ cost: 10 })

const aPassword = (raw: string): Password => {
  const result = Password.create(raw)
  if (!result.ok) throw new Error(`the test fixture "${raw}" is not a valid password`)
  return result.value
}

const HOST_PASSPHRASE = 'camille-et-sacha-2026'

describe('createBcryptPasswordHasher', () => {
  describe('construction', () => {
    it.each([9, 16, 0, -1, 12.5, Number.NaN])(
      'refuses to be constructed at cost %s, so a misconfigured cost fails at boot rather than at login',
      (cost) => {
        expect(() => createBcryptPasswordHasher({ cost })).toThrow(
          /bcrypt cost must be an integer between 10 and 15/,
        )
      },
    )

    it.each([
      [10, /^\$2[aby]\$10\$/],
      [11, /^\$2[aby]\$11\$/],
    ])('stamps the configured cost %i into the hashes it produces', async (cost, pattern) => {
      const configured = createBcryptPasswordHasher({ cost })

      const hash = await configured.hash(aPassword(HOST_PASSPHRASE))

      expect(hash).toMatch(pattern)
    })
  })

  describe('hash and verify', () => {
    it('accepts the password it hashed', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))

      expect(await hasher.verify(HOST_PASSPHRASE, hash)).toBe(true)
    })

    it('refuses a different password against the same hash', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))

      expect(await hasher.verify('camille-et-sacha-2025', hash)).toBe(false)
    })

    it('refuses the right password against a tampered hash', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))
      const flipped = hash.slice(0, -1) + (hash.endsWith('a') ? 'b' : 'a')

      expect(await hasher.verify(HOST_PASSPHRASE, flipped)).toBe(false)
    })

    it('refuses a hash re-stamped with a lower cost, so the work factor cannot be downgraded in the database', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))
      const downgraded = hash.replace('$10$', '$04$')

      expect(await hasher.verify(HOST_PASSPHRASE, downgraded)).toBe(false)
    })

    it('salts every hash, so two accounts sharing a password do not share a digest', async () => {
      const password = aPassword(HOST_PASSPHRASE)

      const [first, second] = await Promise.all([hasher.hash(password), hasher.hash(password)])

      expect(first).not.toBe(second)
    })

    it.each(['', 'not-a-bcrypt-hash', '$2b$', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'])(
      'reads the malformed stored hash %p as a wrong password rather than throwing',
      async (stored) => {
        // A 500 here would tell an attacker the account exists and its row is broken.
        await expect(hasher.verify(HOST_PASSPHRASE, stored)).resolves.toBe(false)
      },
    )

    it('reads a NULL password hash as a wrong password rather than throwing', async () => {
      // `users.password_hash` is read as a typed row with no runtime validation
      // (sqliteUserRepository declares it `string`), so a hand-edited or migrated row
      // with a NULL in that column reaches bcrypt as `null` — the one input for which
      // `bcrypt.compare` rejects instead of resolving false. Cast through `unknown`
      // because this state is exactly the one the declared type does not describe.
      const nullColumn = null as unknown as string

      await expect(hasher.verify(HOST_PASSPHRASE, nullColumn)).resolves.toBe(false)
    })
  })

  describe('dummyHash: the account-enumeration defence', () => {
    it('is a complete bcrypt hash at the configured cost, so verifying an unknown address does the same work as a known one', () => {
      // Asserted structurally rather than by timing: `bcrypt.compare` runs the full
      // key derivation for any well-formed hash and returns immediately for a
      // malformed one, so "well-formed, at this cost" is what buys the equal time.
      expect(hasher.dummyHash).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/)
    })

    it('takes its cost from configuration too, so raising the work factor also slows the unknown-address path', () => {
      const configured = createBcryptPasswordHasher({ cost: 11 })

      expect(configured.dummyHash).toMatch(/^\$2[aby]\$11\$/)
    })

    it('never accepts a password, so the equalising comparison cannot authenticate anyone', async () => {
      expect(await hasher.verify(HOST_PASSPHRASE, hasher.dummyHash)).toBe(false)
    })

    it('is not flagged for rehashing, which would send the login use case down the rehash path for a nonexistent account', () => {
      expect(hasher.needsRehash(hasher.dummyHash)).toBe(false)
    })
  })

  describe('needsRehash', () => {
    it('leaves a hash produced at the configured cost alone', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))

      expect(hasher.needsRehash(hash)).toBe(false)
    })

    it('asks for a rehash when the configured cost has been raised above the stored one', async () => {
      const hash = await hasher.hash(aPassword(HOST_PASSPHRASE))

      expect(createBcryptPasswordHasher({ cost: 11 }).needsRehash(hash)).toBe(true)
    })

    it('leaves a hash stronger than the configured cost alone, so lowering the cost does not weaken stored rows', async () => {
      const strong = await createBcryptPasswordHasher({ cost: 11 }).hash(aPassword(HOST_PASSPHRASE))

      expect(hasher.needsRehash(strong)).toBe(false)
    })

    it.each([
      ['a hash from another scheme', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'],
      ['a single-digit cost field', '$2b$9$abcdefghijklmnopqrstuv'],
      ['an empty string', ''],
      ['a 1.0-era plaintext column', 'password'],
    ])('asks for a rehash for %s, so the next successful login replaces it', (_label, stored) => {
      expect(hasher.needsRehash(stored)).toBe(true)
    })
  })
})
