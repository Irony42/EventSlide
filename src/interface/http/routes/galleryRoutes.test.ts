import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, aPhoto, aUser } from '../../../application/testing/builders'
import {
  browserAgent,
  buildGalleryHarness,
  CSRF_HEADER,
  GALA,
  GALA_OWNER,
  GALA_PHOTO,
  OWNER,
  PASSWORD,
  PENDING,
  PHOTO,
  WEDDING,
  WEDDING_SLUG,
  type GalleryHarness,
} from '../testing/galleryHarness'
import { CSRF_COOKIE } from '../middleware/csrf'
import { GALLERY_UNLOCK_COOKIE } from './galleryRoutes'

/**
 * The shared gallery at ring 4: the real server, the real HMAC signer, fakes behind them.
 *
 * Every security property the gallery states has a named case here — the neutral refusal,
 * the password and its cookie, the per-client and per-link limits, the signature and what
 * it binds, immediate revocation, the unpublished photograph, and the headers on every
 * response, refusals included.
 */

const HOUR = 60 * 60 * 1000
/** A well-formed token nobody issued. */
const UNKNOWN_TOKEN = 'Q'.repeat(43)

const setCookies = (response: request.Response): string[] => {
  const raw: unknown = response.headers['set-cookie']
  return Array.isArray(raw) ? raw.map(String) : []
}

const unlockCookieOf = (response: request.Response): string | undefined =>
  setCookies(response).find((value) => value.startsWith(`${GALLERY_UNLOCK_COOKIE}=`))

const expectGalleryHeaders = (response: request.Response): void => {
  expect(response.headers['referrer-policy']).toBe('no-referrer')
  expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
}

describe('the shared gallery over HTTP', () => {
  let subject: GalleryHarness

  beforeEach(async () => {
    subject = buildGalleryHarness()
    await subject.seedPhoto(aPhoto({ id: PHOTO, eventId: WEDDING, status: 'published' }))
    await subject.seedPhoto(aPhoto({ id: PENDING, eventId: WEDDING, status: 'pending' }))
  })

  const galleryPage = async (token: string, agent = request.agent(subject.app)) => {
    const response = await agent.get(`/api/gallery/${token}/photos`).expect(200)
    return response.body as {
      items: { id: string; previewUrl: string; viewUrl: string; downloadUrl: string }[]
      nextCursor: string | null
    }
  }

  describe('GET /api/gallery/:token', () => {
    it('opens the album of an available link', async () => {
      const { token, link } = subject.seedLink()

      const response = await request(subject.app).get(`/api/gallery/${token}`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        eventName: 'Camille & Sacha',
        photoCount: 1,
        expiresAt: link.expiresAt.toISOString(),
      })
      expect(response.body.archiveUrl).toMatch(
        new RegExp(`^/api/gallery-media/${link.id}/album[.]zip[?]e=\\d+&s=[A-Za-z0-9_-]{43}$`),
      )
      expect(response.body.theme).toMatchObject({ material: expect.any(String) })
    })

    it('tells no referrer, no crawler and no cache about the page', async () => {
      const { token } = subject.seedLink()

      const response = await request(subject.app).get(`/api/gallery/${token}`)

      expectGalleryHeaders(response)
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('answers every dead link with one refusal, byte for byte', async () => {
      // An unknown token, a malformed one, and every way a real link can die: the answers
      // must be indistinguishable, or the difference is an oracle for whoever holds a link.
      const expired = subject.seedLink({
        lifetimeDays: 1,
        createdAt: new Date(AT.getTime() - 25 * HOUR),
      })
      const revoked = subject.seedLink({ revokedAt: AT })
      const orphaned = subject.seedLink({ eventId: GALA, createdBy: GALA_OWNER })
      await subject.users.save(
        aUser({ id: GALA_OWNER, email: 'gala@example.test', disabledAt: AT }),
      )

      const answers = await Promise.all(
        ['short', UNKNOWN_TOKEN, expired.token, revoked.token, orphaned.token].map((token) =>
          request(subject.app).get(`/api/gallery/${token}`),
        ),
      )

      for (const response of answers) {
        expect(response.status).toBe(404)
        expect(response.text).toBe(answers[0]?.text)
        expectGalleryHeaders(response)
        expect(response.headers['cache-control']).toBe('no-store')
      }
      expect(answers[0]?.body.error.code).toBe('gallery.notAvailable')
    })

    it('says a purged event’s link is not available, like any other dead link', async () => {
      const { token } = subject.seedLink()
      await subject.events.delete(WEDDING)

      const response = await request(subject.app).get(`/api/gallery/${token}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('gallery.notAvailable')
    })

    it('asks for the password, and discloses nothing about the album before it', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })

      const response = await request(subject.app).get(`/api/gallery/${token}`)

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('gallery.passwordRequired')
      expect(response.text).not.toContain('Camille')
      expectGalleryHeaders(response)
    })
  })

  describe('POST /api/gallery/:token/unlock', () => {
    it('sets a short-lived, HttpOnly, SameSite=Strict cookie scoped to the gallery API', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })
      const { agent, csrf } = await browserAgent(subject)

      const response = await agent
        .post(`/api/gallery/${token}/unlock`)
        .set(CSRF_HEADER, csrf)
        .send({ password: PASSWORD })

      expect(response.status).toBe(204)
      const cookie = unlockCookieOf(response) ?? ''
      expect(cookie).toMatch(/; HttpOnly/)
      expect(cookie).toMatch(/; SameSite=Strict/)
      expect(cookie).toMatch(/; Path=\/api\/gallery(;|$)/)
      expect(cookie).toMatch(/; Max-Age=7200(;|$)/)
      expect(cookie).not.toMatch(/; Secure/)
      expect(cookie).not.toContain(encodeURIComponent(PASSWORD))
      expect(cookie).not.toContain(token)
    })

    it('marks the cookie Secure on a box behind TLS', async () => {
      const secure = buildGalleryHarness({ secureCookie: true })
      const { token } = secure.seedLink({ passwordHash: `hash:${PASSWORD}` })
      const { csrf } = await browserAgent(secure)

      // A cookie jar keeps a Secure cookie off plain http, so the CSRF pair is sent by hand.
      const response = await request(secure.app)
        .post(`/api/gallery/${token}/unlock`)
        .set('Cookie', `${CSRF_COOKIE}=${csrf}`)
        .set(CSRF_HEADER, csrf)
        .send({ password: PASSWORD })

      expect(unlockCookieOf(response)).toMatch(/; Secure/)
    })

    it('opens the album for the browser that entered the password, and for no other', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })
      const { agent, csrf } = await browserAgent(subject)
      await agent
        .post(`/api/gallery/${token}/unlock`)
        .set(CSRF_HEADER, csrf)
        .send({ password: PASSWORD })

      expect((await agent.get(`/api/gallery/${token}`)).status).toBe(200)
      expect((await agent.get(`/api/gallery/${token}/photos`)).status).toBe(200)
      expect((await request(subject.app).get(`/api/gallery/${token}`)).status).toBe(401)
    })

    it('refuses the wrong password and sets no cookie', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })
      const { agent, csrf } = await browserAgent(subject)

      const response = await agent
        .post(`/api/gallery/${token}/unlock`)
        .set(CSRF_HEADER, csrf)
        .send({ password: 'les mariés de juillet' })

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('gallery.wrongPassword')
      expect(unlockCookieOf(response)).toBeUndefined()
      expectGalleryHeaders(response)
    })

    it('refuses a password posted without the CSRF token', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })

      const response = await request(subject.app)
        .post(`/api/gallery/${token}/unlock`)
        .send({ password: PASSWORD })

      expect(response.status).toBe(403)
      expect(subject.hasher.verifications).toEqual([])
    })

    it('answers a dead link with the gallery’s own refusal, not with a password prompt', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}`, revokedAt: AT })
      const { agent, csrf } = await browserAgent(subject)

      const response = await agent
        .post(`/api/gallery/${token}/unlock`)
        .set(CSRF_HEADER, csrf)
        .send({ password: PASSWORD })

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('gallery.notAvailable')
    })

    it('refuses a body with no password as malformed', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })
      const { agent, csrf } = await browserAgent(subject)

      const response = await agent
        .post(`/api/gallery/${token}/unlock`)
        .set(CSRF_HEADER, csrf)
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    describe('the limits on guessing', () => {
      it('stops one client after its allowance of failed attempts, right password or not', async () => {
        const limited = buildGalleryHarness({
          rateLimits: { ...limits(), galleryUnlockPerClient: 2 },
        })
        const { token } = limited.seedLink({ passwordHash: `hash:${PASSWORD}` })
        const { agent, csrf } = await browserAgent(limited)
        const attempt = (password: string) =>
          agent.post(`/api/gallery/${token}/unlock`).set(CSRF_HEADER, csrf).send({ password })

        expect((await attempt('mauvais mot de passe 1')).status).toBe(401)
        expect((await attempt('mauvais mot de passe 2')).status).toBe(401)
        const third = await attempt(PASSWORD)

        expect(third.status).toBe(429)
        expect(third.body.error.code).toBe('gallery.tooManyAttempts')
      })

      it('does not count a successful unlock, so a whole family can open one album', async () => {
        const limited = buildGalleryHarness({
          rateLimits: { ...limits(), galleryUnlockPerClient: 2 },
        })
        const { token } = limited.seedLink({ passwordHash: `hash:${PASSWORD}` })
        const { agent, csrf } = await browserAgent(limited)

        for (let index = 0; index < 4; index += 1) {
          const response = await agent
            .post(`/api/gallery/${token}/unlock`)
            .set(CSRF_HEADER, csrf)
            .send({ password: PASSWORD })
          expect(response.status).toBe(204)
        }
      })

      it('stops a link after its allowance, whichever clients the attempts came from', async () => {
        const limited = buildGalleryHarness({
          trustProxyHops: 1,
          rateLimits: { ...limits(), galleryUnlockPerClient: 100, galleryUnlockPerLink: 2 },
        })
        const { token } = limited.seedLink({ passwordHash: `hash:${PASSWORD}` })
        const other = limited.seedLink({
          eventId: GALA,
          createdBy: GALA_OWNER,
          passwordHash: `hash:${PASSWORD}`,
        })
        const { agent, csrf } = await browserAgent(limited)
        const attempt = (link: string, client: string) =>
          agent
            .post(`/api/gallery/${link}/unlock`)
            .set(CSRF_HEADER, csrf)
            .set('X-Forwarded-For', client)
            .send({ password: 'mauvais mot de passe' })

        expect((await attempt(token, '203.0.113.1')).status).toBe(401)
        expect((await attempt(token, '203.0.113.2')).status).toBe(401)

        expect((await attempt(token, '203.0.113.3')).status).toBe(429)
        // Another link is its own allowance.
        expect((await attempt(other.token, '203.0.113.3')).status).toBe(401)
      })
    })
  })

  describe('GET /api/gallery/:token/photos', () => {
    it('lists the published photograph and never the pending one', async () => {
      const { token } = subject.seedLink()

      const page = await galleryPage(token)

      expect(page.items.map((item) => item.id)).toEqual([PHOTO])
      expect(page.nextCursor).toBeNull()
    })

    it('refuses a cursor the server did not seal, rather than failing on it', async () => {
      const { token } = subject.seedLink()

      const response = await request(subject.app).get(`/api/gallery/${token}/photos?cursor=abc`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('gallery.cursorInvalid')
    })

    it('asks for the password before listing a protected album', async () => {
      const { token } = subject.seedLink({ passwordHash: `hash:${PASSWORD}` })

      const response = await request(subject.app).get(`/api/gallery/${token}/photos`)

      expect(response.status).toBe(401)
    })

    it('has its own budget per client', async () => {
      const limited = buildGalleryHarness({ rateLimits: { ...limits(), galleryPerMinute: 1 } })
      const { token } = limited.seedLink()

      await request(limited.app).get(`/api/gallery/${token}`).expect(200)
      const second = await request(limited.app).get(`/api/gallery/${token}/photos`)

      expect(second.status).toBe(429)
    })
  })

  describe('GET /api/gallery-media/…', () => {
    it('downloads the full-resolution original as an attachment the server named', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      const response = await request(subject.app).get(item?.downloadUrl ?? '')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      expect(response.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="${WEDDING_SLUG}-[0-9a-f]+[.]jpg"$`),
      )
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expectGalleryHeaders(response)
      expect([...(response.body as Buffer)]).toEqual([7, 8, 9])
    })

    it('serves a grid tile inline, cacheable privately for no longer than its signature', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      const response = await request(subject.app).get(item?.previewUrl ?? '')

      expect(response.status).toBe(200)
      expect(response.headers['content-disposition']).toBe('inline')
      expect(response.headers['cache-control']).toBe('private, max-age=3600')
      expectGalleryHeaders(response)
    })

    it('carries the link’s id and never its token', async () => {
      const { token, link } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      expect(item?.downloadUrl).toContain(link.id)
      expect(item?.downloadUrl).not.toContain(token)
    })

    describe('a URL that does not verify', () => {
      const tampered: readonly (readonly [string, (url: string) => string])[] = [
        [
          'a flipped character in the signature',
          (url) => url.replace(/s=(.)/, (_m, c: string) => `s=${c === 'A' ? 'B' : 'A'}`),
        ],
        ['another photograph in the path', (url) => url.replace(PHOTO, PENDING)],
        ['another rendition in the path', (url) => url.replace('/original?', '/display?')],
        [
          'a later expiry',
          (url) => url.replace(/e=(\d+)/, (_m, e: string) => `e=${Number(e) + HOUR}`),
        ],
        ['no signature', (url) => url.replace(/&s=.*$/, '')],
        ['a signature that is not one', (url) => url.replace(/s=.*$/, 's=%27%3B--')],
      ]

      it.each(tampered)('refuses %s with the neutral refusal', async (_label, tamper) => {
        const { token } = subject.seedLink()
        const [item] = (await galleryPage(token)).items

        const response = await request(subject.app).get(tamper(item?.downloadUrl ?? ''))

        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('gallery.notAvailable')
        expectGalleryHeaders(response)
      })
    })

    it('refuses a signature minted for another link', async () => {
      // A gala guest with a working URL for their own album swaps in the wedding's link id.
      const wedding = subject.seedLink()
      const gala = subject.seedLink({ eventId: GALA, createdBy: GALA_OWNER })
      await subject.seedPhoto(aPhoto({ id: GALA_PHOTO, eventId: GALA, status: 'published' }))
      const [galaItem] = (await galleryPage(gala.token)).items

      const response = await request(subject.app).get(
        (galaItem?.downloadUrl ?? '').replace(gala.link.id, wedding.link.id),
      )

      expect(response.status).toBe(404)
    })

    it('refuses a correctly signed URL once its photograph is taken off the wall', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      subject.photos.seed(aPhoto({ id: PHOTO, eventId: WEDDING, status: 'hidden' }))

      expect((await request(subject.app).get(item?.downloadUrl ?? '')).status).toBe(404)
    })

    it('refuses every URL of a revoked link at once, not when its hour is up', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items
      await request(subject.app)
        .get(item?.previewUrl ?? '')
        .expect(200)

      await subject.shareLinks.revokeCurrent(WEDDING, subject.clock.now())

      expect((await request(subject.app).get(item?.previewUrl ?? '')).status).toBe(404)
      expect((await request(subject.app).get(item?.downloadUrl ?? '')).status).toBe(404)
    })

    it('refuses every URL of a link whose creator was switched off', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      await subject.users.save(aUser({ id: OWNER, email: 'hote@example.test', disabledAt: AT }))

      expect((await request(subject.app).get(item?.downloadUrl ?? '')).status).toBe(404)
    })

    it('refuses a URL whose hour has run out', async () => {
      const { token } = subject.seedLink()
      const [item] = (await galleryPage(token)).items

      subject.clock.advance(HOUR)

      expect((await request(subject.app).get(item?.downloadUrl ?? '')).status).toBe(404)
    })

    it('has its own budget per client', async () => {
      const limited = buildGalleryHarness({ rateLimits: { ...limits(), galleryMediaPerMinute: 1 } })
      await limited.seedPhoto(aPhoto({ id: PHOTO, eventId: WEDDING, status: 'published' }))
      const { token } = limited.seedLink()
      const page = (await request(limited.app).get(`/api/gallery/${token}/photos`).expect(200))
        .body as {
        items: { previewUrl: string; downloadUrl: string }[]
      }

      await request(limited.app)
        .get(page.items[0]?.previewUrl ?? '')
        .expect(200)
      const second = await request(limited.app).get(page.items[0]?.downloadUrl ?? '')

      expect(second.status).toBe(429)
    })
  })

  describe('GET /api/gallery-media/:linkId/album.zip', () => {
    it('streams the published album as a ZIP attachment named after the event', async () => {
      const { token } = subject.seedLink()
      const { archiveUrl } = (await request(subject.app).get(`/api/gallery/${token}`)).body as {
        archiveUrl: string
      }

      const response = await request(subject.app).get(archiveUrl)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/zip')
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${WEDDING_SLUG}-album.zip"`,
      )
      expect(response.headers['cache-control']).toBe('no-store')
      expectGalleryHeaders(response)
      // The recording archive writes one byte per entry: the published photograph only.
      expect(subject.archive.names).toHaveLength(1)
    })

    it('refuses an archive URL whose signature was altered', async () => {
      const { token } = subject.seedLink()
      const { archiveUrl } = (await request(subject.app).get(`/api/gallery/${token}`)).body as {
        archiveUrl: string
      }

      const response = await request(subject.app).get(
        archiveUrl.replace(/e=(\d+)/, (_m, e: string) => `e=${Number(e) + 1}`),
      )

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('gallery.notAvailable')
    })
  })
})

/** The harness defaults, for a test that lowers one of them. */
const limits = () => ({
  uploadPerMinute: 12,
  joinPerMinute: 20,
  loginPerMinute: 10,
  reactionPerMinute: 30,
  galleryPerMinute: 60,
  galleryMediaPerMinute: 600,
  galleryUnlockPerClient: 10,
  galleryUnlockPerLink: 50,
})
