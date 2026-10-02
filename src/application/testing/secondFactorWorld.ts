import { asUserId } from '../../domain/shared/ids'
import { decodeBase32 } from '../../domain/users/base32'
import { totpStepAt } from '../../domain/users/totp'
import type { SiteRole } from '../../domain/users/siteRole'
import type { TotpEngine } from '../ports/totpEngine'
import { makeAuthenticateUser } from '../usecases/auth/authenticateUser'
import { makeConfirmTotpEnrollment } from '../usecases/auth/confirmTotpEnrollment'
import { makeDisableSecondFactor } from '../usecases/auth/disableSecondFactor'
import { makeEnrollTotp } from '../usecases/auth/enrollTotp'
import { makeRegenerateRecoveryCodes } from '../usecases/auth/regenerateRecoveryCodes'
import { makeStepUp } from '../usecases/auth/stepUp'
import { makeVerifySecondFactor } from '../usecases/auth/verifySecondFactor'
import type { MfaVault } from '../ports/mfaVault'
import type { SecretTokens } from '../ports/secretTokens'
import type { Logger } from '../ports/logger'
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
 * a test that wants an operator to enrol and sign in.
 *
 * One account, `user-1`, who knows their password ({@link PASSWORD}) and — unless
 * `siteRole: 'none'` — operates the box. `enrolled()` runs the real `enrollTotp` and
 * `confirmTotpEnrollment` and hands back the secret and the recovery codes, so a test starts from
 * the state a person is actually in rather than from rows written behind the use cases' backs.
 *
 * Every collaborator can be passed in, so an HTTP test can build the world over the same
 * repositories, clock and logger as the server it drives (the session middleware reads the
 * credentials epoch from the very repository the use cases write), and a canary can swap in the
 * real engine, vault and digests.
 */

export const PASSWORD = 'un-mot-de-passe-solide'
export const EMAIL = 'hote@example.test'
export const USER = asUserId('user-1')

export interface SecondFactorWorldOptions {
  readonly siteRole?: SiteRole
  /** `false` builds a box with no `MFA_ENCRYPTION_KEY`: no vault. Ignored if `vault` is given. */
  readonly withVault?: boolean
  readonly clock?: FakeClock
  readonly users?: FakeUserRepository
  readonly factors?: FakeSecondFactorRepository
  readonly audit?: FakeAuditLog
  readonly logger?: Logger
  readonly vault?: MfaVault | null
  readonly engine?: TotpEngine
  readonly secrets?: SecretTokens
}

/**
 * An id the audit log cannot hold (it allows letters, digits, `_` and `-`), for the account whose
 * every audit entry the log refuses. A real account id is never this; the point is the branch
 * every use case has for "the entry I just built is not one the log accepts", which fails
 * closed and has to be shown to.
 */
export const AN_ID_THE_LOG_REFUSES = asUserId('not an id the log can hold!')

export const aSecondFactorWorld = ({
  siteRole = 'operator',
  withVault = true,
  clock = new FakeClock(AT),
  users = new FakeUserRepository(),
  factors = new FakeSecondFactorRepository(),
  audit = new FakeAuditLog(),
  logger,
  vault = withVault ? new FakeMfaVault() : null,
  engine = new FakeTotpEngine(),
  secrets = new FakeSecretTokens(),
}: SecondFactorWorldOptions = {}) => {
  const captured = new CapturingLogger()
  const wiredLogger: Logger = logger ?? captured
  users.seed(
    aUser({ id: 'user-1', email: EMAIL, siteRole }),
    aUser({ id: AN_ID_THE_LOG_REFUSES, email: 'autre@example.test', siteRole: 'operator' }),
  )
  factors.withAccounts(USER, AN_ID_THE_LOG_REFUSES)
  audit.withAccounts(USER, AN_ID_THE_LOG_REFUSES)
  const ids = new SequentialIdGenerator()
  const hasher = new FakePasswordHasher()

  const authenticateUser = makeAuthenticateUser({ users, factors, hasher, clock })
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
    logger: wiredLogger,
  })
  const verifySecondFactor = makeVerifySecondFactor({
    users,
    factors,
    vault,
    engine,
    secrets,
    audit,
    clock,
    logger: wiredLogger,
  })
  const stepUp = makeStepUp({ users, factors, hasher, verifySecondFactor })
  const regenerateRecoveryCodes = makeRegenerateRecoveryCodes({
    users,
    factors,
    secrets,
    ids,
    audit,
    clock,
  })
  const disableSecondFactor = makeDisableSecondFactor({ users, factors, audit, clock })

  /** The code the person's app shows `stepsFromNow` steps from the clock's present. */
  const codeFor = (secret: Uint8Array, stepsFromNow = 0): string =>
    engine.codeAt(secret, totpStepAt(clock.now()) + stepsFromNow)

  /** Enrolment as a person does it: scan, then prove. Moves the clock one step on. */
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
    logger: wiredLogger,
    /** What the default logger heard. Empty when a test brought its own. */
    captured,
    authenticateUser,
    enrollTotp,
    confirmTotpEnrollment,
    verifySecondFactor,
    stepUp,
    regenerateRecoveryCodes,
    disableSecondFactor,
    codeFor,
    enrolled,
  }
}
