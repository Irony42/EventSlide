import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { AT, aUser } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeAuthenticateUser } from './authenticateUser'

/** The plaintext behind `aUser()`'s default hash, so a fixture and a login agree. */
const PASSWORD = 'un-mot-de-passe-solide'

const CURRENT = 'hash:'
/** Stands in for 1.0's `$2b$10$` rows: they verify fine, at the old cost. */
const LEGACY = 'legacy:'

const current = (plaintext: string): PasswordHash => `${CURRENT}${plaintext}`
const legacy = (plaintext: string): PasswordHash => `${LEGACY}${plaintext}`

interface Verification {
  readonly attempt: string
  readonly hash: PasswordHash
}

const isLegacy = (hash: PasswordHash): boolean => hash.startsWith(LEGACY)

/**
 * A hasher that records every verification it was asked for.
 *
 * The equal-cost verify on an unknown address is invisible in the result — the use case
 * answers `auth.invalidCredentials` either way — so observing the call is the only way
 * to hold that rule in place. `src/application/testing/` has no recording hasher, and
 * it is written by work in flight, so this one is local to the file that needs it.
 *
 * Two hash shapes rather than one, because a rehash is only observable when the new
 * hash differs from the stored one that verified: `legacy:` is a hash at the old cost.
 */
class RecordingPasswordHasher implements PasswordHasher {
  readonly verifications: Verification[] = []
  readonly dummyHash: PasswordHash = current('mot-de-passe-factice')

  /** Injected so a test can call any stored hash stale, whatever its shape. */
  constructor(private readonly stale: (hash: PasswordHash) => boolean = isLegacy) {}

  async hash(password: Password): Promise<PasswordHash> {
    return current(password.value)
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    this.verifications.push({ attempt, hash })
    return hash === current(attempt) || hash === legacy(attempt)
  }

  needsRehash(hash: PasswordHash): boolean {
    return this.stale(hash)
  }
}

describe('authenticateUser', () => {
  let users: FakeUserRepository
  let hasher: RecordingPasswordHasher
  let clock: FakeClock

  const authenticate = (
    input: { email: string; password: string },
    withHasher: RecordingPasswordHasher = hasher,
  ) => makeAuthenticateUser({ users, hasher: withHasher, clock })(input)

  beforeEach(() => {
    users = new FakeUserRepository()
    hasher = new RecordingPasswordHasher()
    clock = new FakeClock()
  })

  it('returns the identity of a host who presents the right password', async () => {
    users.seed(aUser({ id: 'user-1', email: 'hote@example.test', displayName: 'Camille' }))

    const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

    expect(result.ok && result.value).toEqual({
      userId: asUserId('user-1'),
      email: 'hote@example.test',
      displayName: 'Camille',
      mustChangePassword: false,
    })
  })

  it('accepts an address the host typed with different capitalisation', async () => {
    users.seed(aUser({ email: 'hote@example.test' }))

    const result = await authenticate({ email: '  Hote@Example.TEST ', password: PASSWORD })

    expect(result.ok).toBe(true)
  })

  it('records the sign-in instant, so a host can see when the account was last used', async () => {
    users.seed(aUser({ id: 'user-1' }))

    await authenticate({ email: 'hote@example.test', password: PASSWORD })

    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.lastLoginAt).toEqual(AT)
  })

  it.each([
    { rejected: 'an unknown address', email: 'inconnue@example.test', password: PASSWORD },
    { rejected: 'a wrong password', email: 'hote@example.test', password: 'un-autre-mot-de-passe' },
    { rejected: 'a disabled account', email: 'renvoyee@example.test', password: PASSWORD },
    { rejected: 'a malformed address', email: 'hote', password: PASSWORD },
  ])('answers $rejected with one indistinguishable failure', async ({ email, password }) => {
    users.seed(
      aUser({ id: 'user-1', email: 'hote@example.test' }),
      aUser({ id: 'user-2', email: 'renvoyee@example.test', disabledAt: AT }),
    )

    const result = await authenticate({ email, password })

    expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
    expect(!result.ok && result.error.kind).toBe('unauthenticated')
  })

  it('spends a verification on the dummy hash when the address is unknown', async () => {
    const result = await authenticate({ email: 'inconnue@example.test', password: PASSWORD })

    expect(result.ok).toBe(false)
    expect(hasher.verifications).toEqual([{ attempt: PASSWORD, hash: hasher.dummyHash }])
  })

  it('still compares the password of a disabled account, so its refusal is not faster', async () => {
    users.seed(aUser({ id: 'user-1', disabledAt: AT }))

    const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

    expect(result.ok).toBe(false)
    expect(hasher.verifications).toEqual([{ attempt: PASSWORD, hash: current(PASSWORD) }])
  })

  it('does not record a sign-in for a disabled account', async () => {
    users.seed(aUser({ id: 'user-1', disabledAt: AT }))

    await authenticate({ email: 'hote@example.test', password: PASSWORD })

    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.lastLoginAt).toBeNull()
  })

  it('upgrades a hash left at the old cost, the one moment the plaintext is available', async () => {
    users.seed(aUser({ id: 'user-1', passwordHash: legacy(PASSWORD) }))

    const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

    expect(result.ok).toBe(true)
    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.passwordHash).toBe(current(PASSWORD))
  })

  it('keeps a forced password change pending across a silent hash upgrade', async () => {
    users.seed(aUser({ id: 'user-1', passwordHash: legacy(PASSWORD), mustChangePassword: true }))

    const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

    expect(result.ok && result.value.mustChangePassword).toBe(true)
    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.mustChangePassword).toBe(true)
  })

  it('keeps the old hash when the plaintext no longer satisfies the password policy', async () => {
    users.seed(aUser({ id: 'user-1', passwordHash: legacy('court') }))

    const result = await authenticate({ email: 'hote@example.test', password: 'court' })

    expect(result.ok).toBe(true)
    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.passwordHash).toBe(legacy('court'))
  })

  it('signs the host in even when the rehash yields the hash already on file', async () => {
    users.seed(aUser({ id: 'user-1' }))

    const result = await authenticate(
      { email: 'hote@example.test', password: PASSWORD },
      new RecordingPasswordHasher(() => true),
    )

    expect(result.ok).toBe(true)
    const stored = await users.findById(asUserId('user-1'))
    expect(stored?.passwordHash).toBe(current(PASSWORD))
    expect(stored?.lastLoginAt).toEqual(AT)
  })
})
