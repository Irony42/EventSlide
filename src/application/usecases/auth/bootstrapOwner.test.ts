import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { AT, aUser } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeBootstrapOwner, type BootstrapOwnerInput } from './bootstrapOwner'

const CONFIGURED_PASSWORD = 'une-phrase-de-passe-op'

const hashOf = (plaintext: string): PasswordHash => `hash:${plaintext}`

const defaultProduces = (password: Password): PasswordHash => hashOf(password.value)

/**
 * A hasher whose output a test can dictate.
 *
 * `src/application/testing/` has no password hasher fake yet — it is written by work in
 * flight — and the empty-hash guard on `User.create` is only reachable by choosing what
 * `hash` returns, so this double is local to the file that needs it.
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

describe('bootstrapOwner', () => {
  let users: FakeUserRepository
  let hasher: ScriptedPasswordHasher
  let ids: SequentialIdGenerator
  let clock: FakeClock

  const bootstrap = (overrides: Partial<BootstrapOwnerInput> = {}) =>
    makeBootstrapOwner({ users, hasher, ids, clock })({
      email: 'ops@example.test',
      password: CONFIGURED_PASSWORD,
      displayName: null,
      ...overrides,
    })

  beforeEach(() => {
    users = new FakeUserRepository()
    hasher = new ScriptedPasswordHasher()
    ids = new SequentialIdGenerator()
    clock = new FakeClock()
  })

  it('creates the first owner from configuration on an empty database', async () => {
    const result = await bootstrap({ displayName: 'Camille' })

    expect(result.ok && result.value).toEqual({ created: true, userId: asUserId('user-1') })
    const owner = await users.findById(asUserId('user-1'))
    expect(owner?.email.value).toBe('ops@example.test')
    expect(owner?.displayName).toBe('Camille')
    expect(owner?.passwordHash).toBe(hashOf(CONFIGURED_PASSWORD))
    expect(owner?.createdAt).toEqual(AT)
  })

  it('requires the owner to replace a password that came from a deployment file', async () => {
    await bootstrap()

    expect((await users.findById(asUserId('user-1')))?.mustChangePassword).toBe(true)
  })

  it('does nothing on a database that already has an account', async () => {
    users.seed(aUser({ id: 'user-9', email: 'hote@example.test' }))

    const result = await bootstrap()

    expect(result.ok && result.value).toEqual({ created: false, reason: 'accountsExist' })
    expect(await users.findById(asUserId('user-1'))).toBeNull()
  })

  it('does not resurrect an owner somebody deliberately disabled', async () => {
    users.seed(aUser({ id: 'user-9', email: 'ops@example.test', disabledAt: AT }))

    const result = await bootstrap()

    expect(result.ok && result.value).toEqual({ created: false, reason: 'accountsExist' })
  })

  it('refuses a configured address that is not an address', async () => {
    const result = await bootstrap({ email: 'ops' })

    expect(!result.ok && result.error.code).toBe('email.malformed')
    expect(await users.isEmpty()).toBe(true)
  })

  it.each([
    {
      rejected: 'a password on the blocklist',
      password: 'motdepasse123',
      code: 'password.tooCommon',
    },
    { rejected: 'a short password', password: 'admin', code: 'password.tooShort' },
  ])('refuses $rejected, the way 1.0 never did', async ({ password, code }) => {
    const result = await bootstrap({ password })

    expect(!result.ok && result.error.code).toBe(code)
    expect(await users.isEmpty()).toBe(true)
  })

  it('refuses a configured password that is only the owner name', async () => {
    const result = await bootstrap({
      displayName: 'Camille Bonnet',
      password: 'Camille Bonnet',
    })

    expect(!result.ok && result.error.code).toBe('password.sameAsName')
  })

  it('creates nobody when the hasher hands back an empty hash', async () => {
    hasher = new ScriptedPasswordHasher(() => '')

    const result = await bootstrap()

    expect(!result.ok && result.error.code).toBe('user.passwordHashEmpty')
    expect(await users.isEmpty()).toBe(true)
  })
})
