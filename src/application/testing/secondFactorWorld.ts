import { asUserId } from '../../domain/shared/ids'
import { decodeBase32 } from '../../domain/users/base32'
import { totpStepAt } from '../../domain/users/totp'
import type { SiteRole } from '../../domain/users/siteRole'
import { makeConfirmTotpEnrollment } from '../usecases/auth/confirmTotpEnrollment'
import { makeEnrollTotp } from '../usecases/auth/enrollTotp'
import { makeVerifySecondFactor } from '../usecases/auth/verifySecondFactor'
import { AT, aUser } from './builders'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClock } from './fakeClock'
import { FakeMfaVault } from './fakeMfaVault'
import { FakePasswordHasher } from './fakePasswordHasher'
import { FakeSecondFactorRepository } from './fakeSecondFactorRepository'
import { FakeSecretTokens } from './fakeSecretTokens'
import { FakeTotpEngine } from './fakeTotpEngine'
import { FakeUserRepository } from './fakeUserRepository'
import { CapturingLogger } from './galleryWorld'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * The fakes behind the second-factor use cases, wired the way `buildUseCases` wires them, for
 * a ring-2 test that wants an operator to enrol and sign in.
 *
 * One account, `user-1`, who knows their password ({@link PASSWORD}) and — unless
 * `siteRole: 'none'` — operates the box. `enrolled()` runs the real `enrollTotp` and
 * `confirmTotpEnrollment` and hands back the secret and the recovery codes, so a test starts from
 * the state a person is actually in rather than from rows written behind the use cases' backs.
 */

export const PASSWORD = 'un-mot-de-passe-solide'
export const USER = asUserId('user-1')

export interface SecondFactorWorldOptions {
  readonly siteRole?: SiteRole
  /** `false` builds a box with no `MFA_ENCRYPTION_KEY`: no vault. */
  readonly withVault?: boolean
}

export const aSecondFactorWorld = ({
  siteRole = 'operator',
  withVault = true,
}: SecondFactorWorldOptions = {}) => {
  const users = new FakeUserRepository().seed(aUser({ id: 'user-1', siteRole }))
  const factors = new FakeSecondFactorRepository().withAccounts(USER)
  const audit = new FakeAuditLog().withAccounts(USER)
  const clock = new FakeClock(AT)
  const ids = new SequentialIdGenerator()
  const hasher = new FakePasswordHasher()
  const engine = new FakeTotpEngine()
  const secrets = new FakeSecretTokens()
  const vault = withVault ? new FakeMfaVault() : null
  const logger = new CapturingLogger()

  const enrollTotp = makeEnrollTotp({
    users,
    factors,
    hasher,
    vault,
    ids,
    clock,
    issuer: 'EventSlide',
  })
  const confirmTotpEnrollment = makeConfirmTotpEnrollment({
    users,
    factors,
    vault,
    engine,
    secrets,
    ids,
    audit,
    clock,
    logger,
  })
  const verifySecondFactor = makeVerifySecondFactor({
    users,
    factors,
    vault,
    engine,
    secrets,
    audit,
    clock,
    logger,
  })

  /** The code the person's app shows `stepsFromNow` steps from the clock's present. */
  const codeFor = (secret: Uint8Array, stepsFromNow = 0): string =>
    engine.codeAt(secret, totpStepAt(clock.now()) + stepsFromNow)

  /** Enrolment as a person does it: scan, then prove. Leaves the clock where it found it. */
  const enrolled = async () => {
    const started = await enrollTotp({ userId: USER, password: PASSWORD })
    if (!started.ok) throw new Error(`enrolment refused: ${started.error.code}`)
    const secret = decodeBase32(started.value.secret)
    if (secret === null) throw new Error('the enrolment secret is not base32')

    const confirmed = await confirmTotpEnrollment({ userId: USER, code: codeFor(secret) })
    if (!confirmed.ok) throw new Error(`confirmation refused: ${confirmed.error.code}`)

    // The step that proved the enrolment is spent: a test that signs in next waits for the next.
    clock.advance(30_000)
    return { secret, recoveryCodes: confirmed.value.recoveryCodes }
  }

  return {
    users,
    factors,
    audit,
    clock,
    ids,
    hasher,
    engine,
    secrets,
    vault,
    logger,
    enrollTotp,
    confirmTotpEnrollment,
    verifySecondFactor,
    codeFor,
    enrolled,
  }
}
