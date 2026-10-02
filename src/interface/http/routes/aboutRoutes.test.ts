import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { TEST_SESSION_SECRET } from '../testing/middlewareHarness'
import { anUnusableSessionStore, buildServerHarness } from '../testing/serverHarness'
import { AT, aUser } from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeRequestPasswordReset } from '../../../application/usecases/auth/requestPasswordReset'
import { asUserId } from '../../../domain/shared/ids'
import type { Logger } from '../../../application/ports/logger'

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

const DONATE_URL = 'https://opencollective.com/eventslide'
const BUDGET_URL = 'https://opencollective.com/eventslide/budget'

/** Every link unset, as on a box whose operator configured none. */
const NO_LINKS = {
  donate: null,
  budget: null,
  terms: null,
  privacy: null,
  legalNotice: null,
  support: null,
  report: null,
} as const
type LinkFacts = { -readonly [K in keyof typeof NO_LINKS]: string | null }

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

/**
 * An `es_session` cookie the session middleware will accept as its own.
 *
 * Signed with the harness's secret exactly as `express-session` signs one (`s:` and the
 * id, a dot, and the unpadded base64 HMAC-SHA256). **It has to be valid to prove anything.**
 * A cookie whose signature does not verify is discarded before the store is asked, so a
 * made-up one would make the store irrelevant and every ordering test built on it vacuous
 * — it would pass wherever the route was mounted.
 */
const signedSessionCookie = (sid: string): string => {
  const mac = createHmac('sha256', TEST_SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '')
  return `es_session=${encodeURIComponent(`s:${sid}.${mac}`)}`
}

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
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
      .set('Cookie', signedSessionCookie('a-session-id-the-store-would-have-to-read'))

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
      features: { siteAdmin: false, forgotPassword: false },
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
      .set('Cookie', `${signedSessionCookie('some-session')}; es_csrf=anything`)

    expect(stale.body).toEqual(anonymous.body)
  })

  /**
   * The optional support links (roadmap G4-02). The rule is that a link is **on the wire
   * only when the operator set it**: an instance that asks for nothing answers `links: {}`,
   * so a self-hosted box has no key a client could render, and none that says `null`.
   */
  describe('links', () => {
    const linksOf = async (links: Partial<LinkFacts>) =>
      (
        await request(
          buildServerHarness({ about: { ...about, links: { ...NO_LINKS, ...links } } }).app,
        ).get('/api/about')
      ).body.links as Record<string, unknown>

    it('is an empty object when the operator set neither link', async () => {
      expect(await linksOf({ donate: null, budget: null })).toEqual({})
    })

    it('carries links.donate when DONATION_URL is set, and no budget key', async () => {
      const links = await linksOf({ donate: DONATE_URL, budget: null })

      expect(links).toEqual({ donate: DONATE_URL })
      expect(Object.keys(links)).not.toContain('budget')
    })

    it('carries links.budget when BUDGET_URL is set, and no donate key', async () => {
      const links = await linksOf({ donate: null, budget: BUDGET_URL })

      expect(links).toEqual({ budget: BUDGET_URL })
      expect(Object.keys(links)).not.toContain('donate')
    })

    it('carries both when both are set', async () => {
      expect(await linksOf({ donate: DONATE_URL, budget: BUDGET_URL })).toEqual({
        donate: DONATE_URL,
        budget: BUDGET_URL,
      })
    })

    it('never says null for an unset link: absent and null are different statements to a client', async () => {
      // `"donate": null` is a key a client has to know to skip, and `if ("donate" in links)`
      // would then render a button with no address.
      const links = await linksOf({ donate: null, budget: null })

      expect(JSON.stringify(links)).not.toContain('null')
      expect(Object.keys(links)).toEqual([])
    })

    it('is the same for every caller, so a donation link is not a per-visitor decision', async () => {
      const subject = buildServerHarness({
        about: { ...about, links: { ...NO_LINKS, donate: DONATE_URL } },
      })

      const anonymous = await request(subject.app).get('/api/about')
      const stale = await request(subject.app)
        .get('/api/about')
        .set('Cookie', `${signedSessionCookie('some-session')}; es_csrf=anything`)

      expect(stale.body.links).toEqual(anonymous.body.links)
      expect(setCookies(stale.headers)).toEqual([])
    })
  })

  /**
   * The operator's identity and the links they owe a visitor (roadmap G2-17 / P3-18): their
   * name and contact address, their terms, privacy policy and legal notice, a help page and
   * the place to report a piece of content. The same rule as the support links, applied
   * seven more times: **on the wire only when the operator set it**, so a self-hosted box
   * answers exactly what it always did.
   */
  describe('the operator (roadmap G2-17)', () => {
    const operatorOf = async (operator: { name: string; contactEmail: string | null } | null) =>
      (await request(buildServerHarness({ about: { ...about, operator } }).app).get('/api/about'))
        .body as Record<string, unknown>

    it('has no operator key at all on a box that named nobody', async () => {
      const body = await operatorOf(null)

      expect(Object.keys(body)).not.toContain('operator')
      expect(JSON.stringify(body)).not.toContain('null')
    })

    it('carries the name alone when the operator gave no address', async () => {
      const body = await operatorOf({ name: 'Les Photographes', contactEmail: null })

      expect(body['operator']).toEqual({ name: 'Les Photographes' })
    })

    it('carries the name and the address when both were given', async () => {
      const body = await operatorOf({
        name: 'Les Photographes',
        contactEmail: 'contact@hosted.example.org',
      })

      expect(body['operator']).toEqual({
        name: 'Les Photographes',
        contactEmail: 'contact@hosted.example.org',
      })
    })

    it('is the same for every caller', async () => {
      const subject = buildServerHarness({
        about: { ...about, operator: { name: 'Les Photographes', contactEmail: null } },
      })

      const anonymous = await request(subject.app).get('/api/about')
      const stale = await request(subject.app)
        .get('/api/about')
        .set('Cookie', `${signedSessionCookie('some-session')}; es_csrf=anything`)

      expect(stale.body.operator).toEqual(anonymous.body.operator)
      expect(setCookies(stale.headers)).toEqual([])
    })
  })

  describe('the legal and report links (roadmap G2-17)', () => {
    const LEGAL = {
      terms: 'https://hosted.example.org/legal/cgu',
      privacy: 'https://hosted.example.org/legal/confidentialite',
      legalNotice: '/legal/mentions',
      support: '/legal/avant-evenement',
      report: '/legal/signaler',
    } as const

    const linksOf = async (links: Partial<LinkFacts>) =>
      (
        await request(
          buildServerHarness({ about: { ...about, links: { ...NO_LINKS, ...links } } }).app,
        ).get('/api/about')
      ).body.links as Record<string, unknown>

    it.each(Object.entries(LEGAL))(
      'carries links.%s when it is set, and only that key',
      async (key, value) => {
        const links = await linksOf({ [key]: value })

        expect(links).toEqual({ [key]: value })
      },
    )

    it('carries every one of them next to the donation links when all are set', async () => {
      expect(await linksOf({ ...LEGAL, donate: DONATE_URL, budget: BUDGET_URL })).toEqual({
        ...LEGAL,
        donate: DONATE_URL,
        budget: BUDGET_URL,
      })
    })

    it('says nothing for a link left unset, which is every link on a stock box', async () => {
      expect(await linksOf({})).toEqual({})
    })

    it('publishes a path on this site as the path it is, not as an absolute address', async () => {
      // The hosted instance sets REPORT_URL=/legal/signaler. Expanding it to an origin here
      // would bake in whichever host the request happened to name.
      expect((await linksOf({ report: '/legal/signaler' }))['report']).toBe('/legal/signaler')
    })
  })

  /**
   * "Forgot your password?" is offered only where it can work (G2-08 / P3-09). A reset link
   * has to travel through the mailbox it proves control of, so a box with no relay has no
   * self-service reset and the sign-in page must not offer one. The flag is worth having only
   * if it cannot disagree with the route it stands for.
   */
  describe('features.forgotPassword', () => {
    const aboutWith = async (canDeliver: boolean) =>
      (await request(buildServerHarness({ about, mailer: { canDeliver } }).app).get('/api/about'))
        .body.features.forgotPassword

    it('is false on a box with no mail relay, which is what every self-hoster starts with', async () => {
      expect(await aboutWith(false)).toBe(false)
    })

    it('is true on a box that can mail', async () => {
      expect(await aboutWith(true)).toBe(true)
    })

    it.each([
      [true, 202],
      [false, 404],
    ])(
      'says forgotPassword=%s exactly when asking for a reset is answered %s',
      async (canDeliver, expected) => {
        const mailer = new FakeMailer()
        const users = new FakeUserRepository().seed(aUser({ id: 'user-1' }))
        const subject = buildServerHarness({
          about,
          mailer: { canDeliver },
          usecases: {
            requestPasswordReset: makeRequestPasswordReset({
              users,
              tokens: new FakeAccountTokenRepository().withAccounts(asUserId('user-1')),
              secrets: new FakeSecretTokens(),
              mailer: canDeliver ? mailer : { canDeliver: false, send: mailer.send.bind(mailer) },
              ids: new SequentialIdGenerator(),
              clock: new FakeClock(AT),
              logger: silent,
              publicUrl: 'https://photos.example.test',
            }),
          },
        })
        const agent = request.agent(subject.app)
        const first = await agent.get('/api/auth/me')
        const cookie = (first.headers['set-cookie'] as unknown as string[] | undefined)?.find(
          (value) => value.startsWith('es_csrf='),
        )
        const csrf = cookie?.slice('es_csrf='.length).split(';')[0] ?? ''

        const [about_, asked] = await Promise.all([
          agent.get('/api/about'),
          agent
            .post('/api/auth/password-reset/request')
            .set('x-csrf-token', csrf)
            .send({ email: 'hote@example.test' }),
        ])

        expect(about_.body.features.forgotPassword).toBe(canDeliver)
        expect(asked.status).toBe(expected)
      },
    )
  })

  describe('features.siteAdmin', () => {
    it('is false on a box that never set SITE_ADMIN', async () => {
      const response = await request(buildServerHarness({ about }).app).get('/api/about')

      expect(response.body.features).toEqual({ siteAdmin: false, forgotPassword: false })
    })

    it('is true when SITE_ADMIN is on', async () => {
      const response = await request(
        buildServerHarness({ about, config: { siteAdmin: true } }).app,
      ).get('/api/about')

      expect(response.body.features).toEqual({ siteAdmin: true, forgotPassword: false })
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
