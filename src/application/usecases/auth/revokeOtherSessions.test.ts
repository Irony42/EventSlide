import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT, aUser } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeRevokeOtherSessions } from './revokeOtherSessions'

describe('revokeOtherSessions', () => {
  let users: FakeUserRepository
  let clock: FakeClock

  const run = (userId = 'user-1') =>
    makeRevokeOtherSessions({ users, clock })({ userId: asUserId(userId) })

  const epochOf = async (userId: string): Promise<string | undefined> =>
    (await users.authStateFor(asUserId(userId))).credentialsChangedAt?.toISOString()

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'camille@example.test' }),
      aUser({ id: 'user-2', email: 'sacha@example.test' }),
    )
    clock = new FakeClock(AT)
  })

  it('raises the credentials epoch to now, which is what ends every older session', async () => {
    clock.advance(90_000)

    const result = await run()

    expect(result.ok).toBe(true)
    expect(await epochOf('user-1')).toBe(clock.now().toISOString())
  })

  it('signs out only the caller account, never anybody else', async () => {
    await run('user-1')

    expect(await epochOf('user-2')).toBeUndefined()
  })

  it('moves the epoch forward on a second use', async () => {
    await run()
    clock.advance(60_000)

    await run()

    expect(await epochOf('user-1')).toBe(clock.now().toISOString())
  })

  it('leaves the password, the flags and the sign-in record exactly as they were', async () => {
    const before = await users.findById(asUserId('user-1'))

    await run()

    const after = await users.findById(asUserId('user-1'))
    expect(after?.passwordHash).toBe(before?.passwordHash)
    expect(after?.mustChangePassword).toBe(before?.mustChangePassword)
    expect(after?.lastLoginAt).toEqual(before?.lastLoginAt)
    expect(after?.disabledAt).toBeNull()
  })

  it('refuses an account that no longer exists', async () => {
    const result = await run('user-supprime')

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })
})
