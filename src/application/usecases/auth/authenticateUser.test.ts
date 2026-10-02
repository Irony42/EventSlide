import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { AT, aUser } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeSecondFactorRepository } from '../../testing/fakeSecondFactorRepository'
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
  let factors: FakeSecondFactorRepository
  let hasher: RecordingPasswordHasher
  let clock: FakeClock

  const authenticate = (
    input: { email: string; password: string },
    withHasher: RecordingPasswordHasher = hasher,
  ) => makeAuthenticateUser({ users, factors, hasher: withHasher, clock })(input)

  beforeEach(() => {
    users = new FakeUserRepository()
    factors = new FakeSecondFactorRepository().withAccounts(asUserId('user-1'))
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
      secondFactorRequired: false,
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

  it('does not sign the owner out of their other devices when it upgrades the hash', async () => {
    // The upgrade replaces the hash with the same password at a higher cost. Treating it as
    // a password change would raise the credentials epoch, and every sign-in on a box with
    // old hashes would end the account's other sessions.
    users.seed(aUser({ id: 'user-1', passwordHash: legacy(PASSWORD) }))

    await authenticate({ email: 'hote@example.test', password: PASSWORD })

    const state = await users.authStateFor(asUserId('user-1'))
    expect(state.credentialsChangedAt).toBeNull()
  })

  describe('while the password is being compared', () => {
    /**
     * bcrypt takes ~200 ms by design, and a reset can finish inside that window. These hold the
     * comparison open, change the account underneath it, and let it finish — the one ordering
     * the other tests cannot reach, because a fake hasher answers instantly.
     */
    class GatedHasher extends RecordingPasswordHasher {
      private release: () => void = () => undefined
      private entered: () => void = () => undefined
      readonly insideVerify = new Promise<void>((resolve) => (this.entered = resolve))
      private readonly gate = new Promise<void>((resolve) => (this.release = resolve))

      override async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
        const answer = await super.verify(attempt, hash)
        this.entered()
        await this.gate
        return answer
      }

      open(): void {
        this.release()
      }
    }

    const signInDuring = async (change: () => Promise<void>) => {
      const gated = new GatedHasher()
      const pending = authenticate({ email: 'hote@example.test', password: PASSWORD }, gated)
      await gated.insideVerify
      await change()
      gated.open()
      return pending
    }

    it('refuses the sign-in when a reset changed the password meanwhile, and keeps the new one', async () => {
      users.seed(aUser({ id: 'user-1' }))

      const result = await signInDuring(async () => {
        const stored = await users.findById(asUserId('user-1'))
        const reset = stored?.changePassword(current('the-password-after-the-reset'), clock.now())
        if (reset?.ok) await users.save(reset.value)
      })

      expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
      const stored = await users.findById(asUserId('user-1'))
      expect(stored?.passwordHash).toBe(current('the-password-after-the-reset'))
      expect(stored?.lastLoginAt).toBeNull()
    })

    it('refuses the sign-in when the account was switched off meanwhile, and leaves it off', async () => {
      users.seed(aUser({ id: 'user-1' }))

      const result = await signInDuring(async () => {
        const stored = await users.findById(asUserId('user-1'))
        if (stored !== null) await users.save(stored.disable(clock.now()))
      })

      expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
      expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(true)
    })

    it('signs in normally when nothing changed meanwhile', async () => {
      users.seed(aUser({ id: 'user-1' }))

      const result = await signInDuring(async () => undefined)

      expect(result.ok).toBe(true)
      expect((await users.findById(asUserId('user-1')))?.lastLoginAt).toEqual(AT)
    })

    it('does not install an upgraded hash over a password that was reset meanwhile', async () => {
      users.seed(aUser({ id: 'user-1', passwordHash: legacy(PASSWORD) }))

      const result = await signInDuring(async () => {
        const stored = await users.findById(asUserId('user-1'))
        const reset = stored?.changePassword(current('the-password-after-the-reset'), clock.now())
        if (reset?.ok) await users.save(reset.value)
      })

      expect(result.ok).toBe(false)
      expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(
        current('the-password-after-the-reset'),
      )
    })
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

  describe('the second factor (G2-13 / P3-15)', () => {
    const enrol = async (confirm: boolean): Promise<void> => {
      await factors.beginEnrolment(asUserId('user-1'), 'aXY.dGFn.Y3Q', 1, AT)
      if (confirm) await factors.confirmEnrolment(asUserId('user-1'), 'aXY.dGFn.Y3Q', 5, AT, [])
    }

    it('says the password was only the first half for an account with a confirmed authenticator', async () => {
      users.seed(aUser({ id: 'user-1' }))
      await enrol(true)

      const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

      expect(result.ok && result.value.secondFactorRequired).toBe(true)
    })

    it('does not ask for a factor that was shown but never confirmed', async () => {
      users.seed(aUser({ id: 'user-1' }))
      await enrol(false)

      const result = await authenticate({ email: 'hote@example.test', password: PASSWORD })

      expect(result.ok && result.value.secondFactorRequired).toBe(false)
    })

    it('answers a wrong password the same for an enrolled account as for any other', async () => {
      users.seed(aUser({ id: 'user-1' }))
      await enrol(true)

      const result = await authenticate({ email: 'hote@example.test', password: 'nope-nope-nope' })

      expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
    })
  })
})
