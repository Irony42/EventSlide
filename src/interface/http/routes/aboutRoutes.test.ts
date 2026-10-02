import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { anUnusableSessionStore, buildServerHarness } from '../testing/serverHarness'

/**
 * Ring 4. `GET /api/about`: what this box is, which licence it is under, and **where its
 * source is** (roadmap G1-04 / P1-05).
 *
 * The last of those is the point. AGPL section 13 obliges a network service to offer the
 * corresponding source to the people using it, and this endpoint is the machine-readable
 * half of that offer — the other half is the link the SPA renders from it. So the contract
 * that matters is not a field list but three promises: anybody can read it (no session, no
 * token, nothing to sign in to), reading it costs the box nothing (no cookie, no session
 * row), and the answer is the real one (the version of the running build, the operator's
 * own link when they set one, the real state of the operator's switch).
 *
 * Mounted beside `/api/health`, ahead of the body parser, the session and the CSRF gate,
 * for the reason health is: the first visit of a guest's phone loads it, and a phone with
 * no cookie jar must be answered the same way as one with a stale `es_session`.
 */

const SOURCE_URL = 'https://git.example.org/me/eventslide/tree/v2.0.0-test'

const about = { version: '2.0.0-test', sourceUrl: SOURCE_URL }

/**
 * `set-cookie` is the one header that can legitimately repeat, so Node gives it as an
 * array while supertest's types declare every header as a string. Narrowing through
 * `unknown` gets the real shape with no cast and no `any`.
 */
const setCookies = (headers: Readonly<Record<string, string>>): string[] => {
  const raw: unknown = headers['set-cookie']
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string')
  return typeof raw === 'string' ? [raw] : []
}

describe('GET /api/about', () => {
  it('answers 200 to a caller with no session, no cookie and no CSRF token', async () => {
    const response = await request(buildServerHarness({ about }).app).get('/api/about')

    expect(response.status).toBe(200)
    expect(response.type).toBe('application/json')
  })

  it('sets no cookie at all, so a visit is not a session row and not a CSRF token either', async () => {
    // `saveUninitialized: false` already keeps `es_session` away from an anonymous GET
    // whichever side of the session middleware this is mounted on — so asserting that
    // cookie alone would stay green if the route moved behind it. The CSRF issuer is the
    // middleware that does write a cookie on every ordinary GET, which is what makes
    // "no Set-Cookie header at all" a statement about the mount point.
    const response = await request(buildServerHarness({ about }).app).get('/api/about')

    expect(setCookies(response.headers)).toEqual([])
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('is answered while the session store is unusable, because it never consults it', async () => {
    // The ordering claim in `server.ts`, made observable the way `/api/health`'s is: a
    // browser still holding an `es_session` would have this request answered by way of the
    // store if the route sat behind the session middleware, and a locked SQLite file would
    // then take the source offer down with it.
    const subject = buildServerHarness({ about, sessionStore: anUnusableSessionStore() })

    const response = await request(subject.app)
      .get('/api/about')
      .set('Cookie', 'es_session=s%3Aa-stale-session-id.signature')

    expect(response.status).toBe(200)
  })

  it('answers with exactly the documented shape, and nothing more', async () => {
    const response = await request(buildServerHarness({ about }).app).get('/api/about')

    expect(response.body).toEqual({
      name: 'EventSlide',
      version: '2.0.0-test',
      license: 'AGPL-3.0-only',
      sourceUrl: SOURCE_URL,
      links: {},
      features: { siteAdmin: false },
    })
  })

  it('reports the licence package.json declares, so the two cannot be edited apart', async () => {
    const manifest: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const declared =
      typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'license') : null

    const response = await request(buildServerHarness({ about }).app).get('/api/about')

    expect(response.body.license).toBe(declared)
  })

  it('offers the source link the composition root resolved, whatever it is', async () => {
    const operators = 'https://code.example.net/our-fork/eventslide/tree/main'

    const response = await request(
      buildServerHarness({ about: { version: '2.0.0-test', sourceUrl: operators } }).app,
    ).get('/api/about')

    expect(response.body.sourceUrl).toBe(operators)
  })

  it('reports the version of the build, which is the one /api/health reports', async () => {
    const subject = buildServerHarness({ about: { ...about, version: '4.5.6' } })
    subject.health.version = '4.5.6'

    const [aboutResponse, healthResponse] = await Promise.all([
      request(subject.app).get('/api/about'),
      request(subject.app).get('/api/health'),
    ])

    expect(aboutResponse.body.version).toBe('4.5.6')
    expect(aboutResponse.body.version).toBe(healthResponse.body.version)
  })

  it('may be cached by a shared cache for five minutes, because it is the same for everybody', async () => {
    const response = await request(buildServerHarness({ about }).app).get('/api/about')

    expect(response.headers['cache-control']).toBe('public, max-age=300')
  })

  it('has no per-caller variation: a signed-out visitor and a stale cookie read the same body', async () => {
    const subject = buildServerHarness({ about })

    const anonymous = await request(subject.app).get('/api/about')
    const stale = await request(subject.app)
      .get('/api/about')
      .set('Cookie', 'es_session=s%3Aa-stale-session-id.signature; es_csrf=anything')

    expect(stale.body).toEqual(anonymous.body)
  })

  describe('features.siteAdmin', () => {
    it('is false on a box that never set SITE_ADMIN', async () => {
      const response = await request(buildServerHarness({ about }).app).get('/api/about')

      expect(response.body.features).toEqual({ siteAdmin: false })
    })

    it('is true when SITE_ADMIN is on', async () => {
      const response = await request(
        buildServerHarness({ about, config: { siteAdmin: true } }).app,
      ).get('/api/about')

      expect(response.body.features).toEqual({ siteAdmin: true })
    })

    it.each([
      [true, 401],
      [false, 404],
    ])(
      'says siteAdmin=%s exactly when /api/site is mounted (anonymous caller sees %s there)',
      async (siteAdmin, siteStatus) => {
        // The flag is the SPA's way of learning the mode without probing the namespace, so
        // it is only worth having if it cannot disagree with the mount. Both are derived
        // from `config.siteAdmin` inside `buildServer`; this is the observation of that.
        const subject = buildServerHarness({ about, config: { siteAdmin } })

        const [aboutResponse, siteResponse] = await Promise.all([
          request(subject.app).get('/api/about'),
          request(subject.app).get('/api/site/anything'),
        ])

        expect(aboutResponse.body.features.siteAdmin).toBe(siteAdmin)
        expect(siteResponse.status).toBe(siteStatus)
      },
    )
  })
})
