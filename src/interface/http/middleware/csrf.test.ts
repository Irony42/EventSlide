import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, requireCsrfToken } from './csrf'
import { buildHarness, type Harness } from '../testing/middlewareHarness'

const harness = (secureCookie = false): Harness =>
  buildHarness({
    config: { secureCookie },
    routes: (app) => {
      app.use(issueCsrfToken({ secureCookie }))
      app.get('/read', (_req, res) => {
        res.json({ ok: true })
      })
      // The same read, but behind the gate — which is how `server.ts` mounts it, on
      // `/api` ahead of every router. Without a route wired this way nothing exercises
      // the safe-method exemption itself.
      app.get('/guarded-read', requireCsrfToken, (_req, res) => {
        res.json({ ok: true })
      })
      app.post('/write', requireCsrfToken, (_req, res) => {
        res.status(204).end()
      })
      app.delete('/write', requireCsrfToken, (_req, res) => {
        res.status(204).end()
      })
    },
  })

/**
 * `set-cookie` is the one header that can legitimately repeat, so Node gives it as an
 * array — but supertest's types declare every header as a string. Narrowing through
 * `unknown` gets the real shape with no cast and no `any`.
 */
const setCookies = (headers: Readonly<Record<string, string>>): string[] => {
  const raw: unknown = headers['set-cookie']
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string')
  return typeof raw === 'string' ? [raw] : []
}

const tokenFrom = (headers: Readonly<Record<string, string>>): string => {
  const header = setCookies(headers).find((value) => value.startsWith(`${CSRF_COOKIE}=`))
  if (header === undefined) throw new Error('no CSRF cookie was issued')
  const value = header.slice(`${CSRF_COOKIE}=`.length).split(';')[0]
  if (value === undefined || value.length === 0) throw new Error('CSRF cookie was empty')
  return decodeURIComponent(value)
}

describe('issueCsrfToken', () => {
  it('issues a token on a first visit', async () => {
    const response = await request(harness().app).get('/read')

    expect(tokenFrom(response.headers).length).toBeGreaterThan(20)
  })

  it('issues it readable, because the client has to echo it back', async () => {
    // Deliberately not HttpOnly. The value is not a credential on its own — it is
    // proof that the caller can read this origin's cookies, which an attacker's page
    // cannot do.
    const response = await request(harness().app).get('/read')
    const header = setCookies(response.headers).join(';')

    expect(header.toLowerCase()).not.toContain('httponly')
    expect(header.toLowerCase()).toContain('samesite=lax')
  })

  it('marks the cookie Secure when configured for HTTPS', async () => {
    const response = await request(harness(true).app).get('/read')

    expect(setCookies(response.headers).join(';').toLowerCase()).toContain('secure')
  })

  it('does not reissue a token the client already holds', async () => {
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    const second = await request(subject.app).get('/read').set('Cookie', `${CSRF_COOKIE}=${token}`)

    expect(setCookies(second.headers)).toEqual([])
  })
})

describe('requireCsrfToken', () => {
  it('lets a read through without any token', async () => {
    // The projector holds nothing and the join page is reached from a QR scan. The gate
    // is mounted in front of every `/api` route, public ones included, so a gate that
    // demanded a token on a read would break both surfaces.
    //
    // `/guarded-read`, not `/read`: this test used to request the route the harness
    // wires with `issueCsrfToken` alone, so it sat under `requireCsrfToken` while
    // asserting nothing about it — which is how the safe-method branch stayed uncovered
    // while this file read as complete.
    await request(harness().app).get('/guarded-read').expect(200)
  })

  it('exempts HEAD as well as GET, since a HEAD changes nothing either', async () => {
    // Express answers a HEAD from the GET route, so this reaches the same handler with
    // the method the gate has to recognise on its own.
    await request(harness().app).head('/guarded-read').expect(200)
  })

  it('accepts a write whose header matches the cookie', async () => {
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    await request(subject.app)
      .post('/write')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set(CSRF_HEADER, token)
      .expect(204)
  })

  it('refuses a write with the cookie but no header — the cross-site case', async () => {
    // An attacker's page can make the browser send the cookie. It cannot read the
    // value, so it cannot set the header. That asymmetry is the whole mechanism.
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    const response = await request(subject.app)
      .post('/write')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
  })

  it('refuses a write with a header but no cookie', async () => {
    const response = await request(harness().app).post('/write').set(CSRF_HEADER, 'anything')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
  })

  it('refuses a write whose header does not match the cookie', async () => {
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    const response = await request(subject.app)
      .post('/write')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set(CSRF_HEADER, 'a-different-value-of-the-same-length!!')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMismatch')
  })

  it('refuses a header of the right value but the wrong length', async () => {
    // Length is compared before the constant-time comparison, which throws on a
    // mismatch. The token is fixed-size, so length leaks nothing.
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    const response = await request(subject.app)
      .post('/write')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set(CSRF_HEADER, token.slice(0, -1))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMismatch')
  })

  it('guards every unsafe method, not just POST', async () => {
    const subject = harness()
    const first = await request(subject.app).get('/read')
    const token = tokenFrom(first.headers)

    await request(subject.app).delete('/write').set('Cookie', `${CSRF_COOKIE}=${token}`).expect(403)

    await request(subject.app)
      .delete('/write')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set(CSRF_HEADER, token)
      .expect(204)
  })
})
