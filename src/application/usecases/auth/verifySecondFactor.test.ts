import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { canonicalRecoveryCode } from '../../../domain/users/recoveryCode'
import { totpStepAt } from '../../../domain/users/totp'
import { aUser } from '../../testing/builders'
import { FakeMfaVault } from '../../testing/fakeMfaVault'
import {
  AN_ID_THE_LOG_REFUSES,
  PASSWORD,
  USER,
  aSecondFactorWorld,
} from '../../testing/secondFactorWorld'
import { makeVerifySecondFactor } from './verifySecondFactor'

const signedIn = async () => {
  const world = aSecondFactorWorld()
  const enrolment = await world.enrolled()
  return { world, ...enrolment }
}

describe('verifySecondFactor: a code from the app', () => {
  it('accepts the code of the current step and spends that step', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)

    const result = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(result).toEqual({ ok: true, value: { method: 'totp', recoveryCodesRemaining: null } })
    expect(await world.factors.find(USER)).toMatchObject({
      lastUsedStep: totpStepAt(world.clock.now()),
    })
  })

  it('refuses the same code a second time: a code already used in its step is a replay', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)
    await world.verifySecondFactor({ userId: USER, proof: { code } })

    const replay = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(!replay.ok && replay.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses the same code for as long as its step is still inside the window', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)
    await world.verifySecondFactor({ userId: USER, proof: { code } })

    // Thirty seconds on, the step is one behind the clock but still acceptable by time alone.
    world.clock.advance(30_000)
    const replay = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(!replay.ok && replay.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses an earlier step once a later one was used', async () => {
    const { world, secret } = await signedIn()
    await world.verifySecondFactor({ userId: USER, proof: { code: world.codeFor(secret, 1) } })

    const earlier = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret, 0) },
    })

    expect(!earlier.ok && earlier.error.code).toBe('auth.invalidSecondFactor')
  })

  it('accepts a fresh code on the next step', async () => {
    const { world, secret } = await signedIn()
    await world.verifySecondFactor({ userId: USER, proof: { code: world.codeFor(secret) } })

    world.clock.advance(30_000)
    const next = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(next.ok).toBe(true)
  })

  it('lets only one of two simultaneous requests carrying one code through', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)

    const outcomes = await Promise.all([
      world.verifySecondFactor({ userId: USER, proof: { code } }),
      world.verifySecondFactor({ userId: USER, proof: { code } }),
    ])

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
  })

  it('refuses a code two steps away, and one that is plainly wrong, the same way', async () => {
    const { world, secret } = await signedIn()

    for (const code of [world.codeFor(secret, 2), world.codeFor(secret, -2), '000000']) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { code } })
      expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    }
  })

  it('refuses text that is not six digits with the same answer, so shape is not an oracle', async () => {
    const { world } = await signedIn()

    const result = await world.verifySecondFactor({ userId: USER, proof: { code: 'abcdef' } })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses a code made from another account’s secret', async () => {
    const { world } = await signedIn()
    const stranger = new Uint8Array(20).fill(9)

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(stranger) },
    })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('says the box cannot check, and logs without the secret, when the stored secret will not open', async () => {
    const { world, secret } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: new FakeMfaVault('another-key'),
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { code: world.codeFor(secret) } })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorUnavailable')
    expect(world.captured.lines).toEqual([
      {
        level: 'error',
        message: 'a stored second factor could not be opened with the configured key',
      },
    ])
  })

  it('says the box cannot check when it holds no key at all', async () => {
    const { world, secret } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: null,
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { code: world.codeFor(secret) } })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorUnavailable')
  })
})

describe('verifySecondFactor: a recovery code', () => {
  it('accepts a code that was shown at enrolment, in whatever case and spacing it is typed', async () => {
    const { world, recoveryCodes } = await signedIn()
    const typed = (recoveryCodes[0] ?? '').toLowerCase().replaceAll('-', ' ')

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: typed },
    })

    expect(result).toEqual({
      ok: true,
      value: { method: 'recoveryCode', recoveryCodesRemaining: 9 },
    })
  })

  it('accepts a code only once: the second use is refused', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[3] ?? ''
    await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    const again = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    expect(!again.ok && again.error.code).toBe('auth.invalidSecondFactor')
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(9)
  })

  it('counts down as codes are spent', async () => {
    const { world, recoveryCodes } = await signedIn()

    const remaining: (number | null)[] = []
    for (const recoveryCode of recoveryCodes.slice(0, 3)) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })
      remaining.push(result.ok ? result.value.recoveryCodesRemaining : null)
    }

    expect(remaining).toEqual([9, 8, 7])
  })

  it('lets only one of two simultaneous requests carrying one code through', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[0] ?? ''

    const outcomes = await Promise.all([
      world.verifySecondFactor({ userId: USER, proof: { recoveryCode } }),
      world.verifySecondFactor({ userId: USER, proof: { recoveryCode } }),
    ])

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
  })

  it('refuses a code it never issued, and text that is not a code, the same way', async () => {
    const { world } = await signedIn()

    for (const recoveryCode of ['AAAA-AAAA-AAAA-AAAA', 'short', '']) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })
      expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    }
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(10)
  })

  it('compares the code with every unspent digest, whether or not the first one matched', async () => {
    const { world, recoveryCodes } = await signedIn()
    let comparisons = 0
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: world.vault,
      engine: world.engine,
      secrets: {
        mint: () => world.secrets.mint(),
        digestOf: (token) => world.secrets.digestOf(token),
        verify: (token, digest) => {
          comparisons += 1
          return world.secrets.verify(token, digest)
        },
      },
      attempts: world.attempts,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    await verify({ userId: USER, proof: { recoveryCode: recoveryCodes[0] ?? '' } })

    // Ten digests, and the first one was the match: a comparison that stopped there would
    // answer faster for the code a thief tries first.
    expect(comparisons).toBe(10)
  })

  it('records the use in the audit log with the number left, and not the code', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[0] ?? ''

    await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    const used = world.audit.all().filter((row) => row.action === 'account.recoveryCodeUsed')
    expect(used).toEqual([
      {
        seq: expect.any(Number),
        at: world.clock.now(),
        actor: { kind: 'operator', userId: USER, label: null },
        action: 'account.recoveryCodeUsed',
        subject: { type: 'account', id: USER },
        clientId: null,
        details: { remaining: 9 },
      },
    ])
    expect(JSON.stringify(world.audit.all())).not.toContain(canonicalRecoveryCode(recoveryCode))
  })

  it('writes no line for a code that was refused', async () => {
    const { world } = await signedIn()
    const before = world.audit.all().length

    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' },
    })

    expect(world.audit.all()).toHaveLength(before)
  })

  it('names a demoted account a member in the log, not an operator', async () => {
    const { world, recoveryCodes } = await signedIn()
    await world.users.save(aUser({ id: 'user-1', siteRole: 'none' }))

    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: recoveryCodes[0] ?? '' },
    })

    const used = world.audit.all().find((row) => row.action === 'account.recoveryCodeUsed')
    expect(used?.actor.kind).toBe('member')
  })

  it('still works on a box whose key is gone, which is what it is for', async () => {
    const { world, recoveryCodes } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: null,
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { recoveryCode: recoveryCodes[0] ?? '' } })

    expect(result.ok).toBe(true)
  })

  it('fails closed when the log refuses the line: the code is spent and the sign-in is not given', async () => {
    const { world, recoveryCodes } = await signedIn()
    // An audit log that is down.
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: world.vault,
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: { record: async () => Promise.reject(new Error('the log is down')) },
      clock: world.clock,
      logger: world.logger,
    })

    await expect(
      verify({ userId: USER, proof: { recoveryCode: recoveryCodes[0] ?? '' } }),
    ).rejects.toThrow('the log is down')
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(9)
  })
})

describe('verifySecondFactor: a log that refuses', () => {
  it('fails closed: the code is spent and the sign-in is not given', async () => {
    const world = aSecondFactorWorld()
    const code = 'AAAA-AAAA-AAAA-AAAA'
    await world.factors.beginEnrolment(AN_ID_THE_LOG_REFUSES, 'aXY.dGFn.Y3Q', 1, world.clock.now())
    await world.factors.confirmEnrolment(
      AN_ID_THE_LOG_REFUSES,
      'aXY.dGFn.Y3Q',
      1,
      world.clock.now(),
      [world.secrets.digestOf(canonicalRecoveryCode(code) ?? '')],
    )

    const result = await world.verifySecondFactor({
      userId: AN_ID_THE_LOG_REFUSES,
      proof: { recoveryCode: code },
    })

    expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
    expect(await world.factors.unusedRecoveryDigests(AN_ID_THE_LOG_REFUSES)).toEqual([])
  })
})

describe('verifySecondFactor: whose sign-in it is', () => {
  it('is over for an account that no longer exists', async () => {
    const { world, secret } = await signedIn()
    await world.users.delete(USER)

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('is over for an account somebody switched off in between', async () => {
    const { world, secret } = await signedIn()
    const user = await world.users.findById(USER)
    await world.users.save(user?.disable(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('is over when the credentials changed after the password was verified', async () => {
    const { world, secret } = await signedIn()
    const passwordVerifiedAt = world.clock.now()
    world.clock.advance(1_000)
    const user = await world.users.findById(USER)
    await world.users.save(user?.revokeSessionsBefore(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      passwordVerifiedAt,
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('stands when the credentials changed before the password was verified, or at the same instant', async () => {
    const { world, secret } = await signedIn()
    const user = await world.users.findById(USER)
    await world.users.save(user?.revokeSessionsBefore(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      passwordVerifiedAt: world.clock.now(),
    })

    expect(result.ok).toBe(true)
  })

  it('is over for an account with no factor, or one never confirmed', async () => {
    const world = aSecondFactorWorld()
    const none = await world.verifySecondFactor({ userId: USER, proof: { code: '123456' } })
    await world.enrollTotp({ userId: USER, password: 'un-mot-de-passe-solide' })
    const pending = await world.verifySecondFactor({ userId: USER, proof: { code: '123456' } })

    expect(!none.ok && none.error.code).toBe('auth.secondFactorExpired')
    expect(!pending.ok && pending.error.code).toBe('auth.secondFactorExpired')
  })

  it('judges only the account it was asked about', async () => {
    const { world, secret } = await signedIn()

    const result = await world.verifySecondFactor({
      userId: asUserId('someone-else'),
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })
})

const answerOf = (
  result: Awaited<ReturnType<ReturnType<typeof makeVerifySecondFactor>>>,
): string => (result.ok ? 'ok' : result.error.code)

describe('verifySecondFactor: how many guesses a sign-in gets', () => {
  const WRONG = '000000'

  it('answers the fifth wrong code of a sign-in as over, and the four before it as wrong', async () => {
    const { world } = await signedIn()

    const answers: string[] = []
    for (let guess = 0; guess < 5; guess += 1) {
      answers.push(
        answerOf(
          await world.verifySecondFactor({
            userId: USER,
            proof: { code: WRONG },
            attemptId: 'a-sign-in',
          }),
        ),
      )
    }

    expect(answers).toEqual([
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.secondFactorExpired',
    ])
  })

  it('counts wrong recovery codes in the same five as wrong codes from the app', async () => {
    const { world } = await signedIn()
    const proofs = [
      { code: WRONG },
      { recoveryCode: 'AAAAA-AAAAA' },
      { code: WRONG },
      { recoveryCode: 'BBBBB-BBBBB' },
      { code: WRONG },
    ]

    const answers: string[] = []
    for (const proof of proofs) {
      answers.push(
        answerOf(await world.verifySecondFactor({ userId: USER, proof, attemptId: 'a-sign-in' })),
      )
    }

    expect(answers.slice(0, 4)).toEqual(Array(4).fill('auth.invalidSecondFactor'))
    expect(answers[4]).toBe('auth.secondFactorExpired')
  })

  it('refuses the sixth attempt without reading it, so a right code that comes late is not spent', async () => {
    const { world, secret } = await signedIn()
    const before = await world.factors.find(USER)
    for (let guess = 0; guess < 5; guess += 1) {
      await world.verifySecondFactor({
        userId: USER,
        proof: { code: WRONG },
        attemptId: 'a-sign-in',
      })
    }

    const late = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      attemptId: 'a-sign-in',
    })

    expect(answerOf(late)).toBe('auth.secondFactorExpired')
    expect((await world.factors.find(USER))?.lastUsedStep).toBe(before?.lastUsedStep)
  })

  it('gives guesses sent at once the same five readings as guesses sent one by one', async () => {
    const { world, secret } = await signedIn()
    const before = await world.factors.find(USER)
    const guess = (code: string) =>
      world.verifySecondFactor({ userId: USER, proof: { code }, attemptId: 'a-sign-in' })

    // Five wrong codes and then the right one, all in flight together: the right one is the
    // sixth to start, so it is the one that is not read, and its step is not spent.
    const answers = await Promise.all([
      guess(WRONG),
      guess(WRONG),
      guess(WRONG),
      guess(WRONG),
      guess(WRONG),
      guess(world.codeFor(secret)),
    ])

    expect(answers.map(answerOf)).toEqual([
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.secondFactorExpired',
      'auth.secondFactorExpired',
    ])
    expect((await world.factors.find(USER))?.lastUsedStep).toBe(before?.lastUsedStep)
  })

  it('ends a sign-in at the fifth wrong code however many arrive together: four wrong, six over', async () => {
    const { world } = await signedIn()

    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        world.verifySecondFactor({
          userId: USER,
          proof: { code: WRONG },
          attemptId: 'a-sign-in',
        }),
      ),
    )

    expect(answers.map(answerOf).filter((a) => a === 'auth.invalidSecondFactor')).toHaveLength(4)
    expect(answers.map(answerOf).filter((a) => a === 'auth.secondFactorExpired')).toHaveLength(6)
  })

  it('lets the right code through as the fifth attempt', async () => {
    const { world, secret } = await signedIn()
    for (let guess = 0; guess < 4; guess += 1) {
      await world.verifySecondFactor({
        userId: USER,
        proof: { code: WRONG },
        attemptId: 'a-sign-in',
      })
    }

    const fifth = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      attemptId: 'a-sign-in',
    })

    expect(fifth.ok).toBe(true)
  })

  it('counts each sign-in on its own', async () => {
    const { world } = await signedIn()
    for (let guess = 0; guess < 4; guess += 1) {
      await world.verifySecondFactor({
        userId: USER,
        proof: { code: WRONG },
        attemptId: 'the-first',
      })
    }

    const another = await world.verifySecondFactor({
      userId: USER,
      proof: { code: WRONG },
      attemptId: 'another',
    })

    expect(answerOf(another)).toBe('auth.invalidSecondFactor')
  })

  it('puts no cap on a step-up, which has no sign-in to throw away', async () => {
    const { world } = await signedIn()

    const answers: string[] = []
    for (let guess = 0; guess < 10; guess += 1) {
      answers.push(
        answerOf(await world.verifySecondFactor({ userId: USER, proof: { code: WRONG } })),
      )
    }

    expect(new Set(answers)).toEqual(new Set(['auth.invalidSecondFactor']))
  })

  it('puts no cap on a step-up through its own use case either', async () => {
    const { world } = await signedIn()

    const answers: string[] = []
    for (let guess = 0; guess < 8; guess += 1) {
      const result = await world.stepUp({
        userId: USER,
        password: PASSWORD,
        proof: { code: WRONG },
      })
      answers.push(result.ok ? 'ok' : result.error.code)
    }

    expect(new Set(answers)).toEqual(new Set(['auth.invalidSecondFactor']))
  })

  it('keeps the attempt when something throws, because a throw can come after a reading', async () => {
    const { world, recoveryCodes } = await signedIn()
    const withTheLogDown = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: world.vault,
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: { record: async () => Promise.reject(new Error('the log is down')) },
      clock: world.clock,
      logger: world.logger,
    })

    await expect(
      withTheLogDown({
        userId: USER,
        proof: { recoveryCode: recoveryCodes[0] ?? '' },
        attemptId: 'a-sign-in',
      }),
    ).rejects.toThrow('the log is down')

    expect(world.attempts.held('a-sign-in')).toBe(1)
  })

  it('does not charge an attempt when the box could not check the code', async () => {
    const { world } = await signedIn()
    const withoutKey = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: null,
      engine: world.engine,
      secrets: world.secrets,
      attempts: world.attempts,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })
    for (let guess = 0; guess < 10; guess += 1) {
      const unavailable = await withoutKey({
        userId: USER,
        proof: { code: WRONG },
        attemptId: 'a-sign-in',
      })
      expect(answerOf(unavailable)).toBe('auth.secondFactorUnavailable')
    }

    const wrong = await world.verifySecondFactor({
      userId: USER,
      proof: { code: WRONG },
      attemptId: 'a-sign-in',
    })

    expect(answerOf(wrong)).toBe('auth.invalidSecondFactor')
  })

  it('does not charge an attempt when the sign-in was already over', async () => {
    const { world } = await signedIn()
    for (let guess = 0; guess < 10; guess += 1) {
      const over = await world.verifySecondFactor({
        userId: asUserId('someone-else'),
        proof: { code: WRONG },
        attemptId: 'a-sign-in',
      })
      expect(answerOf(over)).toBe('auth.secondFactorExpired')
    }

    const wrong = await world.verifySecondFactor({
      userId: USER,
      proof: { code: WRONG },
      attemptId: 'a-sign-in',
    })

    expect(answerOf(wrong)).toBe('auth.invalidSecondFactor')
  })
})
