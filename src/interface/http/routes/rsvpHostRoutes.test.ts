import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../../application/testing/fakeGuestRsvpRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { RecordingEventBus } from '../../../application/testing/recordingEventBus'
import { asGuestRsvpId, type GuestRsvpId } from '../../../domain/shared/ids'
import { makeEnableGuestInvite } from '../../../application/usecases/guestInvites/enableGuestInvite'
import { makeSaveGuestInvite } from '../../../application/usecases/guestInvites/saveGuestInvite'
import {
  makeCloseRsvps,
  makeReopenRsvps,
} from '../../../application/usecases/guestRsvps/closeRsvps'
import { makeExportRsvps } from '../../../application/usecases/guestRsvps/exportRsvps'
import { makeGetRsvpForm } from '../../../application/usecases/guestRsvps/getRsvpForm'
import { makeHostAddRsvp } from '../../../application/usecases/guestRsvps/hostAddRsvp'
import { makeHostDeleteRsvp } from '../../../application/usecases/guestRsvps/hostDeleteRsvp'
import { makeHostUpdateRsvp } from '../../../application/usecases/guestRsvps/hostUpdateRsvp'
import { makeListRsvps } from '../../../application/usecases/guestRsvps/listRsvps'
import { makeMarkRsvpsSeen } from '../../../application/usecases/guestRsvps/markRsvpsSeen'
import { makeSaveRsvpForm } from '../../../application/usecases/guestRsvps/saveRsvpForm'
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
  const bus = new RecordingEventBus()
  const audit = new FakeAuditLog().withAccounts(
    asUserId(OWNER),
    asUserId(MODERATOR),
    asUserId(GALA_OWNER),
  )
  // The fake's ids are not uuids, and the routes take a reply id from a path: only a uuid is one.
  const ids = new (class extends SequentialIdGenerator {
    private rsvpCount = 0
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
            listRsvps: makeListRsvps({ ...access, rsvps, clock }),
            hostAddRsvp: makeHostAddRsvp({ ...access, rsvps, audit, bus, ids, clock }),
            hostUpdateRsvp: makeHostUpdateRsvp({ ...access, rsvps, audit, bus, clock }),
            hostDeleteRsvp: makeHostDeleteRsvp({ ...access, rsvps, audit, bus, clock }),
            exportRsvps: makeExportRsvps({ ...access, rsvps, audit, clock }),
            markRsvpsSeen: makeMarkRsvpsSeen({ ...access, rsvps, clock }),
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

  return { app: harness.app, rsvps, audit, bus, invites }
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
