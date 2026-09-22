import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, aGuest, anEvent, anEventSettings } from '../../../application/testing/builders'
import { makeAcknowledgePrivacyNotice } from '../../../application/usecases/guests/acknowledgePrivacyNotice'
import { makeGetPrivacyNotice } from '../../../application/usecases/guests/getPrivacyNotice'
import { privacyNoticeFor } from '../../../domain/privacy/privacyNotice'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { GUEST_COOKIE } from '../middleware/authz'
import { buildHarness, type Harness } from '../testing/middlewareHarness'
import { privacyNoticeRoutes } from './privacyNoticeRoutes'

/**
 * The privacy notice's two routes, through a real Express app, the real `requireGuest`
 * and a real HMAC token, over the in-memory fakes.
 *
 * Two events and three guests in every test, because the case that catches real incidents
 * is the one where a token, a guest id or an acknowledgement crosses from one of them to
 * another.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const LEA = 'guest-lea'
const SACHA = 'guest-sacha'
const REVOKED = 'guest-revoked'

const NOTICE = '/api/events/mariage/privacy-notice'
const ACKNOWLEDGE = `${NOTICE}/acknowledgement`

/** What the wedding is configured to say, before any test changes it. */
const WEDDING_NOTICE = privacyNoticeFor(anEventSettings({ retentionDays: 30 }))

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

let harness: Harness

beforeEach(() => {
  harness = buildHarness({
    routes: (app, deps) => {
      app.use(
        '/api',
        privacyNoticeRoutes({
          deps,
          usecases: {
            getPrivacyNotice: makeGetPrivacyNotice({ events: deps.events, guests: deps.guests }),
            acknowledgePrivacyNotice: makeAcknowledgePrivacyNotice({
              events: deps.events,
              guests: deps.guests,
              clock: deps.clock,
            }),
          },
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', settings: { retentionDays: 30 } }),
    anEvent({ id: GALA, slug: 'gala', joinCode: 'Z3N9PT', settings: { retentionDays: null } }),
  )
  harness.guests.seed(
    aGuest({ id: LEA, eventId: WEDDING }),
    aGuest({ id: SACHA, eventId: WEDDING }),
    aGuest({ id: REVOKED, eventId: WEDDING, revokedAt: AT }),
    aGuest({ id: LEA, eventId: GALA }),
  )
})

const lea = (): string => cookie(harness.issueGuestToken(WEDDING, LEA))

/** The host saving a different retention period, as `updateEventSettings` would. */
const hostKeepsTheAlbumForever = async (): Promise<void> => {
  const wedding = await harness.events.findById(asEventId(WEDDING))
  const changed = wedding?.withSettings(anEventSettings({ retentionDays: null }))
  if (changed === undefined || !changed.ok) throw new Error('test setup: settings refused')
  await harness.events.save(changed.value)
}

// --------------------------------------------------------------------- read --

describe('GET /api/events/:slug/privacy-notice', () => {
  it('answers the notice the event is configured to give, not yet read', async () => {
    const response = await request(harness.app).get(NOTICE).set('Cookie', lea())

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      notice: {
        revision: WEDDING_NOTICE.revision,
        publication: 'afterReview',
        audiences: ['room', 'organisers'],
        retentionDays: 30,
        selfRemovalSeconds: 900,
      },
      acknowledgement: 'none',
    })
  })

  it('is never cached, because it is the read that tells a guest the host changed something', async () => {
    const response = await request(harness.app).get(NOTICE).set('Cookie', lea())

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers 401 without a device token', async () => {
    const response = await request(harness.app).get(NOTICE)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('refuses a token from another event, so one party cannot read the other’s notice', async () => {
    const response = await request(harness.app)
      .get(NOTICE)
      .set('Cookie', cookie(harness.issueGuestToken(GALA, LEA)))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.wrongEvent')
  })

  it('refuses a guest the host removed', async () => {
    const response = await request(harness.app)
      .get(NOTICE)
      .set('Cookie', cookie(harness.issueGuestToken(WEDDING, REVOKED)))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.revoked')
  })
})

// ------------------------------------------------------------ acknowledge --

describe('POST /api/events/:slug/privacy-notice/acknowledgement', () => {
  it('records that this device read the notice, and says so', async () => {
    const response = await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    expect(response.status).toBe(200)
    expect(response.body.acknowledgement).toBe('current')
    expect(
      (await harness.guests.findById(asEventId(WEDDING), asGuestId(LEA)))?.noticeAcknowledgement,
    ).toEqual({ revision: WEDDING_NOTICE.revision, at: AT })
  })

  it('is not shown again to the same device once read', async () => {
    await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    const response = await request(harness.app).get(NOTICE).set('Cookie', lea())

    expect(response.body.acknowledgement).toBe('current')
  })

  it('is shown again once the host changes the retention period', async () => {
    await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    await hostKeepsTheAlbumForever()
    const response = await request(harness.app).get(NOTICE).set('Cookie', lea())

    expect(response.body.acknowledgement).toBe('outdated')
    expect(response.body.notice.retentionDays).toBeNull()
  })

  it('answers 409 when the host changed the notice while the guest was reading it', async () => {
    await hostKeepsTheAlbumForever()

    const response = await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('privacyNotice.outdated')
    expect(
      (await harness.guests.findById(asEventId(WEDDING), asGuestId(LEA)))?.noticeAcknowledgement,
    ).toBeNull()
  })

  it('records the acknowledgement against the token’s guest only, never a neighbour’s', async () => {
    await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    const sacha = await request(harness.app)
      .get(NOTICE)
      .set('Cookie', cookie(harness.issueGuestToken(WEDDING, SACHA)))

    expect(sacha.body.acknowledgement).toBe('none')
  })

  it('leaves the same guest id at another event unread', async () => {
    // `guest-lea` exists at both parties. The acknowledgement is scoped by the event the
    // token names, so reading the wedding's notice says nothing about the gala's.
    await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', lea())
      .send({ revision: WEDDING_NOTICE.revision })

    expect(
      (await harness.guests.findById(asEventId(GALA), asGuestId(LEA)))?.noticeAcknowledgement,
    ).toBeNull()
  })

  it('answers 401 without a device token', async () => {
    const response = await request(harness.app)
      .post(ACKNOWLEDGE)
      .send({ revision: WEDDING_NOTICE.revision })

    expect(response.status).toBe(401)
  })

  it('refuses a token from another event', async () => {
    const response = await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', cookie(harness.issueGuestToken(GALA, LEA)))
      .send({ revision: WEDDING_NOTICE.revision })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.wrongEvent')
  })

  it('refuses a guest the host removed', async () => {
    const response = await request(harness.app)
      .post(ACKNOWLEDGE)
      .set('Cookie', cookie(harness.issueGuestToken(WEDDING, REVOKED)))
      .send({ revision: WEDDING_NOTICE.revision })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.revoked')
  })

  it.each([
    { given: 'no revision', body: {} },
    { given: 'an empty revision', body: { revision: '' } },
    { given: 'a revision that is not text', body: { revision: 30 } },
    { given: 'a key the contract does not have', body: { revision: 'r', guestId: SACHA } },
  ])('answers 400 for $given', async ({ body }) => {
    const response = await request(harness.app).post(ACKNOWLEDGE).set('Cookie', lea()).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})
