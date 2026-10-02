import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import { AT, atPlus } from '../builders'

/**
 * The shared `SecondFactorRepository` contract, run against the in-memory fake and the
 * SQLite adapter.
 *
 * What has to behave the same in both is what decides whether a stolen code or a stolen
 * password is enough: that a TOTP step is spent **exactly once however many requests carry
 * it**, that it can only move forward, that a recovery code is single-use, that a pending
 * enrolment is not an enrolment, and that a confirmed one is never replaced as a side effect
 * of starting another. A fake that was kinder than the table about any of them would let every
 * use-case test above it pass against a product that was broken.
 *
 * The accounts named here must exist before the suite runs — `user_id` is a foreign key in the
 * real tables, and the fake mirrors it. Both subjects seed {@link CONTRACT_ACCOUNTS}.
 */

export const CONTRACT_ACCOUNTS = ['user-1', 'user-2'] as const

const USER = asUserId('user-1')
const OTHER = asUserId('user-2')

/** The shape the vault writes and the table insists on: exactly two dots. */
const SEALED = 'aXZpdml2aXZpdml2.dGFndGFndGFndGFn.Y2lwaGVydGV4dA'
const SEALED_AGAIN = 'bnVldm9ub3Vl.dm8.c2VndW5kbw'

const digest = (character: string): string => character.repeat(64)

const CODES = [digest('a'), digest('b'), digest('c')] as const

export const secondFactorRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: SecondFactorRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`SecondFactorRepository contract: ${name}`, () => {
    let repo: SecondFactorRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    /** An account with a confirmed factor, its first code spent at `step`. */
    const enrolled = async (
      userId = USER,
      step = 100,
      codes: readonly string[] = CODES,
    ): Promise<void> => {
      expect(await repo.beginEnrolment(userId, SEALED, 1, AT)).toBe(true)
      expect(await repo.confirmEnrolment(userId, step, atPlus(1_000), codes)).toBe(true)
    }

    // ------------------------------------------------------------ enrolment --

    it('knows no factor for an account that never began one', async () => {
      expect(await repo.find(USER)).toBeNull()
    })

    it('stores a pending enrolment: sealed, versioned, unconfirmed and with no step spent', async () => {
      expect(await repo.beginEnrolment(USER, SEALED, 3, AT)).toBe(true)

      expect(await repo.find(USER)).toEqual({
        userId: USER,
        sealedSecret: SEALED,
        keyVersion: 3,
        confirmedAt: null,
        lastUsedStep: null,
      })
    })

    it('restarts an enrolment that was never confirmed, with the new secret', async () => {
      await repo.beginEnrolment(USER, SEALED, 1, AT)

      expect(await repo.beginEnrolment(USER, SEALED_AGAIN, 2, atPlus(5_000))).toBe(true)

      expect(await repo.find(USER)).toMatchObject({ sealedSecret: SEALED_AGAIN, keyVersion: 2 })
    })

    it('never replaces a confirmed factor by starting another enrolment', async () => {
      await enrolled()

      expect(await repo.beginEnrolment(USER, SEALED_AGAIN, 2, atPlus(9_000))).toBe(false)

      expect(await repo.find(USER)).toMatchObject({ sealedSecret: SEALED, keyVersion: 1 })
    })

    it('confirms a pending enrolment, spends the step that proved it and installs the codes', async () => {
      await repo.beginEnrolment(USER, SEALED, 1, AT)

      expect(await repo.confirmEnrolment(USER, 100, atPlus(1_000), CODES)).toBe(true)

      expect(await repo.find(USER)).toEqual({
        userId: USER,
        sealedSecret: SEALED,
        keyVersion: 1,
        confirmedAt: atPlus(1_000),
        lastUsedStep: 100,
      })
      expect([...(await repo.unusedRecoveryDigests(USER))].sort()).toEqual([...CODES])
    })

    it('cannot confirm what was never begun', async () => {
      expect(await repo.confirmEnrolment(USER, 100, AT, CODES)).toBe(false)
      expect(await repo.find(USER)).toBeNull()
    })

    it('cannot confirm twice: the second confirmation changes nothing, codes included', async () => {
      await enrolled(USER, 100, CODES)

      expect(await repo.confirmEnrolment(USER, 200, atPlus(9_000), [digest('d')])).toBe(false)

      expect(await repo.find(USER)).toMatchObject({ lastUsedStep: 100, confirmedAt: atPlus(1_000) })
      expect([...(await repo.unusedRecoveryDigests(USER))].sort()).toEqual([...CODES])
    })

    it('confirms one account without touching another', async () => {
      await repo.beginEnrolment(USER, SEALED, 1, AT)
      await repo.beginEnrolment(OTHER, SEALED_AGAIN, 1, AT)

      await repo.confirmEnrolment(USER, 100, AT, CODES)

      expect(await repo.find(OTHER)).toMatchObject({ confirmedAt: null, lastUsedStep: null })
      expect(await repo.unusedRecoveryDigests(OTHER)).toEqual([])
    })

    // ----------------------------------------------------------- the replay --

    it('spends a step once: the same step is refused the second time', async () => {
      await enrolled(USER, 100)

      expect(await repo.useStep(USER, 101)).toBe(true)
      expect(await repo.useStep(USER, 101)).toBe(false)
      expect(await repo.find(USER)).toMatchObject({ lastUsedStep: 101 })
    })

    it('refuses a step earlier than the last one spent, and the step that confirmed the factor', async () => {
      await enrolled(USER, 100)

      expect(await repo.useStep(USER, 100)).toBe(false)
      expect(await repo.useStep(USER, 99)).toBe(false)
      expect(await repo.find(USER)).toMatchObject({ lastUsedStep: 100 })
    })

    it('lets the step only move forward, however it is skipped', async () => {
      await enrolled(USER, 100)

      expect(await repo.useStep(USER, 150)).toBe(true)
      expect(await repo.useStep(USER, 120)).toBe(false)
      expect(await repo.useStep(USER, 151)).toBe(true)
    })

    it('lets one of two simultaneous requests carrying one step win, and only one', async () => {
      await enrolled(USER, 100)

      const outcomes = await Promise.all([
        repo.useStep(USER, 101),
        repo.useStep(USER, 101),
        repo.useStep(USER, 101),
      ])

      expect(outcomes.filter(Boolean)).toHaveLength(1)
    })

    it('spends no step for a factor that is still pending, or for an account with none', async () => {
      await repo.beginEnrolment(USER, SEALED, 1, AT)

      expect(await repo.useStep(USER, 101)).toBe(false)
      expect(await repo.useStep(OTHER, 101)).toBe(false)
      expect(await repo.find(USER)).toMatchObject({ lastUsedStep: null })
    })

    it('keeps the steps of two accounts apart', async () => {
      await enrolled(USER, 100)
      await enrolled(OTHER, 100)

      expect(await repo.useStep(USER, 101)).toBe(true)
      expect(await repo.useStep(OTHER, 101)).toBe(true)
    })

    // -------------------------------------------------------- recovery codes --

    it('spends a recovery code once', async () => {
      await enrolled()

      expect(await repo.useRecoveryCode(USER, CODES[0], atPlus(2_000))).toBe(true)
      expect(await repo.useRecoveryCode(USER, CODES[0], atPlus(3_000))).toBe(false)
      expect([...(await repo.unusedRecoveryDigests(USER))].sort()).toEqual([CODES[1], CODES[2]])
    })

    it('lets one of two simultaneous requests carrying one recovery code win, and only one', async () => {
      await enrolled()

      const outcomes = await Promise.all([
        repo.useRecoveryCode(USER, CODES[1], atPlus(2_000)),
        repo.useRecoveryCode(USER, CODES[1], atPlus(2_000)),
      ])

      expect(outcomes.filter(Boolean)).toHaveLength(1)
    })

    it('refuses a code it never issued', async () => {
      await enrolled()

      expect(await repo.useRecoveryCode(USER, digest('f'), atPlus(2_000))).toBe(false)
    })

    it('refuses an account the recovery code of another account', async () => {
      await enrolled(USER, 100, [digest('a')])
      await enrolled(OTHER, 100, [digest('b')])

      expect(await repo.useRecoveryCode(OTHER, digest('a'), atPlus(2_000))).toBe(false)
      expect(await repo.useRecoveryCode(USER, digest('a'), atPlus(2_000))).toBe(true)
    })

    it('replaces every code, the spent ones too, so an old set stops working', async () => {
      await enrolled()
      await repo.useRecoveryCode(USER, CODES[0], atPlus(2_000))

      expect(await repo.replaceRecoveryCodes(USER, [digest('d'), digest('e')])).toBe(true)

      expect([...(await repo.unusedRecoveryDigests(USER))].sort()).toEqual([
        digest('d'),
        digest('e'),
      ])
      expect(await repo.useRecoveryCode(USER, CODES[1], atPlus(3_000))).toBe(false)
    })

    it('can reissue a digest it had already spent, as a fresh single-use code', async () => {
      await enrolled()
      await repo.useRecoveryCode(USER, CODES[0], atPlus(2_000))

      await repo.replaceRecoveryCodes(USER, [CODES[0]])

      expect(await repo.useRecoveryCode(USER, CODES[0], atPlus(3_000))).toBe(true)
    })

    it('replaces nothing for an account with no confirmed factor', async () => {
      await repo.beginEnrolment(USER, SEALED, 1, AT)

      expect(await repo.replaceRecoveryCodes(USER, CODES)).toBe(false)
      expect(await repo.replaceRecoveryCodes(OTHER, CODES)).toBe(false)
      expect(await repo.unusedRecoveryDigests(USER)).toEqual([])
    })

    // --------------------------------------------------------------- removal --

    it('removes the factor and its codes, and leaves a neighbour alone', async () => {
      await enrolled(USER)
      await enrolled(OTHER)

      await repo.remove(USER)

      expect(await repo.find(USER)).toBeNull()
      expect(await repo.unusedRecoveryDigests(USER)).toEqual([])
      expect(await repo.useRecoveryCode(USER, CODES[0], atPlus(2_000))).toBe(false)
      expect(await repo.find(OTHER)).not.toBeNull()
      expect([...(await repo.unusedRecoveryDigests(OTHER))]).toHaveLength(CODES.length)
    })

    it('lets an account enrol again after its factor was removed', async () => {
      await enrolled()
      await repo.remove(USER)

      expect(await repo.beginEnrolment(USER, SEALED_AGAIN, 1, atPlus(9_000))).toBe(true)
      expect(await repo.find(USER)).toMatchObject({ confirmedAt: null, lastUsedStep: null })
    })

    it('treats removing what is not there as nothing to do', async () => {
      await expect(repo.remove(USER)).resolves.toBeUndefined()
    })
  })
}
