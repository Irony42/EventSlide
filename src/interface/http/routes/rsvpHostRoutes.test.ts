import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { FakeGuestHouseholdRepository } from '../../../application/testing/fakeGuestHouseholdRepository'
import { FakeGuestRsvpRepository } from '../../../application/testing/fakeGuestRsvpRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { RecordingEventBus } from '../../../application/testing/recordingEventBus'
import {
  asGuestHouseholdId,
  asGuestRsvpId,
  type GuestHouseholdId,
  type GuestRsvpId,
} from '../../../domain/shared/ids'
import { makeEnableGuestInvite } from '../../../application/usecases/guestInvites/enableGuestInvite'
import { makeSaveGuestInvite } from '../../../application/usecases/guestInvites/saveGuestInvite'
import {
  makeCloseRsvps,
  makeReopenRsvps,
} from '../../../application/usecases/guestRsvps/closeRsvps'
import { makeAttachRsvpToHousehold } from '../../../application/usecases/guestRsvps/attachRsvpToHousehold'
import { makeDeleteHousehold } from '../../../application/usecases/guestRsvps/deleteHousehold'
import {
  makeMarkHouseholdReminded,
  makeRotateHouseholdToken,
} from '../../../application/usecases/guestRsvps/householdActs'
import { makeImportHouseholds } from '../../../application/usecases/guestRsvps/importHouseholds'
import { makeListHouseholds } from '../../../application/usecases/guestRsvps/listHouseholds'
import { makeSaveHousehold } from '../../../application/usecases/guestRsvps/saveHousehold'
import { makeExportRsvps } from '../../../application/usecases/guestRsvps/exportRsvps'
import { makeGetRsvpForm } from '../../../application/usecases/guestRsvps/getRsvpForm'
import { makeHostAddRsvp } from '../../../application/usecases/guestRsvps/hostAddRsvp'
import { makeHostDeleteRsvp } from '../../../application/usecases/guestRsvps/hostDeleteRsvp'
import { makeHostUpdateRsvp } from '../../../application/usecases/guestRsvps/hostUpdateRsvp'
import { makeListRsvps } from '../../../application/usecases/guestRsvps/listRsvps'
import { makeMarkRsvpsSeen } from '../../../application/usecases/guestRsvps/markRsvpsSeen'
import { makeSaveRsvpForm } from '../../../application/usecases/guestRsvps/saveRsvpForm'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { hostExportLimiter } from '../middleware/rateLimit'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { rsvpHostRoutes } from './rsvpHostRoutes'

/**
 * The host's routes of the guests' replies (spec 30), driven through a real Express app.
 *
 * Two events with different owners: the other event's owner reaching for this one is **404**, not
 * 403. Everything here is the owner's: a moderator of the same event is **403**. The wire carries
 * the domain's codes and nothing else (a stray key is `request.invalid`).
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const ARCHIVED = asEventId('evt-archived')
const NO_INVITE = asEventId('evt-no-invite')

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'

const SLUG = 'camille-et-sacha'
const BASE = `/api/events/${SLUG}`
const FORM = `${BASE}/rsvp-form`
const RSVPS = `${BASE}/rsvps`

interface World {
  readonly app: Express
  readonly rsvps: FakeGuestRsvpRepository
  readonly households: FakeGuestHouseholdRepository
  readonly audit: FakeAuditLog
  readonly bus: RecordingEventBus
  readonly invites: FakeGuestInviteRepository
}

const buildWorld = async (exportSlots: { readonly perAccount?: number } = {}): Promise<World> => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const invites = new FakeGuestInviteRepository()
  const rsvps = new FakeGuestRsvpRepository()
  const households = new FakeGuestHouseholdRepository(rsvps)
  const bus = new RecordingEventBus()
  const audit = new FakeAuditLog().withAccounts(
    asUserId(OWNER),
    asUserId(MODERATOR),
    asUserId(GALA_OWNER),
  )
  // The fake's ids are not uuids, and the routes take a reply id from a path: only a uuid is one.
  const ids = new (class extends SequentialIdGenerator {
    private rsvpCount = 0
    private householdCount = 0
    private tokenCount = 0
    /** A household's link must be its own: the sequential ramp repeats a 16-byte token every second call. */
    override bytes(count: number): Uint8Array {
      if (count !== 16) return super.bytes(count)
      this.tokenCount += 1
      const n = this.tokenCount
      return Uint8Array.from({ length: 16 }, (_, i) => (i < 3 ? (n >> (5 * i)) % 32 : i))
    }
    override guestHouseholdId(): GuestHouseholdId {
      this.householdCount += 1
      return asGuestHouseholdId(
        `d2000000-0000-4000-8000-${this.householdCount.toString(16).padStart(12, '0')}`,
      )
    }
    override guestRsvpId(): GuestRsvpId {
      this.rsvpCount += 1
      return asGuestRsvpId(
        `d1000000-0000-4000-8000-${this.rsvpCount.toString(16).padStart(12, '0')}`,
      )
    }
  })()
  const limiter = hostExportLimiter(exportSlots)

  const harness = buildHarness({
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }
      const { clock } = deps
      const access = { events, memberships, invites }

      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))

      app.use(
        '/api',
        rsvpHostRoutes({
          deps,
          presenter: {
            publicUrl: deps.config.publicUrl,
            uploadLimits: deps.config.uploads,
            clipLimits: {
              maxBytes: deps.config.clips.maxBytes,
              maxSeconds: deps.config.clips.maxSeconds,
              supported: deps.config.clips.supported,
            },
          },
          hostExportLimiter: limiter,
          usecases: {
            getRsvpForm: makeGetRsvpForm({ ...access, rsvps, clock }),
            saveRsvpForm: makeSaveRsvpForm({ ...access, rsvps, audit, bus, clock, ids }),
            closeRsvps: makeCloseRsvps({ ...access, rsvps, audit, bus, clock }),
            reopenRsvps: makeReopenRsvps({ ...access, rsvps, audit, bus, clock }),
            listRsvps: makeListRsvps({ ...access, rsvps, households, clock }),
            hostAddRsvp: makeHostAddRsvp({ ...access, rsvps, audit, bus, ids, clock }),
            hostUpdateRsvp: makeHostUpdateRsvp({ ...access, rsvps, households, audit, bus, clock }),
            hostDeleteRsvp: makeHostDeleteRsvp({ ...access, rsvps, audit, bus, clock }),
            exportRsvps: makeExportRsvps({ ...access, rsvps, households, audit, clock }),
            markRsvpsSeen: makeMarkRsvpsSeen({ ...access, rsvps, clock }),
            listHouseholds: makeListHouseholds({ ...access, rsvps, households }),
            saveHousehold: makeSaveHousehold({ ...access, rsvps, households, bus, ids, clock }),
            importHouseholds: makeImportHouseholds({
              ...access,
              households,
              audit,
              bus,
              ids,
              clock,
            }),
            deleteHousehold: makeDeleteHousehold({
              ...access,
              households,
              audit,
              bus,
              clock,
            }),
            rotateHouseholdToken: makeRotateHouseholdToken({
              ...access,
              rsvps,
              households,
              audit,
              bus,
              ids,
              clock,
            }),
            markHouseholdReminded: makeMarkHouseholdReminded({
              ...access,
              rsvps,
              households,
              audit,
              bus,
              ids,
              clock,
            }),
            attachRsvpToHousehold: makeAttachRsvpToHousehold({ ...access, rsvps, households, bus }),
          },
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
  )
  events.seed(
    anEvent({
      id: WEDDING,
      ownerId: OWNER,
      slug: SLUG,
      joinCode: 'H7K2QM',
      name: 'Léa fête ses 40 ans',
    }),
    anEvent({ id: GALA, ownerId: GALA_OWNER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    anEvent({
      id: ARCHIVED,
      ownerId: OWNER,
      slug: 'archive',
      joinCode: 'D6P7RS',
      status: 'archived',
    }),
    anEvent({ id: NO_INVITE, ownerId: OWNER, slug: 'sans-faire-part', joinCode: 'F8R5TV' }),
  )
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
    { eventId: ARCHIVED, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: NO_INVITE, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
  )
  rsvps.addMember(WEDDING, asUserId(OWNER))

  // The wedding's invitation, saved the way the host saves it: replies hang on it.
  const save = makeSaveGuestInvite({
    events,
    memberships,
    invites,
    audit,
    ids,
    clock: harness.deps.clock,
  })
  const saved = await save({
    eventId: WEDDING,
    actorId: asUserId(OWNER),
    title: 'Fête',
    startsAt: '2026-12-13T18:00:00Z',
    timeZone: 'Europe/Paris',
  })
  if (!saved.ok) throw new Error('the world could not save its invitation')
  const enabled = await makeEnableGuestInvite({
    events,
    memberships,
    invites,
    audit,
    clock: harness.deps.clock,
  })({ eventId: WEDDING, actorId: asUserId(OWNER) })
  if (!enabled.ok) throw new Error('the world could not switch its invitation on')

  return { app: harness.app, rsvps, households, audit, bus, invites }
}

type Who = 'owner' | 'moderator' | 'gala-owner'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const actionsOf = (world: World): string[] =>
  world.audit
    .all()
    .map((record) => record.action)
    .filter((action) => !action.startsWith('event.guestInvite'))

const REPLY = { name: 'Léa Martin', answer: 'yes', adults: 2, kids: 1, diet: 'sans gluten' }

describe('GET /api/events/:eventSlug/rsvp-form', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('answers the defaults and where the window stands, and writes, audits and announces nothing', async () => {
    const response = await (await signedIn(world, 'owner')).get(FORM)

    expect(response.status).toBe(200)
    expect(response.body.rsvpForm).toMatchObject({
      invited: true,
      enabled: false,
      deadline: null,
      closedAt: null,
      state: 'off',
      erasedAt: null,
      form: { maybe: true, partySize: { enabled: true, max: 4 }, kidsSeparate: true, diet: true },
    })
    expect(response.body.rsvpForm.closesAt).toBe('2026-12-13T18:00:00.000Z')
    expect(actionsOf(world)).toEqual([])
    expect(world.bus.published).toEqual([])
  })

  it('answers the defaults, with no state, for an event that has no invitation yet', async () => {
    const response = await (
      await signedIn(world, 'owner')
    ).get('/api/events/sans-faire-part/rsvp-form')

    expect(response.status).toBe(200)
    expect(response.body.rsvpForm).toMatchObject({
      invited: false,
      enabled: false,
      state: null,
      closesAt: null,
    })
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).get(FORM)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404, never 403, for the owner of another event', async () => {
    const response = await (await signedIn(world, 'gala-owner')).get(FORM)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('is the owner’s: a moderator of the same event is 403', async () => {
    const response = await (await signedIn(world, 'moderator')).get(FORM)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.forbidden')
  })
})

describe('PUT /api/events/:eventSlug/rsvp-form', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('saves the switch, the deadline and the form, audits it and announces it without content', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.put(FORM).send({
      enabled: true,
      deadline: '2026-12-01',
      form: { maybe: false, partySize: { max: 6 }, diet: false },
    })

    expect(response.status).toBe(200)
    expect(response.body.rsvpForm).toMatchObject({
      enabled: true,
      deadline: '2026-12-01',
      state: 'open',
      form: { maybe: false, partySize: { enabled: true, max: 6 }, diet: false, kidsSeparate: true },
    })
    expect((await agent.get(FORM)).body.rsvpForm.deadline).toBe('2026-12-01')
    expect(actionsOf(world)).toEqual(['event.rsvpFormSaved'])
    expect(world.bus.published).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
  })

  it('leaves an absent field as it was and clears a deadline with null', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.put(FORM).send({ enabled: true, deadline: '2026-12-01' }).expect(200)

    const kept = await agent.put(FORM).send({ form: { kidsSeparate: false } })
    expect(kept.body.rsvpForm).toMatchObject({ enabled: true, deadline: '2026-12-01' })

    const cleared = await agent.put(FORM).send({ deadline: null })
    expect(cleared.body.rsvpForm).toMatchObject({ enabled: true, deadline: null })
  })

  it.each([
    ['a deadline that is not a day', { deadline: 'demain' }, 'rsvp.deadlineInvalid'],
    ['a deadline after the party', { deadline: '2026-12-14' }, 'rsvp.deadlineAfterStart'],
    ['a switch that is not a boolean', { enabled: 'oui' }, 'rsvp.enabledInvalid'],
    ['a flag that is not a boolean', { form: { maybe: 1 } }, 'rsvp.formInvalid'],
    ['a party that is not an object', { form: { partySize: 4 } }, 'rsvp.formInvalid'],
    ['a party too large', { form: { partySize: { max: 99 } } }, 'rsvp.partyMaxInvalid'],
  ])('answers 400 %s with the domain’s code', async (_name, body, code) => {
    const response = await (await signedIn(world, 'owner')).put(FORM).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
  })

  it('refuses a stray key at the top as a malformed request', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .put(FORM)
      .send({ closedAt: '2026-01-01' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it.each([
    ['a key lot 1 does not know', { capacity: 3 }],
    ['a form that is not an object', 4],
    ['a null form', null],
  ])('answers rsvp.formInvalid for %s, from the domain', async (_name, form) => {
    const response = await (await signedIn(world, 'owner')).put(FORM).send({ form })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('rsvp.formInvalid')
  })

  it('answers 409 rsvp.inviteRequired for an event with no invitation', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .put('/api/events/sans-faire-part/rsvp-form')
      .send({ enabled: true })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('rsvp.inviteRequired')
  })

  it('lets the host delete a reply on an archived event, and refuses every other write there', async () => {
    const agent = await signedIn(world, 'owner')
    const id = '99999999-9999-4999-8999-999999999999'
    world.rsvps.seed(aRsvp({ id, eventId: ARCHIVED }))

    const add = await agent.post('/api/events/archive/rsvps').send(REPLY)
    const del = await agent.delete(`/api/events/archive/rsvps/${id}`)

    expect([add.status, add.body.error.code]).toEqual([409, 'guestInvite.eventArchived'])
    expect(del.status).toBe(204)
  })

  it('is refused on an archived event', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .put('/api/events/archive/rsvp-form')
      .send({ enabled: true })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('guestInvite.eventArchived')
  })

  it('is the owner’s, and the other event’s owner is 404', async () => {
    expect((await (await signedIn(world, 'moderator')).put(FORM).send({})).status).toBe(403)
    expect((await (await signedIn(world, 'gala-owner')).put(FORM).send({})).status).toBe(404)
  })
})

describe('POST /api/events/:eventSlug/rsvp-form/close and /reopen', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('closes by hand, then reopens, answering the window each time', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.put(FORM).send({ enabled: true }).expect(200)

    const closed = await agent.post(`${FORM}/close`).send({})
    expect(closed.status).toBe(200)
    expect(closed.body.rsvpForm).toMatchObject({ state: 'closed' })
    expect(closed.body.rsvpForm.closedAt).toBe(AT.toISOString())

    const reopened = await agent.post(`${FORM}/reopen`).send({})
    expect(reopened.status).toBe(200)
    expect(reopened.body.rsvpForm).toMatchObject({ state: 'open', closedAt: null })
    expect(actionsOf(world)).toEqual([
      'event.rsvpFormSaved',
      'event.rsvpsClosed',
      'event.rsvpsReopened',
    ])
  })

  it('refuses a body that is not empty, and a moderator', async () => {
    const agent = await signedIn(world, 'owner')

    const body = await agent.post(`${FORM}/close`).send({ now: true })
    const moderator = await (await signedIn(world, 'moderator')).post(`${FORM}/reopen`).send({})

    expect(body.status).toBe(400)
    expect(body.body.error.code).toBe('request.invalid')
    expect(moderator.status).toBe(403)
  })

  it('answers 409 rsvp.inviteRequired without an invitation', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .post('/api/events/sans-faire-part/rsvp-form/close')
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('rsvp.inviteRequired')
  })
})

describe('the replies: GET, POST, PUT and DELETE /api/events/:eventSlug/rsvps', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('answers an empty list with its figures', async () => {
    const response = await (await signedIn(world, 'owner')).get(RSVPS)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.rsvps).toEqual([])
    expect(response.body.unseen).toBe(0)
    expect(response.body.stats.yes).toEqual({ responses: 0, people: 0, adults: 0, kids: 0 })
    expect(response.body.rsvpForm.invited).toBe(true)
  })

  it('adds a reply typed by the host, from `host`, and lists it with the figures', async () => {
    const agent = await signedIn(world, 'owner')

    const created = await agent.post(RSVPS).send(REPLY)

    expect(created.status).toBe(201)
    expect(created.body.rsvp).toMatchObject({
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
      kids: 1,
      diet: 'sans gluten',
      source: 'host',
    })
    expect(created.body.rsvp).not.toHaveProperty('editTokenHash')
    const list = await agent.get(RSVPS)
    expect(list.body.rsvps).toHaveLength(1)
    expect(list.body.stats.yes).toEqual({ responses: 1, people: 3, adults: 2, kids: 1 })
    expect(list.body.stats.diets).toEqual([{ name: 'Léa Martin', diet: 'sans gluten' }])
    // The host's own write is not news to the host.
    expect(list.body.unseen).toBe(0)
    expect(list.body.rsvpForm.erasedAt).not.toBeNull()
    expect(actionsOf(world)).toEqual(['event.rsvpHostAdded'])
    expect(world.bus.published).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
  })

  it('never writes a name or a diet in the audit log', async () => {
    await (await signedIn(world, 'owner')).post(RSVPS).send(REPLY).expect(201)

    expect(JSON.stringify(world.audit.all())).not.toMatch(/Léa Martin|gluten/)
  })

  it.each([
    ['no name', { answer: 'yes' }, 'rsvp.nameInvalid'],
    ['an empty name', { name: '  ', answer: 'yes' }, 'rsvp.nameEmpty'],
    ['an answer the form does not offer', { name: 'A', answer: 'waitlist' }, null],
    [
      'a count that is not a number',
      { name: 'A', answer: 'yes', adults: 'deux' },
      'rsvp.countInvalid',
    ],
  ])('answers 400 for %s', async (_label, body, code) => {
    const response = await (await signedIn(world, 'owner')).post(RSVPS).send(body)

    expect(response.status).toBe(400)
    if (code !== null) expect(response.body.error.code).toBe(code)
  })

  it('refuses showName from the host: showing a first name is a guest choice', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .post(RSVPS)
      .send({ ...REPLY, showName: true })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('refuses a stray key, such as a source or a token, as a malformed request', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .post(RSVPS)
      .send({ ...REPLY, source: 'open' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 409 rsvp.inviteRequired without an invitation', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .post('/api/events/sans-faire-part/rsvps')
      .send(REPLY)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('rsvp.inviteRequired')
  })

  it('corrects a reply: the whole reply is sent again, the id and the source stay', async () => {
    const agent = await signedIn(world, 'owner')
    const { id } = (await agent.post(RSVPS).send(REPLY)).body.rsvp

    const response = await agent
      .put(`${RSVPS}/${String(id)}`)
      .send({ name: 'Léa M.', answer: 'no' })

    expect(response.status).toBe(200)
    expect(response.body.rsvp).toMatchObject({ id, name: 'Léa M.', answer: 'no', source: 'host' })
    expect(actionsOf(world)).toContain('event.rsvpHostEdited')
  })

  it('answers 404 rsvp.notFound for a reply of another event or one that is gone', async () => {
    const agent = await signedIn(world, 'owner')
    const foreign = '44444444-4444-4444-8444-444444444444'
    world.rsvps.seed(aRsvp({ id: foreign, eventId: GALA }))

    const put = await agent.put(`${RSVPS}/${foreign}`).send(REPLY)
    const del = await agent.delete(`${RSVPS}/${foreign}`)

    expect(put.status).toBe(404)
    expect(put.body.error.code).toBe('rsvp.notFound')
    expect(del.status).toBe(404)
    expect(del.body.error.code).toBe('rsvp.notFound')
    expect(await world.rsvps.findById(GALA, aRsvp({ id: foreign }).id)).not.toBeNull()
  })

  it('leaves a guest’s reply the host has not read unseen after the host adds one', async () => {
    world.rsvps.seed(
      aRsvp({
        id: '88888888-8888-4888-8888-888888888888',
        eventId: WEDDING,
        updatedAt: new Date(0),
      }),
    )
    const agent = await signedIn(world, 'owner')
    await agent.post(RSVPS).send(REPLY).expect(201)

    expect((await agent.get(RSVPS)).body.unseen).toBe(2)
  })

  it('refuses an id that is not an id', async () => {
    const response = await (await signedIn(world, 'owner')).delete(`${RSVPS}/pas-un-id`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('deletes a reply with a 204, audited and announced, and a second delete is 404', async () => {
    const agent = await signedIn(world, 'owner')
    const { id } = (await agent.post(RSVPS).send(REPLY)).body.rsvp

    const first = await agent.delete(`${RSVPS}/${String(id)}`)
    const second = await agent.delete(`${RSVPS}/${String(id)}`)

    expect(first.status).toBe(204)
    expect(second.status).toBe(404)
    expect((await agent.get(RSVPS)).body.rsvps).toEqual([])
    expect(actionsOf(world)).toContain('event.rsvpHostDeleted')
  })

  it('answers a delete on an event with no invitation by the reply, not the invitation: 404 rsvp.notFound', async () => {
    const response = await (
      await signedIn(world, 'owner')
    ).delete(`/api/events/sans-faire-part/rsvps/77777777-7777-4777-8777-777777777777`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('rsvp.notFound')
  })

  it('is the owner’s throughout, and the other event’s owner is 404', async () => {
    const moderator = await signedIn(world, 'moderator')
    const gala = await signedIn(world, 'gala-owner')
    const id = '55555555-5555-4555-8555-555555555555'

    for (const agent of [moderator, gala]) {
      const expected = agent === moderator ? 403 : 404
      expect((await agent.get(RSVPS)).status).toBe(expected)
      expect((await agent.post(RSVPS).send(REPLY)).status).toBe(expected)
      expect((await agent.put(`${RSVPS}/${id}`).send(REPLY)).status).toBe(expected)
      expect((await agent.delete(`${RSVPS}/${id}`)).status).toBe(expected)
      expect((await agent.post(`${RSVPS}/seen`).send({})).status).toBe(expected)
      expect((await agent.get(`${RSVPS}/export`)).status).toBe(expected)
    }
  })
})

describe('POST /api/events/:eventSlug/rsvps/seen', () => {
  it('empties the badge for this account, and a read does not', async () => {
    const world = await buildWorld()
    const agent = await signedIn(world, 'owner')
    world.rsvps.seed(
      aRsvp({
        id: '66666666-6666-4666-8666-666666666666',
        eventId: WEDDING,
        createdAt: new Date('2026-06-01T00:00:00Z'),
      }),
    )

    expect((await agent.get(RSVPS)).body.unseen).toBe(1)
    expect((await agent.get(RSVPS)).body.unseen).toBe(1)

    const seen = await agent.post(`${RSVPS}/seen`).send({})
    expect(seen.status).toBe(204)
    expect((await agent.get(RSVPS)).body.unseen).toBe(0)
  })

  it('refuses a body that is not empty', async () => {
    const world = await buildWorld()

    const response = await (await signedIn(world, 'owner')).post(`${RSVPS}/seen`).send({ a: 1 })

    expect(response.status).toBe(400)
  })
})

describe('GET /api/events/:eventSlug/rsvps/export', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  const fill = async (agent: Agent): Promise<void> => {
    await agent.post(RSVPS).send(REPLY).expect(201)
    await agent.post(RSVPS).send({ name: 'Tom', answer: 'no' }).expect(201)
  }

  it('sends the whole table as a download that is never rendered or kept', async () => {
    const agent = await signedIn(world, 'owner')
    await fill(agent)

    const response = await agent.get(`${RSVPS}/export`).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${SLUG}-reponses.csv"`,
    )
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.text).toContain('Léa Martin')
    expect(response.text).toContain('Tom')
    expect(actionsOf(world)).toContain('event.rsvpsExported')
  })

  it('sends the caterer’s view: only the people who come', async () => {
    const agent = await signedIn(world, 'owner')
    await fill(agent)

    const response = await agent.get(`${RSVPS}/export?view=caterer`).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${SLUG}-traiteur.csv"`,
    )
    expect(response.text).toContain('Léa Martin')
    expect(response.text).not.toContain('Tom')
  })

  it('refuses a view that does not exist and any other query key', async () => {
    const agent = await signedIn(world, 'owner')

    expect((await agent.get(`${RSVPS}/export?view=tout`)).status).toBe(400)
    expect((await agent.get(`${RSVPS}/export?format=xlsx`)).status).toBe(400)
  })

  it('answers a HEAD without running the export: nothing is audited', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.head(`${RSVPS}/export`)

    expect(response.status).toBeLessThan(300)
    expect(actionsOf(world)).toEqual([])
  })

  it('goes through the bound the ZIP exports share: an account with no slot is refused, nothing is exported', async () => {
    const full = await buildWorld({ perAccount: 0 })
    const agent = await signedIn(full, 'owner')

    const get = await agent.get(`${RSVPS}/export`)
    const head = await agent.head(`${RSVPS}/export`)

    expect([get.status, head.status]).toEqual([429, 429])
    expect(get.body.error.code).toBe('rate.limited')
    expect(actionsOf(full)).toEqual([])
  })

  it('answers 401 without a session', async () => {
    expect((await request(world.app).get(`${RSVPS}/export`)).status).toBe(401)
  })
})

const HOUSEHOLDS = `${BASE}/households`
const HOUSEHOLD_ID = 'd2000000-0000-4000-8000-000000000001'

describe('the guest list: /api/events/:eventSlug/households', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  const addHousehold = async (agent: Agent, body: object = { name: 'Famille Martin', places: 4 }) =>
    agent.post(HOUSEHOLDS).send(body)

  it('answers an empty list, no-store', async () => {
    const response = await (await signedIn(world, 'owner')).get(HOUSEHOLDS)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({ households: [] })
  })

  it('adds a household with a link of its own, and lists it, the link included, no-store', async () => {
    const agent = await signedIn(world, 'owner')

    const created = await addHousehold(agent)

    expect(created.status).toBe(201)
    expect(created.headers['cache-control']).toBe('no-store')
    expect(created.body.household).toMatchObject({
      id: HOUSEHOLD_ID,
      name: 'Famille Martin',
      places: 4,
      remindedAt: null,
      reply: null,
    })
    expect(created.body.household.token).toMatch(/^[0-9A-Z]{16}$/)
    const list = await agent.get(HOUSEHOLDS)
    expect(list.body.households).toHaveLength(1)
    expect(list.body.households[0].token).toBe(created.body.household.token)
    expect(world.bus.published).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
  })

  it.each([
    ['no name', { places: 2 }, 'household.nameInvalid'],
    ['an empty name', { name: ' ', places: 2 }, 'household.nameEmpty'],
    ['no places', { name: 'A' }, 'household.placesInvalid'],
    ['11 places', { name: 'A', places: 11 }, 'household.placesInvalid'],
  ])('answers 400 for %s', async (_label, body, code) => {
    const response = await addHousehold(await signedIn(world, 'owner'), body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
  })

  it('refuses a key it does not know, and a body that is not an object', async () => {
    const agent = await signedIn(world, 'owner')

    expect((await addHousehold(agent, { name: 'A', places: 2, token: 'x' })).status).toBe(400)
    expect((await agent.post(HOUSEHOLDS).send([])).status).toBe(400)
  })

  it('pastes a list: what it stored and what it left out, 201', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`${HOUSEHOLDS}/import`)
      .send({ text: 'Famille Martin ; 4\nLéa Durand ; 2\nfamille MARTIN ; 3\nZoé ; 99' })

    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.households.map((h: { name: string }) => h.name)).toEqual([
      'Famille Martin',
      'Léa Durand',
    ])
    expect(response.body.households[0].token).toMatch(/^[0-9A-Z]{16}$/)
    expect(response.body.skipped).toEqual([
      { line: 3, reason: 'duplicate' },
      { line: 4, reason: 'places' },
    ])
    expect(actionsOf(world)).toEqual(['event.householdsImported'])
    expect(JSON.stringify(world.audit.all())).not.toMatch(/Martin|Durand/)
  })

  it('answers 400 to a paste of more than 300 lines, a stray key, and a text that is not text', async () => {
    const agent = await signedIn(world, 'owner')
    const many = Array.from({ length: 301 }, (_, i) => `F${i}`).join('\n')

    const long = await agent.post(`${HOUSEHOLDS}/import`).send({ text: many })
    const stray = await agent.post(`${HOUSEHOLDS}/import`).send({ text: 'A', more: 1 })
    const notText = await agent.post(`${HOUSEHOLDS}/import`).send({ text: 12 })

    expect(long.status).toBe(400)
    expect(long.body.error.code).toBe('household.importTooLong')
    expect(stray.status).toBe(400)
    expect(notText.status).toBe(400)
  })

  it('changes a household, and keeps its link', async () => {
    const agent = await signedIn(world, 'owner')
    const created = await addHousehold(agent)

    const changed = await agent
      .put(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`)
      .send({ name: 'Les Martin', places: 2 })

    expect(changed.status).toBe(200)
    expect(changed.body.household).toMatchObject({ name: 'Les Martin', places: 2 })
    expect(changed.body.household.token).toBe(created.body.household.token)
  })

  it('answers 404 household.notFound for an id that is not this event’s, 400 for one that is no id', async () => {
    const agent = await signedIn(world, 'owner')

    const unknown = await agent.put(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`).send({ name: 'A', places: 1 })
    const malformed = await agent.put(`${HOUSEHOLDS}/not-an-id`).send({ name: 'A', places: 1 })

    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('household.notFound')
    expect(malformed.status).toBe(400)
  })

  it('gives a new link on rotate, and notes a reminder, both answering the household', async () => {
    const agent = await signedIn(world, 'owner')
    const created = await addHousehold(agent)

    const rotated = await agent.post(`${HOUSEHOLDS}/${HOUSEHOLD_ID}/rotate`).send({})
    const reminded = await agent.post(`${HOUSEHOLDS}/${HOUSEHOLD_ID}/reminded`).send({})

    expect(rotated.status).toBe(200)
    expect(rotated.headers['cache-control']).toBe('no-store')
    expect(rotated.body.household.token).not.toBe(created.body.household.token)
    expect(reminded.status).toBe(200)
    expect(reminded.body.household.remindedAt).not.toBeNull()
    expect(reminded.body.household.token).toBe(rotated.body.household.token)
    expect(actionsOf(world)).toEqual(['event.householdTokenRotated'])
  })

  it('refuses a body on rotate and reminded', async () => {
    const agent = await signedIn(world, 'owner')
    await addHousehold(agent)

    expect((await agent.post(`${HOUSEHOLDS}/${HOUSEHOLD_ID}/rotate`).send({ a: 1 })).status).toBe(
      400,
    )
    expect((await agent.post(`${HOUSEHOLDS}/${HOUSEHOLD_ID}/reminded`).send({ a: 1 })).status).toBe(
      400,
    )
  })

  it('deletes a household, 204, and keeps the reply it had, detached', async () => {
    const agent = await signedIn(world, 'owner')
    await addHousehold(agent)
    world.rsvps.seed(
      aRsvp({
        id: '66666666-6666-4666-8666-666666666666',
        eventId: WEDDING,
        householdId: HOUSEHOLD_ID,
      }),
    )

    const deleted = await agent.delete(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`)

    expect(deleted.status).toBe(204)
    expect((await agent.get(HOUSEHOLDS)).body.households).toEqual([])
    const replies = (await agent.get(RSVPS)).body.rsvps
    expect(replies).toHaveLength(1)
    expect(replies[0].householdId).toBeNull()
    expect(actionsOf(world)).toEqual(['event.householdDeleted'])
    expect((await agent.delete(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`)).status).toBe(404)
  })

  it('files a reply under a household and detaches it, and the list and the figures follow', async () => {
    const agent = await signedIn(world, 'owner')
    await addHousehold(agent)
    await addHousehold(agent, { name: 'Les Durand', places: 2 })
    const reply = await agent.post(RSVPS).send(REPLY)
    const rsvpId = reply.body.rsvp.id

    const filed = await agent
      .post(`${RSVPS}/${rsvpId}/household`)
      .send({ householdId: HOUSEHOLD_ID })

    expect(filed.status).toBe(200)
    expect(filed.body.rsvp.householdId).toBe(HOUSEHOLD_ID)
    const list = await agent.get(HOUSEHOLDS)
    expect(list.body.households[0].reply).toEqual({ id: rsvpId, answer: 'yes', people: 3 })
    expect(list.body.households[1].reply).toBeNull()
    expect((await agent.get(RSVPS)).body.stats.noReply).toEqual({ households: 1, places: 2 })

    const detached = await agent.post(`${RSVPS}/${rsvpId}/household`).send({ householdId: null })
    expect(detached.body.rsvp.householdId).toBeNull()
    expect((await agent.get(RSVPS)).body.stats.noReply).toEqual({ households: 2, places: 6 })
  })

  it('answers 409 when the household already has a reply, 404 for one that is not there, 400 for a bad body', async () => {
    const agent = await signedIn(world, 'owner')
    await addHousehold(agent)
    const first = (await agent.post(RSVPS).send(REPLY)).body.rsvp.id
    const second = (await agent.post(RSVPS).send({ ...REPLY, name: 'Autre' })).body.rsvp.id
    await agent.post(`${RSVPS}/${first}/household`).send({ householdId: HOUSEHOLD_ID }).expect(200)

    const taken = await agent
      .post(`${RSVPS}/${second}/household`)
      .send({ householdId: HOUSEHOLD_ID })
    const nobody = await agent
      .post(`${RSVPS}/${second}/household`)
      .send({ householdId: 'd2000000-0000-4000-8000-0000000000ff' })
    const stray = await agent.post(`${RSVPS}/${second}/household`).send({ householdId: 3 })
    const missing = await agent.post(`${RSVPS}/${second}/household`).send({})

    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('household.alreadyAnswered')
    expect(nobody.status).toBe(404)
    expect(nobody.body.error.code).toBe('household.notFound')
    expect(stray.status).toBe(400)
    expect(missing.status).toBe(400)
  })

  it('is the owner’s: 401 without a session, 403 for a moderator, 404 for the owner of another event', async () => {
    const owner = await signedIn(world, 'owner')
    await addHousehold(owner)

    const anonymous = await request(world.app).get(HOUSEHOLDS)
    const moderator = await (await signedIn(world, 'moderator')).get(HOUSEHOLDS)
    const stranger = await (await signedIn(world, 'gala-owner')).get(HOUSEHOLDS)
    const strangerWrite = await (
      await signedIn(world, 'gala-owner')
    ).delete(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`)

    expect(anonymous.status).toBe(401)
    expect(moderator.status).toBe(403)
    expect(stranger.status).toBe(404)
    expect(strangerWrite.status).toBe(404)
    expect(await world.households.count(WEDDING)).toBe(1)
  })

  it('never reads or touches another event’s household through this event’s path', async () => {
    const owner = await signedIn(world, 'owner')
    world.households.seed(
      aHousehold({ id: HOUSEHOLD_ID, eventId: GALA, token: '00000000000000AA' }),
    )

    const read = await owner.get(HOUSEHOLDS)
    const changed = await owner.put(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`).send({ name: 'A', places: 1 })
    const deleted = await owner.delete(`${HOUSEHOLDS}/${HOUSEHOLD_ID}`)

    expect(read.body.households).toEqual([])
    expect(changed.status).toBe(404)
    expect(deleted.status).toBe(404)
    expect(await world.households.count(GALA)).toBe(1)
  })
})

describe('the moments of the party: the form and the households (lot 4)', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('saves up to four moments, mints their ids, and keeps an id when the label is rewritten', async () => {
    const agent = await signedIn(world, 'owner')

    const saved = await agent
      .put(FORM)
      .send({ enabled: true, form: { moments: [{ label: 'Brunch' }, { label: 'Dîner' }] } })
    const [brunch, dinner] = saved.body.rsvpForm.form.moments
    const renamed = await agent.put(FORM).send({
      form: {
        moments: [
          { id: dinner.id, label: 'Grand dîner' },
          { id: brunch.id, label: 'Brunch' },
        ],
      },
    })

    expect(saved.status).toBe(200)
    expect(brunch.id).toMatch(/^[0-9a-f]{8}$/)
    expect(renamed.body.rsvpForm.form.moments).toEqual([
      { id: dinner.id, label: 'Grand dîner' },
      brunch,
    ])
  })

  it('refuses five moments and an unknown key in one', async () => {
    const agent = await signedIn(world, 'owner')

    const five = await agent
      .put(FORM)
      .send({ form: { moments: ['a', 'b', 'c', 'd', 'e'].map((label) => ({ label })) } })
    const stray = await agent.put(FORM).send({ form: { moments: [{ label: 'A', colour: 'red' }] } })

    expect(five.status).toBe(400)
    expect(five.body.error.code).toBe('rsvp.momentsInvalid')
    expect(stray.body.error.code).toBe('rsvp.momentsInvalid')
  })

  it('stores the moments a household is invited to, shows them in its row, and judges them against the form', async () => {
    const agent = await signedIn(world, 'owner')
    const form = await agent.put(FORM).send({
      enabled: true,
      form: { moments: [{ label: 'Brunch' }, { label: 'Dîner' }] },
    })
    const [brunch] = form.body.rsvpForm.form.moments

    const created = await agent
      .post(HOUSEHOLDS)
      .send({ name: 'Famille Martin', places: 4, moments: [brunch.id] })
    const refused = await agent
      .post(HOUSEHOLDS)
      .send({ name: 'Les Durand', places: 2, moments: ['dddddddd'] })
    const listed = await agent.get(HOUSEHOLDS)

    expect(created.status).toBe(201)
    expect(created.body.household.moments).toEqual([brunch.id])
    expect(refused.body.error.code).toBe('household.momentsInvalid')
    expect(listed.body.households[0].moments).toEqual([brunch.id])
  })

  it('counts, per moment, who comes, in the figures of the replies', async () => {
    const agent = await signedIn(world, 'owner')
    const form = await agent
      .put(FORM)
      .send({ enabled: true, form: { moments: [{ label: 'Brunch' }, { label: 'Dîner' }] } })
    const [brunch, dinner] = form.body.rsvpForm.form.moments

    await agent
      .post(RSVPS)
      .send({ name: 'Léa', answer: 'yes', adults: 2, moments: [brunch.id, dinner.id] })
      .expect(201)
    await agent
      .post(RSVPS)
      .send({ name: 'Hugo', answer: 'maybe', adults: 1, moments: [dinner.id] })
      .expect(201)

    const listed = await agent.get(RSVPS)

    expect(listed.body.stats.moments).toEqual([
      {
        ...brunch,
        yes: { responses: 1, people: 2 },
        maybe: { responses: 0, people: 0 },
      },
      {
        ...dinner,
        yes: { responses: 1, people: 2 },
        maybe: { responses: 1, people: 1 },
      },
    ])
  })
})
