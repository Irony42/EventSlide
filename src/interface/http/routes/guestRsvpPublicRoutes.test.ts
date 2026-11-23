import request from '../testing/request'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, aGuestInvite, anEvent } from '../../../application/testing/builders'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../../application/testing/fakeGuestRsvpRepository'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { RecordingEventBus } from '../../../application/testing/recordingEventBus'
import { makeViewGuestInvite } from '../../../application/usecases/guestInvites/viewGuestInvite'
import {
  makeDeleteOwnRsvp,
  makeGetOwnRsvp,
  makeUpdateOwnRsvp,
} from '../../../application/usecases/guestRsvps/ownRsvp'
import { makeSubmitRsvp } from '../../../application/usecases/guestRsvps/submitRsvp'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { asEventId } from '../../../domain/shared/ids'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { CSRF_HEADER } from '../middleware/csrf'
import { csrfTokenFrom } from '../testing/signIn'
import { buildServerHarness } from '../testing/serverHarness'

/**
 * The guests' replies on the invitation's page (spec 30), through the real server: the 4 KB parser
 * mounted ahead of the global one, the CSRF gate, the two write limiters built once, and the
 * headers of the invitation namespace. The use cases are the real ones over fakes.
 *
 * What these defend is the first public write nobody is signed in for: it answers one neutral 404
 * for a link that cannot be served, takes a token only in a header, refuses a stray field, and
 * says nothing a guest typed in any error.
 */

const LIVE = asEventId('evt-live')
const OTHER = asEventId('evt-other')
const LIVE_TOKEN = '1111111111111111'
const OTHER_TOKEN = '2222222222222222'
/** What a minted token looks like: Crockford letters and digits. */
const LETTERS_TOKEN = (() => {
  const made = GuestInviteToken.fromBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 37 + 11))
  if (!made.ok) throw new Error('token')
  return made.value
})()
const URL = `/api/i/${LIVE_TOKEN}/rsvp`

const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2099-12-13T18:00:00Z',
  timeZone: 'Europe/Paris',
}
const ANSWER = { name: 'Léa Martin', answer: 'yes', adults: 2, kids: 1, diet: 'sans gluten' }

interface World {
  readonly app: ReturnType<typeof buildServerHarness>['app']
  readonly rsvps: FakeGuestRsvpRepository
  readonly bus: RecordingEventBus
  readonly invites: FakeGuestInviteRepository
}

const buildWorld = async (
  limits: { readonly read?: number; readonly write?: number } = {},
): Promise<World> => {
  const events = new FakeEventRepository()
  const invites = new FakeGuestInviteRepository()
  const rsvps = new FakeGuestRsvpRepository()
  const bus = new RecordingEventBus()
  const secrets = new FakeSecretTokens()
  const clock = new FakeClock(AT)
  const ids = new SequentialIdGenerator()

  events.seed(
    anEvent({ id: LIVE, slug: 'vive', joinCode: 'H7K2QM', status: 'live' }),
    anEvent({ id: OTHER, slug: 'autre', joinCode: 'B4N9PT', status: 'live' }),
    anEvent({ id: asEventId('evt-letters'), slug: 'lettres', joinCode: 'C5M8QR', status: 'live' }),
  )
  invites.seed(
    aGuestInvite({ eventId: LIVE, tokenByte: 1, enabled: true, ...PARTY }),
    aGuestInvite({ eventId: OTHER, tokenByte: 2, enabled: true, ...PARTY }),
    GuestInvite.restore({
      ...aGuestInvite({ eventId: asEventId('evt-letters'), enabled: true, ...PARTY }).toProps(),
      token: LETTERS_TOKEN,
    }),
  )
  for (const eventId of [LIVE, OTHER]) {
    await invites.saveRsvpSettings(eventId, {
      enabled: true,
      deadline: null,
      closedAt: null,
      form: DEFAULT_RSVP_FORM,
    })
  }

  const access = { events, invites }
  const own = { ...access, rsvps, secrets, bus, clock }
  const harness = buildServerHarness({
    config: {
      rateLimits: {
        ...{
          uploadPerMinute: 12,
          uploadPerIpPerMinute: 300,
          joinPerMinute: 20,
          loginPerMinute: 10,
          reactionPerMinute: 30,
          reactionPerIpPerMinute: 600,
          guestWritePerMinute: 300,
          galleryPerMinute: 60,
          galleryMediaPerMinute: 600,
          galleryUnlockPerClient: 10,
          galleryUnlockPerLink: 50,
          eventCreationPerHour: 20,
          invitationsPerHour: 30,
          venuePhotosPerHour: 10,
          bookRequestsPerHour: 20,
          logosPerHour: 10,
        },
        guestInvitePerMinute: limits.read ?? 200,
        guestRsvpWritePerMinute: limits.write ?? 30,
      },
    },
    usecases: {
      viewGuestInvite: makeViewGuestInvite({ events, invites, rsvps, clock }),
      submitRsvp: makeSubmitRsvp({ ...own, ids }),
      getOwnRsvp: makeGetOwnRsvp(own),
      updateOwnRsvp: makeUpdateOwnRsvp(own),
      deleteOwnRsvp: makeDeleteOwnRsvp(own),
    },
  })
  return { app: harness.app, rsvps, bus, invites }
}

/** A guest's browser: it opens the page (which issues the CSRF cookie) and then writes. */
const guest = async (world: World) => {
  const agent = request.agent(world.app)
  const page = await agent.get(`/api/i/${LIVE_TOKEN}`)
  const csrf = csrfTokenFrom(page.headers)
  return {
    agent,
    page,
    post: (body: unknown, url = URL) =>
      agent
        .post(url)
        .set(CSRF_HEADER, csrf)
        .send(body as object),
    put: (editToken: string, body: unknown, url = URL) =>
      agent
        .put(url)
        .set(CSRF_HEADER, csrf)
        .set('X-Rsvp-Token', editToken)
        .send(body as object),
    get: (editToken?: string, url = URL) =>
      editToken === undefined ? agent.get(url) : agent.get(url).set('X-Rsvp-Token', editToken),
    del: (editToken?: string, url = URL) =>
      editToken === undefined
        ? agent.delete(url).set(CSRF_HEADER, csrf)
        : agent.delete(url).set(CSRF_HEADER, csrf).set('X-Rsvp-Token', editToken),
    csrf,
  }
}

describe('GET /api/i/:token: the rsvp block', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('tells the guest where the window stands, with the form they must see and no more', async () => {
    const { page } = await guest(world)

    expect(page.status).toBe(200)
    expect(page.body.rsvp).toEqual({
      state: 'open',
      deadline: null,
      form: {
        maybe: true,
        partySize: { enabled: true, max: 4 },
        kidsSeparate: true,
        diet: true,
      },
    })
  })

  it('says off for an invitation whose host asked nothing', async () => {
    await world.invites.saveRsvpSettings(LIVE, {
      enabled: false,
      deadline: null,
      closedAt: null,
      form: DEFAULT_RSVP_FORM,
    })

    const { page } = await guest(world)

    expect(page.body.rsvp.state).toBe('off')
  })
})

describe('the proof on the page', () => {
  it('names who agreed to be named and counts the people, and nothing else', async () => {
    const world = await buildWorld()
    await world.invites.saveRsvpSettings(LIVE, {
      enabled: true,
      deadline: null,
      closedAt: null,
      form: { ...DEFAULT_RSVP_FORM, visibility: 'names' },
    })
    const { post } = await guest(world)
    await post(ANSWER)
    const { page } = await guest(world)

    expect(page.body.rsvp.proof).toEqual({ count: 3, names: [] })
    expect(JSON.stringify(page.body.rsvp)).not.toMatch(/Martin|gluten/)
  })
})

describe('POST /api/i/:token/rsvp', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('creates the reply, answers 201 with what the guest typed and the token to keep, and stores only its digest', async () => {
    const { post } = await guest(world)

    const response = await post(ANSWER)

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      rsvp: {
        name: 'Léa Martin',
        answer: 'yes',
        adults: 2,
        kids: 1,
        diet: 'sans gluten',
        message: null,
        updatedAt: AT.toISOString(),
      },
      editToken: 'secret-1',
    })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    const stored = await world.rsvps.listByEvent(LIVE)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.source).toBe('open')
    expect(JSON.stringify(stored[0]?.toProps())).not.toContain('secret-1')
    expect(world.bus.published).toEqual([{ type: 'rsvp.changed', eventId: LIVE }])
  })

  it('is refused 403 without the CSRF header, like every write of the instance, and stores nothing', async () => {
    const agent = request.agent(world.app)
    await agent.get(`/api/i/${LIVE_TOKEN}`)

    const response = await agent.post(URL).send(ANSWER)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
    expect(await world.rsvps.listByEvent(LIVE)).toEqual([])
  })

  it('takes 4 KB of JSON and answers 413 request.tooLarge beyond it, ahead of anything else', async () => {
    const { post } = await guest(world)

    const small = await post({ ...ANSWER, message: 'a'.repeat(2_000) })
    const large = await post({ ...ANSWER, message: 'a'.repeat(5_000) })

    expect(small.status).toBe(400)
    expect(small.body.error.code).toBe('rsvp.messageTooLong')
    expect(large.status).toBe(413)
    expect(large.body.error.code).toBe('request.tooLarge')
    expect(await world.rsvps.listByEvent(LIVE)).toEqual([])
  })

  it('refuses a stray key as a malformed request: no source, household, id or token is a guest’s to send', async () => {
    const { post } = await guest(world)

    for (const stray of [
      { source: 'host' },
      { householdId: 'h-1' },
      { id: 'mine' },
      { editTokenHash: 'x' },
    ]) {
      const response = await post({ ...ANSWER, ...stray })

      expect([response.status, response.body.error.code]).toEqual([400, 'request.invalid'])
    }
    expect(await world.rsvps.listByEvent(LIVE)).toEqual([])
  })

  it('answers the domain’s codes, and never repeats what the guest typed', async () => {
    const { post } = await guest(world)

    const nameless = await post({ ...ANSWER, name: '   ' })
    const typed = await post({ ...ANSWER, answer: 'peut-être-secret-9f3e' })

    expect([nameless.status, nameless.body.error.code]).toEqual([400, 'rsvp.nameEmpty'])
    expect([typed.status, typed.body.error.code]).toEqual([400, 'rsvp.answerInvalid'])
    expect(JSON.stringify(typed.body)).not.toContain('secret-9f3e')
  })

  it('is refused 409 rsvp.closed once the host closed it, and 409 rsvp.off while it is not asked', async () => {
    const { post } = await guest(world)
    await world.invites.setRsvpClosedAt(LIVE, AT)
    const closed = await post(ANSWER)
    await world.invites.saveRsvpSettings(LIVE, {
      enabled: false,
      deadline: null,
      closedAt: null,
      form: DEFAULT_RSVP_FORM,
    })
    const off = await post(ANSWER)

    expect([closed.status, closed.body.error.code]).toEqual([409, 'rsvp.closed'])
    expect([off.status, off.body.error.code]).toEqual([409, 'rsvp.off'])
  })

  it('answers the same 201 to a script that fills the honeypot, and stores nothing', async () => {
    const { post, get } = await guest(world)

    const trapped = await post({ ...ANSWER, website: 'https://spam.example' })

    expect(trapped.status).toBe(201)
    expect(typeof trapped.body.editToken).toBe('string')
    expect(await world.rsvps.listByEvent(LIVE)).toEqual([])
    expect(world.bus.published).toEqual([])
    const reread = await get(trapped.body.editToken as string)
    expect([reread.status, reread.body.error.code]).toEqual([404, 'rsvp.notFound'])
  })

  it('answers the one neutral 404 for an invitation that cannot be served, a malformed token included', async () => {
    const { post } = await guest(world)

    const unknown = await post(ANSWER, '/api/i/9999999999999999/rsvp')
    const malformed = await post(ANSWER, '/api/i/not-a-token!/rsvp')
    const tooLong = await post(ANSWER, `/api/i/${'1'.repeat(300)}/rsvp`)

    for (const refused of [unknown, malformed, tooLong]) {
      expect([refused.status, refused.body.error.code]).toEqual([404, 'guestInvite.notAvailable'])
    }
    expect(unknown.body).toEqual(malformed.body)
  })
})

describe('GET, PUT, DELETE /api/i/:token/rsvp: a guest’s own reply', () => {
  let world: World
  let editToken: string

  beforeEach(async () => {
    world = await buildWorld()
  })

  const created = async () => {
    const session = await guest(world)
    const response = await session.post(ANSWER)
    editToken = response.body.editToken as string
    return session
  }

  it('reads the reply back with the token in the header, and with nothing else', async () => {
    const { get } = await created()

    const read = await get(editToken)

    expect(read.status).toBe(200)
    expect(read.body.rsvp).toMatchObject({ name: 'Léa Martin', answer: 'yes', adults: 2 })
    expect(read.headers['cache-control']).toBe('no-store')
  })

  it('never takes the token from a path or a query: only the header opens a reply', async () => {
    const { agent } = await created()

    const inQuery = await agent.get(`${URL}?token=${editToken}&editToken=${editToken}`)
    const noHeader = await agent.get(URL)

    expect([inQuery.status, inQuery.body.error.code]).toEqual([404, 'rsvp.notFound'])
    expect([noHeader.status, noHeader.body.error.code]).toEqual([404, 'rsvp.notFound'])
  })

  it('does not open the reply of another event with its token', async () => {
    const { agent } = await created()

    const response = await agent.get(`/api/i/${OTHER_TOKEN}/rsvp`).set('X-Rsvp-Token', editToken)

    expect([response.status, response.body.error.code]).toEqual([404, 'rsvp.notFound'])
  })

  it('changes the reply, and refuses a stray key and a wrong token', async () => {
    const { put } = await created()

    const changed = await put(editToken, { name: 'Léa M.', answer: 'no' })
    const stray = await put(editToken, { name: 'Léa', answer: 'yes', website: 'x' })
    const wrong = await put('nope', { name: 'Léa', answer: 'yes' })

    expect(changed.status).toBe(200)
    expect(changed.body.rsvp).toMatchObject({ name: 'Léa M.', answer: 'no', adults: 0 })
    expect([stray.status, stray.body.error.code]).toEqual([400, 'request.invalid'])
    expect([wrong.status, wrong.body.error.code]).toEqual([404, 'rsvp.notFound'])
  })

  it('is refused a change once the window is closed (409), but still read and still deletable', async () => {
    const { put, get, del } = await created()
    await world.invites.setRsvpClosedAt(LIVE, AT)

    const change = await put(editToken, { name: 'Léa', answer: 'yes', adults: 1 })
    const read = await get(editToken)
    const erased = await del(editToken)

    expect([change.status, change.body.error.code]).toEqual([409, 'rsvp.closed'])
    expect(read.status).toBe(200)
    expect(erased.status).toBe(204)
    expect(await world.rsvps.listByEvent(LIVE)).toEqual([])
  })

  it('deletes with a 204, and the second delete is the same 204: the wish is already done', async () => {
    const { del, get } = await created()

    const first = await del(editToken)
    const second = await del(editToken)

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
    expect((await get(editToken)).status).toBe(404)
  })

  it('answers the neutral 404 for a token too long to be one, whatever the method, without reading anything', async () => {
    const { get, put, del } = await created()
    const dead = `/api/i/${'1'.repeat(300)}/rsvp`

    const answers = [
      await get(editToken, dead),
      await put(editToken, { name: 'A', answer: 'yes' }, dead),
      await del(editToken, dead),
    ]

    for (const answer of answers) {
      expect([answer.status, answer.body.error.code]).toEqual([404, 'guestInvite.notAvailable'])
    }
  })

  it('answers the neutral 404 of the page for every method when the link cannot be served', async () => {
    const { get, put, del } = await created()
    const dead = '/api/i/9999999999999999/rsvp'

    const answers = [
      await get(editToken, dead),
      await put(editToken, { name: 'A', answer: 'yes' }, dead),
      await del(editToken, dead),
    ]

    for (const answer of answers) {
      expect([answer.status, answer.body.error.code]).toEqual([404, 'guestInvite.notAvailable'])
    }
  })
})

describe('the limiters of the replies', () => {
  it('limits the writes per address across the three methods, one budget, and leaves the reads alone', async () => {
    const world = await buildWorld({ write: 3 })
    const { post, put, del, get } = await guest(world)
    const first = await post(ANSWER)
    const token = first.body.editToken as string

    const second = await put(token, { name: 'Léa', answer: 'yes', adults: 1 })
    const third = await del(token)
    const fourth = await post(ANSWER)
    const read = await get(token)

    expect([first.status, second.status, third.status]).toEqual([201, 200, 204])
    expect([fourth.status, fourth.body.error.code]).toEqual([429, 'rate.limited'])
    expect(read.status).toBe(404)
  })

  it('limits one invitation across every address: 300 a minute, and another invitation is untouched', async () => {
    const world = await buildWorld({ write: 6_000 })
    const { del } = await guest(world)

    const statuses = new Set<number>()
    for (let i = 0; i < 300; i += 1) statuses.add((await del('nope')).status)
    const flooded = await del('nope')
    const other = await del('nope', `/api/i/${OTHER_TOKEN}/rsvp`)

    expect([...statuses]).toEqual([204])
    expect([flooded.status, flooded.body.error.code]).toEqual([429, 'rate.limited'])
    expect(other.status).toBe(204)
    // A real token, with letters in it: a bucket of its own, not the one invented links share.
    const real = await del('nope', `/api/i/${LETTERS_TOKEN.value}/rsvp`)
    expect(real.status).toBe(204)
  }, 60_000)

  it('gives every invented link one shared bucket, and a real token with letters its own', async () => {
    expect(LETTERS_TOKEN.value).toMatch(/[A-Z]/)
    const world = await buildWorld({ write: 6_000 })
    const { del } = await guest(world)

    for (let i = 0; i < 300; i += 1) await del('nope', `/api/i/inv${i}!/rsvp`)
    const invented = await del('nope', '/api/i/inv-last!/rsvp')
    const real = await del('nope', `/api/i/${LETTERS_TOKEN.value}/rsvp`)

    expect([invented.status, invented.body.error.code]).toEqual([429, 'rate.limited'])
    expect(real.status).toBe(204)
  }, 60_000)

  it('shares one read budget between the page, the logo and a guest’s own reply', async () => {
    const world = await buildWorld({ read: 3 })
    const agent = request.agent(world.app)

    const page = await agent.get(`/api/i/${LIVE_TOKEN}`)
    const own = await agent.get(URL).set('X-Rsvp-Token', 'nope')
    const again = await agent.get(`/api/i/${LIVE_TOKEN}`)
    const refused = await agent.get(URL).set('X-Rsvp-Token', 'nope')

    expect([page.status, own.status, again.status]).toEqual([200, 404, 200])
    expect([refused.status, refused.body.error.code]).toEqual([429, 'rate.limited'])
  })
})
