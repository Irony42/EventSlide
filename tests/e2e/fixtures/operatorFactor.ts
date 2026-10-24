import { createHmac } from 'node:crypto'
import { codeOf, sessionOn, succeeded } from './clients'
import type { TestApp } from './startTestApp'

/**
 * The operator's second factor, from the specs' side: an authenticator that shares no line with
 * the product's.
 *
 * `totp` is RFC 6238 written out from the RFC, with its own base32 decoder, so what a spec that
 * uses it claims is the one that matters to an operator, "the code my app shows is a code this
 * server accepts", and not "the product agrees with itself". `nodeTotpEngine.test.ts` holds the
 * production engine to the RFC's vectors; the specs hold the whole stack to this one.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const base32 = (text: string): Buffer => {
  let bits = ''
  for (const character of text.replace(/=+$/, '')) {
    bits += ALPHABET.indexOf(character).toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(parseInt(bits.slice(at, at + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 with HMAC-SHA1, thirty seconds, six digits, from the RFC's own text. */
export const totp = (secret: Buffer, step: number): string => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0)
  return String(binary % 1_000_000).padStart(6, '0')
}

export const currentStep = (): number => Math.floor(Date.now() / 1000 / 30)

/** A 32-byte key, as `MFA_ENCRYPTION_KEY` wants it. A fixture, and obviously one. */
export const MFA_KEY = Buffer.alloc(32, 7).toString('base64')

/** The box as the hosted instance configures it: a console, and a second factor it requires. */
export const HOSTED = {
  SITE_ADMIN: 'on',
  REQUIRE_OPERATOR_2FA: 'true',
  MFA_ENCRYPTION_KEY: MFA_KEY,
} as const

export interface OperatorFactor {
  /** The authenticator's secret, for `totp`. */
  readonly secret: Buffer
  /** The ten recovery codes, each good once, and each a way to confirm a step-up as well. */
  readonly recoveryCodes: readonly string[]
}

/**
 * Enrols the box's operator in an authenticator, over the API, and answers its secret and its
 * recovery codes.
 *
 * The enrolment proves the app's code with **the step of now**, which the server accepts whichever
 * side of a boundary it lands on. A code is single-use and a step that is not later than the last
 * one spent is refused, so the sign-in that follows takes `currentStep() + 1`: the window reaches
 * one step ahead of the server's clock, and the server's clock is never behind the spec's, so that
 * step is accepted on either side of a boundary and is always later than the one spent. A third
 * code in a row would fall outside the window and cannot wait for the clock, which is why a spec
 * that needs one confirms its step-up with a recovery code, which exists for exactly this.
 */
export const enrolOperator = async (app: TestApp): Promise<OperatorFactor> => {
  const operator = await sessionOn(app.baseUrl)

  const login = await operator.post('/api/auth/login', {
    email: app.owner.email,
    password: app.owner.password,
  })
  if (!succeeded(login)) throw new Error(`the operator could not sign in: ${login.status}`)

  const started = await operator.post('/api/auth/2fa/enroll', { password: app.owner.password })
  if (!succeeded(started)) {
    throw new Error(`enrolling failed with ${started.status} ${codeOf(started) ?? ''}`)
  }
  const secretText = started.body['secret']
  if (typeof secretText !== 'string') throw new Error('the enrolment carried no secret')
  const secret = base32(secretText)

  const confirmed = await operator.post('/api/auth/2fa/confirm', {
    code: totp(secret, currentStep()),
  })
  if (!succeeded(confirmed)) {
    throw new Error(`confirming failed with ${confirmed.status} ${codeOf(confirmed) ?? ''}`)
  }
  const recoveryCodes = confirmed.body['recoveryCodes']
  if (!Array.isArray(recoveryCodes) || recoveryCodes.some((code) => typeof code !== 'string')) {
    throw new Error('the confirmation carried no recovery codes')
  }

  return { secret, recoveryCodes: recoveryCodes as readonly string[] }
}
