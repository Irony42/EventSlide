import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { aUser } from '../../testing/builders'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeChangePassword, type ChangePasswordInput } from './changePassword'

/** The plaintext behind `aUser()`'s default hash, so a fixture and a change agree. */
const CURRENT = 'un-mot-de-passe-solide'
const NEW = 'une-phrase-de-passe-neuve'

const hashOf = (plaintext: string): PasswordHash => `hash:${plaintext}`

const defaultProduces = (password: Password): PasswordHash => hashOf(password.value)

/**
 * A hasher whose output a test can dictate.
 *
 * `src/application/testing/` has no password hasher fake yet — it is written by work in
 * flight — and the "hasher returned the hash already on file" guard is only reachable
 * by choosing what `hash` returns, so this double is local to the file that needs it.
 */
class ScriptedPasswordHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = hashOf('mot-de-passe-factice')

  constructor(private readonly produces: (password: Password) => PasswordHash = defaultProduces) {}

  async hash(password: Password): Promise<PasswordHash> {
    return this.produces(password)
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === hashOf(attempt)
  }

  needsRehash(): boolean {
    return false
  }
}

describe('changePassword', () => {
  let users: FakeUserRepository
  let hasher: ScriptedPasswordHasher

  const change = (overrides: Partial<ChangePasswordInput> = {}) =>
    makeChangePassword({ users, hasher })({
      userId: asUserId('user-1'),
      currentPassword: CURRENT,
      newPassword: NEW,
      ...overrides,
    })

  const stored = () => users.findById(asUserId('user-1'))

  beforeEach(() => {
    users = new FakeUserRepository()
    hasher = new ScriptedPasswordHasher()
    users.seed(aUser({ id: 'user-1' }))
  })

  it('replaces the stored hash for a caller who proves the current password', async () => {
    const result = await change()

    expect(result.ok).toBe(true)
    expect((await stored())?.passwordHash).toBe(hashOf(NEW))
  })

  it('clears the forced change once the invitee has chosen their own password', async () => {
    users.seed(aUser({ id: 'user-1', mustChangePassword: true }))

    await change()

    expect((await stored())?.mustChangePassword).toBe(false)
  })

  it('refuses an account that no longer exists', async () => {
    const result = await change({ userId: asUserId('user-supprime') })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })

  it('refuses a wrong current password and leaves the stored hash alone', async () => {
    const result = await change({ currentPassword: 'un-autre-mot-de-passe' })

    expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
    expect((await stored())?.passwordHash).toBe(hashOf(CURRENT))
  })

  it('refuses a new password below the password policy', async () => {
    const result = await change({ newPassword: 'court' })

    expect(!result.ok && result.error.code).toBe('password.tooShort')
  })

  it('refuses a new password that is only the account name', async () => {
    users.seed(aUser({ id: 'user-1', displayName: 'Camille Bonnet' }))

    const result = await change({ newPassword: 'Camille Bonnet' })

    expect(!result.ok && result.error.code).toBe('password.sameAsName')
  })

  it('refuses the password already on the account', async () => {
    const result = await change({ newPassword: CURRENT })

    expect(!result.ok && result.error.code).toBe('password.unchanged')
    expect((await stored())?.passwordHash).toBe(hashOf(CURRENT))
  })

  it('reports failure when the hasher returns the hash already on file', async () => {
    hasher = new ScriptedPasswordHasher(() => hashOf(CURRENT))

    const result = await change()

    expect(!result.ok && result.error.code).toBe('user.passwordUnchanged')
    expect((await stored())?.passwordHash).toBe(hashOf(CURRENT))
  })
})
