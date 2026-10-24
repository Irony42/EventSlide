import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { aGuest, anEvent, anEventSettings } from '../../application/testing/builders'
import {
  makeAcknowledgePrivacyNotice,
  type AcknowledgePrivacyNotice,
} from '../../application/usecases/guests/acknowledgePrivacyNotice'
import { privacyNoticeFor } from '../../domain/privacy/privacyNotice'
import { ok } from '../../domain/shared/result'
import { GUEST_COOKIE } from './middleware/authz'
import { CSRF_COOKIE, CSRF_HEADER } from './middleware/csrf'
import { buildServerHarness, type ServerHarness } from './testing/serverHarness'
import { testHttpConfig } from './testing/middlewareHarness'
import { A_PATH_NOBODY_WROTE, csrfTokenFrom, setCookies } from './testing/signIn'

/**
 * Every write a guest's device token can make is rate-limited per client address **and**
 * per event, with the one 429 answer the rest of the API gives (HTTP-H-01).
 *
 * Through the real `buildServer`, because the thing under test is partly *where* the
 * limiter is mounted: it must sit ahead of `requireGuest` (a flood is dropped before it
 * costs a token verification), after the moderator hand-off on the shared `DELETE`, and
 * as **one** instance across two routers. Only the assembled server can see the last.
 *
 * The token is free - `POST /api/join` is public - and a caption edit is announced to every
 * screen that has the wall or a console open, so 300 consecutive edits of one pending
 * photograph were 300 x 204 and 300 signals before this existed.
 */

const SLUG = 'mariage'
const PHOTO = '11111111-1111-4111-8111-111111111111'

interface Write {
  readonly name: string
  readonly method: 'patch' | 'delete' | 'post'
  readonly path: string
  readonly body?: Record<string, unknown>
  /** What the route answers while the bucket has room. */
  readonly accepted: number
}

const revisionOf = privacyNoticeFor(anEventSettings({ retentionDays: 30 })).revision

const writesAt = (slug: string): readonly Write[] => [
  {
    name: 'a caption',
    method: 'patch',
    path: `/api/events/${slug}/photos/${PHOTO}/caption`,
    body: { caption: 'Les confettis' },
    accepted: 204,
  },
  {
    name: 'taking a photo back',
    method: 'delete',
    path: `/api/events/${slug}/photos/${PHOTO}`,
    accepted: 204,
  },
  {
    name: 'withdrawing a reaction',
    method: 'delete',
    path: `/api/events/${slug}/photos/${PHOTO}/reactions/love`,
    accepted: 204,
  },
  {
    name: 'acknowledging the privacy notice',
    method: 'post',
    path: `/api/events/${slug}/privacy-notice/acknowledgement`,
    body: { revision: revisionOf },
    accepted: 200,
  },
]

const [CAPTION, TAKE_BACK, WITHDRAW, ACKNOWLEDGE] = writesAt(SLUG) as [Write, Write, Write, Write]

interface Subject {
  readonly harness: ServerHarness
  /** A guest of `mariage`, and of `gala`, each with a real token. */
  readonly wedding: string
  readonly gala: string
}

const buildSubject = (guestWritePerMinute: number, trustProxyHops = 0): Subject => {
  let acknowledge: AcknowledgePrivacyNotice | undefined
  const harness = buildServerHarness({
    config: {
      trustProxyHops,
      rateLimits: { ...testHttpConfig().rateLimits, guestWritePerMinute },
    },
    // The use cases answer success: the subject is the limiter in front of them, and a 429
    // that is really a refusal from below would prove nothing.
    usecases: {
      setPhotoCaption: async () => ok(undefined),
      deletePhoto: async () => ok(undefined),
      withdrawReaction: async () => ok(undefined),
      acknowledgePrivacyNotice: async (input) => {
        if (acknowledge === undefined) throw new Error('acknowledge was used before it was built')
        return acknowledge(input)
      },
    },
  })
  acknowledge = makeAcknowledgePrivacyNotice({
    events: harness.events,
    clients: harness.clients,
    guests: harness.guests,
    clock: harness.clock,
    operatorName: null,
  })
  harness.events.seed(
    anEvent({
      id: 'event-wedding',
      slug: SLUG,
      joinCode: 'H7K2QM',
      settings: { retentionDays: 30 },
    }),
    anEvent({
      id: 'event-gala',
      slug: 'gala',
      joinCode: 'Z3N9PT',
      settings: { retentionDays: 30 },
    }),
  )
  harness.guests.seed(
    aGuest({ id: 'guest-lea', eventId: 'event-wedding' }),
    aGuest({ id: 'guest-lea', eventId: 'event-gala' }),
  )
  return {
    harness,
    wedding: harness.issueGuestToken('event-wedding', 'guest-lea'),
    gala: harness.issueGuestToken('event-gala', 'guest-lea'),
  }
}

interface Sender {
  (write: Write, as?: { readonly token?: string; readonly from?: string }): request.Test
}

/** A browser that holds the CSRF cookie, so a refusal a test reads is never the gate's. */
const browserOn = async (subject: Subject, defaultToken: string): Promise<Sender> => {
  const probe = await request(subject.harness.app).get(A_PATH_NOBODY_WROTE)
  const csrf = csrfTokenFrom(probe.headers)
  const csrfCookie = setCookies(probe.headers)
    .find((value) => value.startsWith(`${CSRF_COOKIE}=`))
    ?.split(';')[0]
  if (csrfCookie === undefined) throw new Error('the server issued no CSRF cookie')

  return (write, as = {}) => {
    const token = as.token ?? defaultToken
    const sent = request(subject.harness.app)
      [write.method](write.path)
      .set('Cookie', `${csrfCookie}; ${GUEST_COOKIE}=${token}`)
      .set(CSRF_HEADER, csrf)
    return (as.from === undefined ? sent : sent.set('X-Forwarded-For', as.from)).send(write.body)
  }
}

describe('the guest-token writes are rate-limited per client address and event (HTTP-H-01)', () => {
  it.each([CAPTION, TAKE_BACK, WITHDRAW, ACKNOWLEDGE].map((write) => [write.name, write] as const))(
    'refuses %s once the budget is spent, with the shared 429 and a Retry-After',
    async (_name, write) => {
      const subject = buildSubject(2)
      const send = await browserOn(subject, subject.wedding)

      expect((await send(write)).status).toBe(write.accepted)
      expect((await send(write)).status).toBe(write.accepted)
      const refused = await send(write)

      expect(refused.status).toBe(429)
      expect(refused.body.error.code).toBe('rate.limited')
      // docs/API.md section 1: "`Retry-After` is set". A client without it retries at once.
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    },
  )

  it('refuses the 301st caption in a minute at the default budget, where it took all 300 before', async () => {
    // The repro of the finding: 300 consecutive edits of one pending photograph by one guest
    // were 300 x 204, none refused, and 300 `photo.captionChanged` signals.
    const subject = buildSubject(testHttpConfig().rateLimits.guestWritePerMinute)
    const send = await browserOn(subject, subject.wedding)

    const statuses: number[] = []
    for (let n = 0; n < 301; n += 1) statuses.push((await send(CAPTION)).status)

    expect(statuses.slice(0, 300).every((status) => status === 204)).toBe(true)
    expect(statuses[300]).toBe(429)
  })

  it('spends one allowance across the four routes, not one each', async () => {
    // `express-rate-limit` mints a store per instance, so a limiter built inside each router
    // would hand a guest a whole budget per router. Only `buildServer` holds the one
    // instance - the acknowledgement lives in a different router from the other three.
    const subject = buildSubject(3)
    const send = await browserOn(subject, subject.wedding)

    expect((await send(CAPTION)).status).toBe(204)
    expect((await send(TAKE_BACK)).status).toBe(204)
    expect((await send(WITHDRAW)).status).toBe(204)

    expect((await send(ACKNOWLEDGE)).status).toBe(429)
    expect((await send(CAPTION)).status).toBe(429)
  })

  it('counts each event on its own, so a flood at one wedding spends nobody else allowance', async () => {
    const subject = buildSubject(1)
    const send = await browserOn(subject, subject.wedding)
    expect((await send(CAPTION)).status).toBe(204)
    expect((await send(CAPTION)).status).toBe(429)

    const [galaCaption] = writesAt('gala') as [Write, ...Write[]]
    const elsewhere = await send(galaCaption, { token: subject.gala })

    expect(elsewhere.status).toBe(204)
  })

  it('counts each client address on its own, so one guest cannot lock out the room', async () => {
    const subject = buildSubject(1, 1)
    const send = await browserOn(subject, subject.wedding)
    expect((await send(CAPTION, { from: '203.0.113.7' })).status).toBe(204)
    expect((await send(CAPTION, { from: '203.0.113.7' })).status).toBe(429)

    const another = await send(CAPTION, { from: '203.0.113.8' })

    expect(another.status).toBe(204)
  })

  it('does not spend a guest allowance on a moderator deleting a photo, who carries no guest cookie', async () => {
    // `DELETE /photos/:id` is two endpoints on one path: the guest's own photo and the
    // moderator's any photo. The moderator's request has no guest cookie, so the guest router
    // hands it on *before* the limiter - mounted above that hand-off, a host moderating a
    // busy album would be refused as if they were the guest flooding it.
    const subject = buildSubject(1)
    const send = await browserOn(subject, subject.wedding)
    expect((await send(TAKE_BACK)).status).toBe(204)
    expect((await send(TAKE_BACK)).status).toBe(429)
    const probe = await request(subject.harness.app).get(A_PATH_NOBODY_WROTE)
    const csrf = csrfTokenFrom(probe.headers)
    const csrfCookie = setCookies(probe.headers)
      .find((value) => value.startsWith(`${CSRF_COOKIE}=`))
      ?.split(';')[0]
    if (csrfCookie === undefined) throw new Error('the server issued no CSRF cookie')

    const moderator = await request(subject.harness.app)
      .delete(TAKE_BACK.path)
      .set('Cookie', csrfCookie)
      .set(CSRF_HEADER, csrf)

    // `requireRole` answers a caller with no session: the request reached the host's route.
    expect(moderator.status).toBe(401)
    expect(moderator.body.error.code).toBe('auth.required')
  })

  it('drops a flood before it costs a token verification, so a bad token spends the budget too', async () => {
    // The limiter runs ahead of `requireGuest` on purpose (the same arrangement as the
    // upload and reaction limiters): a flood carrying garbage in the cookie must be refused
    // by count, not answered 401 every time at the price of an HMAC check.
    const subject = buildSubject(1)
    const send = await browserOn(subject, 'not-a-token')

    expect((await send(CAPTION)).status).toBe(401)

    expect((await send(CAPTION)).status).toBe(429)
  })
})
