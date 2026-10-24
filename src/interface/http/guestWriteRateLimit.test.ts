import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT, aGuest, anEvent, anEventSettings, aUser } from '../../application/testing/builders'
import {
  makeAcknowledgePrivacyNotice,
  type AcknowledgePrivacyNotice,
} from '../../application/usecases/guests/acknowledgePrivacyNotice'
import { makeRenameGuest, type RenameGuest } from '../../application/usecases/guests/renameGuest'
import { privacyNoticeFor } from '../../domain/privacy/privacyNotice'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { ok } from '../../domain/shared/result'
import { GUEST_COOKIE } from './middleware/authz'
import { CSRF_COOKIE, CSRF_HEADER } from './middleware/csrf'
import { testHttpConfig } from './testing/middlewareHarness'
import { mountedRoutes } from './testing/routeTable'
import { buildServerHarness, type ServerHarness } from './testing/serverHarness'
import {
  A_PATH_NOBODY_WROTE,
  csrfTokenFrom,
  setCookies,
  signedInAs,
  signInByAddress,
} from './testing/signIn'
import type { HttpConfig } from './types'

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
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MODERATOR_EMAIL = 'moderateur@example.test'

interface Write {
  readonly name: string
  readonly method: 'patch' | 'delete' | 'post' | 'put'
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
  {
    name: 'renaming oneself',
    method: 'patch',
    path: `/api/events/${slug}/guests/${LEA}`,
    body: { displayName: 'Léa D.' },
    accepted: 200,
  },
]

const [CAPTION, TAKE_BACK, WITHDRAW, ACKNOWLEDGE, RENAME] = writesAt(SLUG) as [
  Write,
  Write,
  Write,
  Write,
  Write,
]
const GUEST_WRITES = [CAPTION, TAKE_BACK, WITHDRAW, ACKNOWLEDGE, RENAME].map(
  (write) => [write.name, write] as const,
)

interface Subject {
  readonly harness: ServerHarness
  /** A guest of `mariage`, and of `gala`, each with a real token. */
  readonly wedding: string
  readonly gala: string
}

const buildSubject = (
  guestWritePerMinute: number,
  trustProxyHops = 0,
  otherLimits: Partial<HttpConfig['rateLimits']> = {},
): Subject => {
  const acknowledge: { current?: AcknowledgePrivacyNotice } = {}
  const rename: { current?: RenameGuest } = {}
  const harness = buildServerHarness({
    config: {
      trustProxyHops,
      rateLimits: { ...testHttpConfig().rateLimits, ...otherLimits, guestWritePerMinute },
    },
    // The use cases answer success: the subject is the limiter in front of them, and a 429
    // that is really a refusal from below would prove nothing.
    usecases: {
      setPhotoCaption: async () => ok(undefined),
      deletePhoto: async () => ok(undefined),
      withdrawReaction: async () => ok(undefined),
      renameGuest: async (input) => {
        if (rename.current === undefined) throw new Error('rename was not built yet')
        return rename.current(input)
      },
      acknowledgePrivacyNotice: async (input) => {
        if (acknowledge.current === undefined) throw new Error('acknowledge was not built yet')
        return acknowledge.current(input)
      },
      // Who the moderator is, for the one test that signs a host in.
      authenticateUser: signInByAddress({ [MODERATOR_EMAIL]: MODERATOR }),
    },
  })
  rename.current = makeRenameGuest({ guests: harness.guests })
  acknowledge.current = makeAcknowledgePrivacyNotice({
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
  harness.users.seed(aUser({ id: MODERATOR, email: MODERATOR_EMAIL }))
  harness.memberships.seed({
    eventId: asEventId('event-wedding'),
    userId: asUserId(MODERATOR),
    role: 'moderator',
    grantedAt: AT,
  })
  harness.guests.seed(
    aGuest({ id: LEA, eventId: 'event-wedding' }),
    aGuest({ id: LEA, eventId: 'event-gala' }),
  )
  return {
    harness,
    wedding: harness.issueGuestToken('event-wedding', LEA),
    gala: harness.issueGuestToken('event-gala', LEA),
  }
}

interface Sender {
  (write: Write, as?: { readonly token?: string; readonly from?: string }): request.Test
}

/** A `switch` rather than an index into the agent: an unfamiliar method fails loudly. */
const issue = (agent: ReturnType<typeof request>, write: Write): request.Test => {
  switch (write.method) {
    case 'patch':
      return agent.patch(write.path)
    case 'delete':
      return agent.delete(write.path)
    case 'post':
      return agent.post(write.path)
    case 'put':
      return agent.put(write.path)
  }
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
    const agent = request(subject.harness.app)
    const sent = issue(agent, write)
      .set('Cookie', `${csrfCookie}; ${GUEST_COOKIE}=${token}`)
      .set(CSRF_HEADER, csrf)
    return (as.from === undefined ? sent : sent.set('X-Forwarded-For', as.from)).send(write.body)
  }
}

describe('the guest-token writes are rate-limited per client address and event (HTTP-H-01)', () => {
  it.each(GUEST_WRITES)(
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

  it('spends one allowance across the five routes, not one each', async () => {
    // `express-rate-limit` mints a store per instance, so a limiter built inside each router
    // would hand a guest a whole budget per router. Only `buildServer` holds the one
    // instance - the acknowledgement lives in a different router from the other three.
    const subject = buildSubject(3)
    const send = await browserOn(subject, subject.wedding)

    expect((await send(CAPTION)).status).toBe(204)
    expect((await send(TAKE_BACK)).status).toBe(204)
    expect((await send(WITHDRAW)).status).toBe(204)

    expect((await send(ACKNOWLEDGE)).status).toBe(429)
    expect((await send(RENAME)).status).toBe(429)
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

  it('does not spend a guest allowance on a moderator who also holds a guest cookie (HTTP-M-02)', async () => {
    // A moderator is dispatched to the host's router before the cookie is read, so the limiter
    // behind that deferral never counts them, whatever else the browser carries.
    const subject = buildSubject(1)
    const send = await browserOn(subject, subject.wedding)
    expect((await send(TAKE_BACK)).status).toBe(204)
    expect((await send(TAKE_BACK)).status).toBe(429)
    const { agent, csrf } = await signedInAs(subject.harness.app, MODERATOR_EMAIL)

    const moderated = await agent
      .delete(TAKE_BACK.path)
      .set(CSRF_HEADER, csrf)
      .set('Cookie', `${GUEST_COOKIE}=${subject.wedding}`)

    expect(moderated.status).toBe(204)
  })

  it('does not spend a guest allowance on a moderator deleting a photo, who carries no guest cookie', async () => {
    // `DELETE /photos/:id` is two endpoints on one path: the guest's own photo and the
    // moderator's any photo. The moderator's request has no guest cookie, so the guest router
    // hands it on *before* the limiter - mounted above that hand-off, a host moderating a
    // busy album from the venue's address would be refused as if they were the guest flooding it.
    const subject = buildSubject(1)
    const send = await browserOn(subject, subject.wedding)
    expect((await send(TAKE_BACK)).status).toBe(204)
    expect((await send(TAKE_BACK)).status).toBe(429)
    const { agent, csrf } = await signedInAs(subject.harness.app, MODERATOR_EMAIL)

    const moderated = await agent.delete(TAKE_BACK.path).set(CSRF_HEADER, csrf)

    expect(moderated.status).toBe(204)
  })

  it.each(GUEST_WRITES)(
    'drops a flood of %s before it costs a token verification',
    async (_name, write) => {
      // The limiter runs ahead of `requireGuest` on purpose (the same arrangement as the
      // upload and reaction limiters): a flood carrying garbage in the cookie must be refused
      // by count, not answered 401 every time at the price of an HMAC check.
      const subject = buildSubject(1)
      const send = await browserOn(subject, 'not-a-token')

      expect((await send(write)).status).toBe(401)

      expect((await send(write)).status).toBe(429)
    },
  )
})

/**
 * The sweep that stands in for a list nobody keeps: **every** write route under an event
 * that a guest token opens is limited, including one that does not exist yet.
 *
 * HTTP-H-01 was a gap because nobody had enumerated the guest's writes; the tests above name
 * five routes and would pass beside a sixth that is open. This one reads the route table of
 * the assembled server and asks each non-`GET` route under `:eventSlug` what a request with a
 * garbage `es_guest` cookie is told. A route that answers `401 guestToken.*` is guarded by
 * `requireGuest`, and what it must then do on the second request is answer 429: every limiter
 * on these routes runs ahead of the token check, which is what lets a sweep see it with no
 * guest to sign in.
 */
describe('every guest-token write under an event is rate-limited (HTTP-H-01)', () => {
  /** Every id in these paths is a GUID, so any `...Id` parameter gets one. */
  const PARAMETERS: Readonly<Record<string, string>> = { eventSlug: SLUG, kind: 'love' }

  const withParameters = (path: string): string =>
    path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
      const value = PARAMETERS[name] ?? (name.endsWith('Id') ? PHOTO : undefined)
      if (value === undefined) {
        throw new Error(
          `this sweep has no placeholder for ":${name}" (in ${path}). Add one to PARAMETERS: a path with the parameter left in it would 404 for the wrong reason and pass while asserting nothing.`,
        )
      }
      return value
    })

  const asWrite = (route: { readonly method: string; readonly path: string }): Write => {
    const { method } = route
    if (method !== 'post' && method !== 'patch' && method !== 'delete' && method !== 'put') {
      throw new Error(`this sweep does not know how to issue a ${method} request`)
    }
    return {
      name: `${method} ${route.path}`,
      method,
      path: withParameters(route.path),
      accepted: 0,
    }
  }

  it('answers 429 on the second request to every route that a guest token gates', async () => {
    // Every limiter on these routes at one, so that the second request is over whichever one
    // the route carries. A **fresh server per route**: the five writes share one bucket, so on
    // one server the first of them would spend what the next is judged by.
    const limits = { uploadPerMinute: 1, reactionPerMinute: 1 }
    const routes = mountedRoutes(buildSubject(1, 0, limits).harness.app).filter(
      (route) => route.method !== 'get' && route.path.includes('/:eventSlug/'),
    )

    const gated: string[] = []
    const open: string[] = []
    for (const route of routes) {
      const write = asWrite(route)
      const send = await browserOn(buildSubject(1, 0, limits), 'not-a-token')
      const first = await send(write)
      const code: unknown = first.body?.error?.code
      if (first.status !== 401 || typeof code !== 'string' || !code.startsWith('guestToken.')) {
        continue
      }
      gated.push(write.name)
      if ((await send(write)).status !== 429) open.push(write.name)
    }

    // Not vacuous: the eight routes this repository has today are all found, and a new one is
    // found as well, and fails below if it is open.
    expect(gated).toEqual(
      expect.arrayContaining([
        'post /api/events/:eventSlug/photos',
        'post /api/events/:eventSlug/clips',
        'post /api/events/:eventSlug/photos/:photoId/reactions',
        'patch /api/events/:eventSlug/photos/:photoId/caption',
        'delete /api/events/:eventSlug/photos/:photoId',
        'delete /api/events/:eventSlug/photos/:photoId/reactions/:kind',
        'post /api/events/:eventSlug/privacy-notice/acknowledgement',
        'patch /api/events/:eventSlug/guests/:guestId',
      ]),
    )
    expect(open).toEqual([])
  })
})
