import type { Express } from 'express'
import type { Agent } from 'supertest'
import { describe, expect, it } from 'vitest'
import { aUser } from '../../../application/testing/builders'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakeMailPreferenceRepository } from '../../../application/testing/fakeMailPreferenceRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import {
  makeGetMailPreferences,
  makeSetMailPreferences,
} from '../../../application/usecases/notices/mailPreferences'
import { asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import request from '../testing/request'
import type { HttpDeps } from '../types'
import { mailPreferenceRoutes } from './mailPreferenceRoutes'

/**
 * The account's own e-mail choices (spec 32), through a real Express app: a signed-in account reads and
 * changes **its own** two switches, a stray key or a non-boolean is a refusal, nothing is answered to a
 * visitor, and the answer says whether the switches mean anything on this box.
 */

const HOST = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const URL = '/api/me/mail-preferences'

interface World {
  readonly app: Express
  readonly preferences: FakeMailPreferenceRepository
  readonly audit: FakeAuditLog
}

const buildWorld = (over: { canDeliver?: boolean; hostMailNotices?: boolean } = {}): World => {
  const users = new FakeUserRepository()
  const preferences = new FakeMailPreferenceRepository().withUsers(asUserId(HOST), asUserId(OTHER))
  const audit = new FakeAuditLog().withAccounts(asUserId(HOST), asUserId(OTHER))
  const harness = buildHarness({
    users,
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, users }
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'hote@example.test' }))
      app.post('/sign-in/other', signInAs({ userId: OTHER, email: 'autre@example.test' }))
      app.use(
        '/api',
        mailPreferenceRoutes({
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
          usecases: {
            getMailPreferences: makeGetMailPreferences({
              users,
              preferences,
              mailer: { canDeliver: over.canDeliver ?? true },
              hostMailNotices: over.hostMailNotices ?? true,
            }),
            setMailPreferences: makeSetMailPreferences({
              users,
              preferences,
              audit,
              clock: deps.clock,
            }),
          },
        }),
      )
    },
  })
  users.seed(
    aUser({ id: HOST, email: 'hote@example.test' }),
    aUser({ id: OTHER, email: 'autre@example.test' }),
  )
  return { app: harness.app, preferences, audit }
}

const signedIn = async (world: World, who: 'host' | 'other' = 'host'): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

describe('GET /api/me/mail-preferences', () => {
  it('gives an account that never touched them both switches on, no-store', async () => {
    const response = await (await signedIn(buildWorld())).get(URL)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ rsvp: true, event: true, available: true })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('says what the account chose, and the other accounts are not read', async () => {
    const world = buildWorld()
    await world.preferences.save(asUserId(OTHER), { rsvp: false, event: false })

    const response = await (await signedIn(world)).get(URL)

    expect(response.body).toMatchObject({ rsvp: true, event: true })
  })

  it.each([
    [true, true, true],
    [false, true, false],
    [true, false, false],
  ])(
    'is available only with a relay that delivers (%s) and HOST_MAIL_NOTICES on (%s): %s',
    async (canDeliver, hostMailNotices, available) => {
      const response = await (await signedIn(buildWorld({ canDeliver, hostMailNotices }))).get(URL)

      expect(response.body.available).toBe(canDeliver && hostMailNotices)
      expect(response.body.available).toBe(available)
    },
  )

  it('is 401 without a session', async () => {
    expect((await request(buildWorld().app).get(URL)).status).toBe(401)
  })
})

describe('PUT /api/me/mail-preferences', () => {
  it('changes the switch it names, answers 204 and leaves the other', async () => {
    const world = buildWorld()
    const agent = await signedIn(world)

    const response = await agent.put(URL).send({ rsvp: false })

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(response.headers['cache-control']).toBe('no-store')
    expect((await agent.get(URL)).body).toEqual({ rsvp: false, event: true, available: true })
  })

  it('changes the caller’s switches only: there is no parameter to name another account', async () => {
    const world = buildWorld()

    await (await signedIn(world, 'host')).put(URL).send({ rsvp: false, event: false }).expect(204)

    expect(await world.preferences.forUser(asUserId(OTHER))).toEqual({ rsvp: true, event: true })
    expect(await world.preferences.forUser(asUserId(HOST))).toEqual({ rsvp: false, event: false })
  })

  it('refuses a stray key, a value that is not a boolean and a body that is not an object', async () => {
    const agent = await signedIn(buildWorld())

    const stray = await agent.put(URL).send({ rsvp: false, userId: OTHER })
    const text = await agent.put(URL).send({ rsvp: 'false' })
    const number = await agent.put(URL).send({ event: 0 })

    expect([stray, text, number].map((response) => response.status)).toEqual([400, 400, 400])
    expect([stray, text, number].map((response) => response.body.error.code)).toEqual([
      'request.invalid',
      'request.invalid',
      'request.invalid',
    ])
  })

  it('records the change in the audit log, with no content', async () => {
    const world = buildWorld()

    await (await signedIn(world)).put(URL).send({ event: false }).expect(204)

    expect(world.audit.all().map((entry) => [entry.action, entry.details])).toEqual([
      ['account.mailPreferencesChanged', {}],
    ])
  })

  it('is 401 without a session, and changes nothing', async () => {
    const world = buildWorld()

    const response = await request(world.app).put(URL).send({ rsvp: false })

    expect(response.status).toBe(401)
    expect(await world.preferences.forUser(asUserId(HOST))).toEqual({ rsvp: true, event: true })
  })
})
