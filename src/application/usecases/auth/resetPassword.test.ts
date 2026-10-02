import { beforeEach, describe, expect, it } from 'vitest'
import { asAccountTokenId, asUserId } from '../../../domain/shared/ids'
import { issueAccountToken } from '../../../domain/users/accountToken'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { AT, aUser, anAccountToken } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeResetPassword } from './resetPassword'

const HOUR = 60 * 60 * 1000
const NEW_PASSWORD = 'une-phrase-de-passe-neuve'

class FakeHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = 'hash:factice'
  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }
  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === `hash:${attempt}`
  }
  needsRehash(): boolean {
    return false
  }
}

describe('resetPassword', () => {
  let users: FakeUserRepository
  let tokens: FakeAccountTokenRepository
  let secrets: FakeSecretTokens
  let clock: FakeClock

  /** The link `requestPasswordReset` would have mailed: token `secret-1` for `user-1`. */
  const issueLink = async (overrides: Parameters<typeof anAccountToken>[0] = {}) => {
    const { token, digest } = secrets.mint()
    await tokens.save(anAccountToken({ id: `tok-${token}`, tokenDigest: digest, ...overrides }))
    return token
  }

  const reset = (
    token: string,
    newPassword = NEW_PASSWORD,
    deps: { tokens?: AccountTokenRepository } = {},
  ) =>
    makeResetPassword({
      users,
      tokens: deps.tokens ?? tokens,
      secrets,
      hasher: new FakeHasher(),
      clock,
    })({ token, newPassword })

  const epochOf = async (id = 'user-1'): Promise<string | undefined> =>
    (await users.authStateFor(asUserId(id))).credentialsChangedAt?.toISOString()

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'hote@example.test', passwordHash: 'hash:ancien-mot-de-passe' }),
    )
    tokens = new FakeAccountTokenRepository().withAccounts(asUserId('user-1'))
    secrets = new FakeSecretTokens()
    clock = new FakeClock(AT)
  })

  // ----------------------------------------------------------- the happy path --

  it('sets the password the person chose', async () => {
    const token = await issueLink()

    const result = await reset(token)

    expect(result.ok).toBe(true)
    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(`hash:${NEW_PASSWORD}`)
  })

  it('ends every session the account has, by raising the credentials epoch to now', async () => {
    const token = await issueLink()
    clock.advance(10 * 60 * 1000)

    await reset(token)

    expect(await epochOf()).toBe(clock.now().toISOString())
  })

  it('clears a forced password change, which is what an invitee who forgot theirs needs', async () => {
    users.seed(aUser({ id: 'user-1', email: 'hote@example.test', mustChangePassword: true }))
    const token = await issueLink()

    await reset(token)

    expect((await users.findById(asUserId('user-1')))?.mustChangePassword).toBe(false)
  })

  it('does not sign anybody in: it returns nothing but success', async () => {
    const token = await issueLink()

    const result = await reset(token)

    expect(result).toEqual({ ok: true, value: undefined })
  })

  // ------------------------------------------------------------ single use --

  it('refuses the same link the second time with auth.invalidToken, and changes nothing more', async () => {
    const token = await issueLink()
    await reset(token)

    const again = await reset(token, 'une-autre-phrase-de-passe')

    expect(!again.ok && again.error.code).toBe('auth.invalidToken')
    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(`hash:${NEW_PASSWORD}`)
  })

  it('lets exactly one of several simultaneous requests with one link change the password', async () => {
    const token = await issueLink()

    const outcomes = await Promise.all(
      ['premiere-phrase-de-passe', 'deuxieme-phrase-de-passe', 'troisieme-phrase-de-passe'].map(
        (password) => reset(token, password),
      ),
    )

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(
      outcomes.filter((outcome) => !outcome.ok).map((outcome) => !outcome.ok && outcome.error.code),
    ).toEqual(['auth.invalidToken', 'auth.invalidToken'])
  })

  // ------------------------------------------------------- every refusal is one --

  it.each([
    ['a token nobody issued', async () => 'secret-999'],
    ['an expired token', async () => issueLink({ createdAt: new Date(AT.getTime() - 2 * HOUR) })],
    ['a token revoked by a newer request', async () => issueLink({ revokedAt: AT })],
    ['a token already spent', async () => issueLink({ consumedAt: AT })],
    ['a token issued for another purpose', async () => issueLink({ purpose: 'emailVerification' })],
    [
      'a token waiting for an approval it never got',
      async () => issueLink({ requiresApproval: true }),
    ],
    ['an empty token', async () => ''],
  ])('answers auth.invalidToken for %s', async (_label, makeToken) => {
    const token = await makeToken()

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
    expect(!result.ok && result.error.kind).toBe('invalid')
  })

  it('changes nothing when it refuses: the password and the epoch are as they were', async () => {
    await reset('secret-999')

    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(
      'hash:ancien-mot-de-passe',
    )
    expect(await epochOf()).toBeUndefined()
  })

  it('refuses a link at the very instant it expires', async () => {
    const token = await issueLink()
    clock.advance(HOUR)

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
  })

  it('accepts a link up to its last millisecond', async () => {
    const token = await issueLink()
    clock.advance(HOUR - 1)

    expect((await reset(token)).ok).toBe(true)
  })

  // ------------------------------------------------------ the account behind it --

  it('refuses a link whose account has been switched off', async () => {
    users.seed(aUser({ id: 'user-1', email: 'hote@example.test', disabledAt: AT }))
    const token = await issueLink()

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
  })

  it('refuses a link whose account no longer exists', async () => {
    const token = await issueLink()
    await users.delete(asUserId('user-1'))

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
  })

  it('refuses a link mailed to an address the account has since left', async () => {
    // The link proves control of *that* mailbox. If the account now uses another, it proves
    // nothing about whoever holds the account.
    const token = await issueLink({ email: 'ancienne@example.test' })

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(
      'hash:ancien-mot-de-passe',
    )
  })

  it('refuses a token that names no account at all', async () => {
    const { token, digest } = secrets.mint()
    const record = issueAccountToken(
      {
        purpose: 'invitation',
        tokenDigest: digest,
        email: anAccountToken().email,
        userId: null,
        delivery: 'link',
        createdBy: null,
      },
      asAccountTokenId('tok-orphan'),
      AT,
    )
    if (!record.ok) throw new Error('invalid fixture')
    await tokens.save({ ...record.value, purpose: 'passwordReset' })

    const result = await reset(token)

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
  })

  // ------------------------------------------------ the second, constant-time check --

  it('refuses a record whose digest is not the presented token’s, whatever the repository returned', async () => {
    // A repository that matched loosely — a LIKE, a case-insensitive collation — and
    // handed back somebody else's link. The lookup is not the only line of defence.
    await issueLink()
    const looseRepository: AccountTokenRepository = Object.assign(Object.create(tokens), {
      findUsable: async () => tokens.all[0] ?? null,
    })

    const result = await reset('secret-999', NEW_PASSWORD, { tokens: looseRepository })

    expect(!result.ok && result.error.code).toBe('auth.invalidToken')
    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(
      'hash:ancien-mot-de-passe',
    )
  })

  // --------------------------------------------------- the password is checked first --

  it('refuses a password the policy rejects, with its own code, and does not spend the link', async () => {
    const token = await issueLink()

    const refused = await reset(token, 'court')

    expect(!refused.ok && refused.error.code).toBe('password.tooShort')
    expect((await reset(token)).ok).toBe(true)
  })

  it('refuses a password equal to the account’s own address', async () => {
    const token = await issueLink()

    const refused = await reset(token, 'hote@example.test')

    expect(refused.ok).toBe(false)
    expect((await users.findById(asUserId('user-1')))?.passwordHash).toBe(
      'hash:ancien-mot-de-passe',
    )
  })

  // ------------------------------------------------------------- one live link --

  it('revokes every other outstanding link for the address once one has been used', async () => {
    const used = await issueLink()
    const { digest: otherDigest } = secrets.mint()
    await tokens.save(anAccountToken({ id: 'tok-other', tokenDigest: otherDigest }))

    await reset(used)

    expect(await tokens.findUsable(otherDigest, 'passwordReset', clock.now())).toBeNull()
  })

  it('leaves another account’s link alone', async () => {
    users.seed(aUser({ id: 'user-2', email: 'sacha@example.test' }))
    tokens.withAccounts(asUserId('user-2'))
    const mine = await issueLink()
    const { digest: theirDigest } = secrets.mint()
    await tokens.save(
      anAccountToken({
        id: 'tok-theirs',
        tokenDigest: theirDigest,
        userId: 'user-2',
        email: 'sacha@example.test',
      }),
    )

    await reset(mine)

    expect(await tokens.findUsable(theirDigest, 'passwordReset', clock.now())).not.toBeNull()
  })
})
