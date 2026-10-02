import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { OWNER_SETTLED_PASSWORD, startTestApp, type TestApp } from '../fixtures/startTestApp'

/**
 * The operator's second factor on the real build (roadmap §10.1; free plan G2-13, paid plan
 * P3-15, ring 6): a real server process, a real SQLite file, the real session store, the real
 * bcrypt and the real AES-256-GCM vault, configured the way the hosted instance is.
 *
 * **The authenticator here is not the product's.** `totp` below is RFC 6238 written out from
 * the RFC in this file, with its own base32 decoder, so the claim being tested is the one that
 * matters to an operator — "the code my app shows is a code this server accepts" — and not
 * "the product agrees with itself". `nodeTotpEngine.test.ts` holds the production engine to the
 * RFC's vectors; this holds the whole stack to an engine that shares no line with it.
 *
 * What only this ring can show: the half-finished sign-in is not a session on the wire, and
 * `/api/site` is closed to a session that has not passed the factor on the binary CI ships.
 * That the factor survives a rotation of `SESSION_SECRET` on the same database is held in
 * `src/main/container.test.ts`, because this fixture gives every server a database of its own.
 */

type Json = Record<string, unknown>

/** The `error.code` of a failure body, or `undefined`. */
const codeOf = (body: Json | null): unknown => (body?.['error'] as Json | undefined)?.['code']

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const base32 = (text: string): Buffer => {
  let bits = ''
  for (const character of text.replace(/=+$/, '')) {
    bits += ALPHABET.indexOf(character).toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(parseInt(bits.slice(at, at + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 with HMAC-SHA1, thirty seconds, six digits, from the RFC's own text. */
const totp = (secret: Buffer, step: number): string => {
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

const currentStep = (): number => Math.floor(Date.now() / 1000 / 30)

const MFA_KEY = Buffer.alloc(32, 7).toString('base64')
const HOSTED = {
  SITE_ADMIN: 'on',
  REQUIRE_OPERATOR_2FA: 'true',
  MFA_ENCRYPTION_KEY: MFA_KEY,
}

/** A browser's worth of cookies and the CSRF token, talking to the server over `fetch`. */
const aBrowser = async (app: TestApp) => {
  const jar = new Map<string, string>()
  const remember = (response: Response): void => {
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';')
      const at = pair?.indexOf('=') ?? -1
      if (pair !== undefined && at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }
  const cookies = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  remember(await fetch(app.url('/api/auth/me')))

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await fetch(app.url(path), {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': decodeURIComponent(jar.get('es_csrf') ?? ''),
        cookie: cookies(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    remember(response)
    const text = await response.text()
    return {
      status: response.status,
      body: text.length === 0 ? null : (JSON.parse(text) as Json),
    }
  }
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body),
    signIn: () =>
      call('POST', '/api/auth/login', {
        email: app.owner.email,
        // The fixture rotated the bootstrap password once at boot.
        password: OWNER_SETTLED_PASSWORD,
      }),
  }
}

test.describe('the operator’s second factor', () => {
  test.describe.configure({ mode: 'serial' })

  let app: TestApp
  let secret: Buffer
  let recoveryCodes: string[]
  const NEVER_A_SITE_ROUTE = '/api/site/__never-a-route__'

  test.beforeAll(async (_fixtures, testInfo) => {
    app = await startTestApp({ worker: testInfo.workerIndex, env: HOSTED })
  })

  test.afterAll(async () => {
    await app.dispose()
  })

  test('refuses /api/site to an operator who has not passed the second factor', async () => {
    const operator = await aBrowser(app)
    expect((await operator.signIn()).status).toBe(200)

    const response = await operator.get(NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(403)
    expect(codeOf(response.body)).toBe('auth.secondFactorRequired')
  })

  test('enrols with the app’s code, and then /api/site answers as it does anywhere else', async () => {
    const operator = await aBrowser(app)
    await operator.signIn()

    const started = await operator.post('/api/auth/2fa/enroll', {
      password: OWNER_SETTLED_PASSWORD,
    })
    expect(started.status).toBe(200)
    secret = base32(started.body?.['secret'] as string)
    const confirmed = await operator.post('/api/auth/2fa/confirm', {
      code: totp(secret, currentStep()),
    })
    recoveryCodes = confirmed.body?.['recoveryCodes'] as string[]

    expect(confirmed.status).toBe(200)
    expect(recoveryCodes).toHaveLength(10)
    expect((await operator.get(NEVER_A_SITE_ROUTE)).status).toBe(404)
  })

  test('asks the next sign-in for a code, and the half-finished one is no session', async () => {
    const operator = await aBrowser(app)

    const challenge = await operator.signIn()
    const midway = await operator.get(NEVER_A_SITE_ROUTE)
    const me = await operator.get('/api/auth/me')

    expect(challenge.body).toEqual({ secondFactorRequired: true })
    expect(midway.status).toBe(401)
    expect(me.body).toEqual({ authenticated: false })
  })

  test('lets the code in once, and refuses the same code on the next sign-in (a replay)', async () => {
    // Three steps are spent in this file in order, which the window allows without waiting:
    // the enrolment spent the current one, so the next uses the step after it.
    const code = totp(secret, currentStep() + 1)
    const first = await aBrowser(app)
    await first.signIn()
    const accepted = await first.post('/api/auth/login/2fa', { code })

    const second = await aBrowser(app)
    await second.signIn()
    const replay = await second.post('/api/auth/login/2fa', { code })

    expect(accepted.status).toBe(200)
    expect((await first.get(NEVER_A_SITE_ROUTE)).status).toBe(404)
    expect(replay.status).toBe(401)
    expect(codeOf(replay.body)).toBe('auth.invalidSecondFactor')
  })

  test('lets a recovery code in once', async () => {
    const used = await aBrowser(app)
    await used.signIn()
    const accepted = await used.post('/api/auth/login/2fa', { recoveryCode: recoveryCodes[0] })

    const again = await aBrowser(app)
    await again.signIn()
    const refused = await again.post('/api/auth/login/2fa', { recoveryCode: recoveryCodes[0] })

    expect(accepted.status).toBe(200)
    expect(refused.status).toBe(401)
  })
})
