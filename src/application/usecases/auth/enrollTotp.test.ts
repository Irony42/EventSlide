import { describe, expect, it } from 'vitest'
import { decodeBase32 } from '../../../domain/users/base32'
import { TOTP_SECRET_BYTES } from '../../../domain/users/totp'
import { PASSWORD, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'

describe('enrollTotp', () => {
  it('hands the operator a secret to scan, as an otpauth URI and as base32 to type', async () => {
    const world = aSecondFactorWorld()

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const secret = decodeBase32(result.value.secret)
    expect(secret?.length).toBe(TOTP_SECRET_BYTES)
    expect(result.value.otpauthUri).toMatch(/^otpauth:\/\/totp\/EventSlide:hote%40example\.test\?/)
    expect(result.value.otpauthUri).toContain(`secret=${result.value.secret}`)
  })

  it('stores the secret sealed and unconfirmed, so nothing about signing in changes yet', async () => {
    const world = aSecondFactorWorld()

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    const stored = await world.factors.find(USER)
    expect(stored).toMatchObject({ confirmedAt: null, lastUsedStep: null, keyVersion: 1 })
    expect(result.ok && stored?.sealedSecret.includes(result.value.secret)).toBe(false)
    expect(world.audit.all()).toEqual([])
  })

  it('opens the stored secret back to the one it showed', async () => {
    const world = aSecondFactorWorld()

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    const stored = await world.factors.find(USER)
    expect(result.ok && stored !== null).toBe(true)
    if (!result.ok || stored === null) return
    expect(world.vault?.open(stored.sealedSecret, stored.keyVersion)).toEqual(
      decodeBase32(result.value.secret),
    )
  })

  it('gives a second attempt a new secret while the first was never confirmed', async () => {
    const world = aSecondFactorWorld()
    const first = await world.enrollTotp({ userId: USER, password: PASSWORD })

    const second = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(first.ok && second.ok && first.value.secret !== second.value.secret).toBe(true)
  })

  it('refuses a wrong password, and stores nothing: a stolen cookie must not be able to add a factor', async () => {
    const world = aSecondFactorWorld()

    const result = await world.enrollTotp({ userId: USER, password: 'not-the-password' })

    expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
    expect(world.factors.has(USER)).toBe(false)
  })

  it('refuses an account that does not operate the box', async () => {
    const world = aSecondFactorWorld({ siteRole: 'none' })

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(world.factors.has(USER)).toBe(false)
  })

  it('refuses an account that already has a confirmed factor, and leaves it as it was', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    const before = await world.factors.find(USER)

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorAlreadyEnrolled')
    expect(await world.factors.find(USER)).toEqual(before)
  })

  it('answers feature.unavailable on a box with no key, before it reads a password', async () => {
    const world = aSecondFactorWorld({ withVault: false })

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.kind).toBe('notFound')
    expect(!result.ok && result.error.code).toBe('feature.unavailable')
    expect(world.hasher.verifications).toEqual([])
  })

  it('answers user.notFound when the account was deleted under the session', async () => {
    const world = aSecondFactorWorld()
    await world.users.delete(USER)

    const result = await world.enrollTotp({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })
})
