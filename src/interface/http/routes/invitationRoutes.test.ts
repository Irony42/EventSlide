import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { atPlus } from '../../../application/testing/builders'
import {
  EVENT_ID,
  EXISTING_EMAIL,
  EXISTING_ID,
  HOST_ID,
  NEWCOMER,
  makeInvitationWorld,
  type InvitationWorld,
} from '../../../application/testing/invitationWorld'
import { makeAcceptInvitation } from '../../../application/usecases/auth/acceptInvitation'
import { makePreviewInvitation } from '../../../application/usecases/auth/previewInvitation'
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, requireCsrfToken } from '../middleware/csrf'
import { requireUser } from '../middleware/authz'
import { buildHarness, signInAs, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import { invitationRoutes } from './invitationRoutes'

const PASSWORD = 'une phrase de passe 2026'
const CREDENTIALS = { password: PASSWORD, displayName: 'Camille Dupont' }
const SESSION_COOKIE_IN_HARNESS = 'connect.sid'

interface Subject extends Harness {
  readonly world: InvitationWorld
}

interface Options {
  readonly config?: Partial<HttpConfig>
  readonly csrf?: boolean
}

const harness = ({ config = {}, csrf = false }: Options = {}): Subject => {
  const world = makeInvitationWorld()

  const built = buildHarness({
    config,
    users: world.users,
    routes: (app, deps) => {
      app.post('/test/sign-in/existing', signInAs({ userId: EXISTING_ID, email: EXISTING_EMAIL }))
      app.post('/test/sign-in/host', signInAs({ userId: HOST_ID, email: 'hote@example.test' }))

      if (csrf) {
        app.use(issueCsrfToken({ secureCookie: deps.config.secureCookie }))
        app.use('/api', requireCsrfToken)
      }

      // Who the session is, read the way a gated route reads it: after an acceptance this is
      // what shows the person arrived signed in.
      app.get('/api/probe/who', requireUser({ ...deps, users: world.users }), (req, res) => {
        res.json({ userId: req.context.user?.userId ?? null })
      })

      app.use(
        '/api',
        invitationRoutes({
          deps: { ...deps, users: world.users },
          usecases: {
            previewInvitation: makePreviewInvitation({
              tokens: world.tokens,
              secrets: world.secrets,
              events: world.events,
              clients: world.clients,
              memberships: world.memberships,
              clock: world.clock,
            }),
            acceptInvitation: makeAcceptInvitation({
              tokens: world.tokens,
              secrets: world.secrets,
              events: world.events,
              clients: world.clients,
              memberships: world.memberships,
              users: world.users,
              hasher: world.hasher,
              acceptance: world.acceptance,
              ids: world.ids,
              clock: world.clock,
            }),
          },
        }),
      )
    },
  })

  return { ...built, world }
}

const setCookies = (headers: Record<string, unknown>): readonly string[] => {
  const raw = headers['set-cookie']
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.map((entry) => String(entry))
  return []
}

const cookieNamed = (headers: Record<string, unknown>, name: string): string | undefined =>
  setCookies(headers).find((cookie) => cookie.startsWith(`${name}=`))

const NOT_FOUND = { error: { code: 'invitation.notFound' } }

const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error('invalid fixture')
  return parsed.value
}

describe('GET /api/invitations/:token', () => {
  it('says what the link offers: the purpose, the target and when it ends, and nothing else', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await request(subject.app).get(`/api/invitations/${token}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      kind: 'event',
      role: 'moderator',
      targetName: 'Mariage de Camille',
      expiresAt: atPlus(7 * 24 * 60 * 60 * 1000).toISOString(),
    })
  })

  it('is never cached', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await request(subject.app).get(`/api/invitations/${token}`)

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('says the same for an address that has an account and one that has not', async () => {
    const subject = harness()
    const unknown = await subject.world.invite({ email: NEWCOMER })
    const known = await subject.world.invite({ email: EXISTING_EMAIL })

    const first = await request(subject.app).get(`/api/invitations/${unknown.token}`)
    const second = await request(subject.app).get(`/api/invitations/${known.token}`)

    expect(second.body).toEqual(first.body)
  })

  it('spends nothing, so a mail client that fetches links to preview them cannot use one up', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    await request(subject.app).get(`/api/invitations/${token}`)
    await request(subject.app).get(`/api/invitations/${token}`)

    const accepted = await request(subject.app)
      .post(`/api/invitations/${token}/accept`)
      .send(CREDENTIALS)
    expect(accepted.status).toBe(200)
  })

  it.each([
    ['one nobody issued', async () => 'secret-99'],
    ['one that is not even shaped like a token', async () => 'x'],
    ['one far too long to be one', async () => 'a'.repeat(300)],
  ])('answers 404 invitation.notFound for %s', async (_label, tokenOf) => {
    const subject = harness()

    const response = await request(subject.app).get(`/api/invitations/${await tokenOf()}`)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject(NOT_FOUND)
  })

  it('answers every dead link with the same status and body: spent, revoked, expired', async () => {
    const subject = harness()
    const dead = [
      await subject.world.invite({ consumedAt: atPlus(-1) }),
      await subject.world.invite({ revokedAt: atPlus(-1) }),
      await subject.world.invite({ expiresAt: atPlus(1_000) }),
    ]
    subject.world.clock.set(atPlus(1_000))

    const answers = await Promise.all(
      [...dead.map(({ token }) => token), 'secret-99'].map((token) =>
        request(subject.app).get(`/api/invitations/${token}`),
      ),
    )

    expect(
      new Set(answers.map((answer) => `${answer.status} ${JSON.stringify(answer.body)}`)).size,
    ).toBe(1)
    expect(answers[0]?.status).toBe(404)
  })

  it('is public: it answers a stranger with no session', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await request(subject.app).get(`/api/invitations/${token}`)

    expect(response.status).toBe(200)
  })

  it('is limited per client address, with its own allowance', async () => {
    const subject = harness({
      config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 3 } },
    })
    const { token } = await subject.world.invite()

    const statuses: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await request(subject.app).get(`/api/invitations/${token}`)).status)
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429])
  })
})

describe('POST /api/invitations/:token/accept, choosing a password', () => {
  const accept = (subject: Subject, token: string, body: Record<string, unknown> = CREDENTIALS) =>
    request.agent(subject.app).post(`/api/invitations/${token}/accept`).send(body)

  it('creates the account, grants the role and says where the person lands', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await accept(subject, token)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'accepted',
      kind: 'event',
      role: 'moderator',
      targetName: 'Mariage de Camille',
      eventSlug: 'mariage-de-camille',
    })
    const created = await subject.world.users.findByEmail(emailOf(NEWCOMER))
    expect(created?.displayName).toBe('Camille Dupont')
    expect(
      (await subject.world.memberships.membershipFor(asEventId(EVENT_ID), created!.id))?.role,
    ).toBe('moderator')
  })

  it('never tells the holder of a link whose mailbox it was: no address and no id in the answer', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await accept(subject, token)

    expect(JSON.stringify(response.body)).not.toContain(NEWCOMER)
    expect(Object.keys(response.body)).not.toContain('userId')
    expect(Object.keys(response.body)).not.toContain('email')
  })

  it('signs the new account in with a fresh session, so the person arrives on the event', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()
    const agent = request.agent(subject.app)

    const response = await agent.post(`/api/invitations/${token}/accept`).send(CREDENTIALS)
    const who = await agent.get('/api/probe/who')

    expect(cookieNamed(response.headers, SESSION_COOKIE_IN_HARNESS)).toBeTruthy()
    const created = await subject.world.users.findByEmail(emailOf(NEWCOMER))
    expect(who.body).toEqual({ userId: created?.id })
  })

  it('replaces a session planted before it, so a fixated id does not survive', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()
    const agent = request.agent(subject.app)
    const planted = await agent.post('/test/sign-in/host').expect(204)

    const response = await agent.post(`/api/invitations/${token}/accept`).send(CREDENTIALS)

    expect(cookieNamed(response.headers, SESSION_COOKIE_IN_HARNESS)).toBeTruthy()
    expect(cookieNamed(response.headers, SESSION_COOKIE_IN_HARNESS)).not.toBe(
      cookieNamed(planted.headers, SESSION_COOKIE_IN_HARNESS),
    )
    // The planted session was the host's; the one the person ends up with is the new account's.
    const who = await agent.get('/api/probe/who')
    expect(who.body.userId).not.toBe(HOST_ID)
  })

  it('is never cached', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await accept(subject, token)

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('spends the link: the second time it is a 404, with no session', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()
    await accept(subject, token)

    const again = await accept(subject, token, {
      password: 'une autre phrase de passe 2026',
      displayName: 'Intrus',
    })

    expect(again.status).toBe(404)
    expect(again.body).toMatchObject(NOT_FOUND)
    expect(cookieNamed(again.headers, SESSION_COOKIE_IN_HARNESS)).toBeUndefined()
  })

  it('answers 400 for a password the policy refuses, starts no session, and leaves the link usable', async () => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const refused = await accept(subject, token, { password: 'court', displayName: 'Camille' })

    expect(refused.status).toBe(400)
    expect(cookieNamed(refused.headers, SESSION_COOKIE_IN_HARNESS)).toBeUndefined()
    expect(await subject.world.users.findByEmail(emailOf(NEWCOMER))).toBeNull()
    expect((await accept(subject, token)).status).toBe(200)
  })

  it('answers 409 invitation.signInRequired for an address that has an account, with no session and nothing spent', async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })

    const response = await accept(subject, token)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('invitation.signInRequired')
    expect(cookieNamed(response.headers, SESSION_COOKIE_IN_HARNESS)).toBeUndefined()
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
  })

  it.each([
    ['an account id', { ...CREDENTIALS, userId: HOST_ID }],
    ['an address', { ...CREDENTIALS, email: 'autre@example.test' }],
    ['no name', { password: PASSWORD }],
    ['no password', { displayName: 'Camille' }],
    ['a password of the wrong type', { password: 12345, displayName: 'Camille' }],
  ])('answers 400 for a body with %s, and writes nothing', async (_label, body) => {
    const subject = harness()
    const { token } = await subject.world.invite()

    const response = await accept(subject, token, body)

    expect(response.status).toBe(400)
    expect(await subject.world.users.findByEmail(emailOf(NEWCOMER))).toBeNull()
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
  })

  it.each(['secret-99', 'x', 'a'.repeat(300)])('answers 404 for the link %j', async (token) => {
    const subject = harness()

    const response = await accept(subject, token)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject(NOT_FOUND)
  })

  it('needs the CSRF token like every write, since it creates an account and a session', async () => {
    const subject = harness({ csrf: true })
    const { token } = await subject.world.invite()

    const bare = await request(subject.app)
      .post(`/api/invitations/${token}/accept`)
      .send(CREDENTIALS)
    expect(await subject.world.users.findByEmail(emailOf(NEWCOMER))).toBeNull()
    const agent = request.agent(subject.app)
    const first = await agent.get('/api/probe/who')
    const csrf = cookieNamed(first.headers, CSRF_COOKIE)
      ?.slice(CSRF_COOKIE.length + 1)
      .split(';')[0]
    const withToken = await agent
      .post(`/api/invitations/${token}/accept`)
      .set(CSRF_HEADER, csrf ?? '')
      .send(CREDENTIALS)

    expect(bare.status).toBe(403)
    expect(withToken.status).toBe(200)
  })

  it('does not spend the allowance of the preview', async () => {
    const subject = harness({
      config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 2 } },
    })
    await request(subject.app).get('/api/invitations/secret-99')
    await request(subject.app).get('/api/invitations/secret-99')
    expect((await request(subject.app).get('/api/invitations/secret-99')).status).toBe(429)

    const response = await accept(subject, 'secret-99')

    expect(response.status).toBe(404)
  })

  it('is limited per client address, with its own allowance', async () => {
    const subject = harness({
      config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 2 } },
    })

    const statuses: number[] = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await accept(subject, 'secret-99')).status)
    }

    expect(statuses).toEqual([404, 404, 429, 429])
  })
})

describe('POST /api/invitations/:token/accept, as the signed-in account', () => {
  const asExisting = async (subject: Subject) => {
    const agent = request.agent(subject.app)
    await agent.post('/test/sign-in/existing').expect(204)
    return agent
  }

  it('attaches the account whose address the link was written to, and starts no new session', async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })
    const agent = await asExisting(subject)

    const response = await agent.post(`/api/invitations/${token}/accept`).send({})

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'accepted', eventSlug: 'mariage-de-camille' })
    expect(
      (await subject.world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)))
        ?.role,
    ).toBe('moderator')
    expect(cookieNamed(response.headers, SESSION_COOKIE_IN_HARNESS)).toBeUndefined()
  })

  it("answers 400 invitation.credentialsRequired with no session, and leaves the link unspent: the account is the session's", async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })

    const response = await request(subject.app).post(`/api/invitations/${token}/accept`).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invitation.credentialsRequired')
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
  })

  it('answers 403 invitation.wrongAccount for another signed-in account, and spends nothing', async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })
    const agent = request.agent(subject.app)
    await agent.post('/test/sign-in/host').expect(204)

    const response = await agent.post(`/api/invitations/${token}/accept`).send({})

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('invitation.wrongAccount')
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
  })

  it('answers 404 for a dead link even with a session', async () => {
    const subject = harness()
    const agent = await asExisting(subject)

    const response = await agent.post('/api/invitations/secret-99/accept').send({})

    expect(response.status).toBe(404)
  })

  it('answers 400 for a session whose account has been switched off since, and spends nothing', async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })
    const agent = await asExisting(subject)
    const account = await subject.world.users.findById(asUserId(EXISTING_ID))
    await subject.world.users.save(account!.disable(atPlus(1)))

    const response = await agent.post(`/api/invitations/${token}/accept`).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invitation.credentialsRequired')
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
    expect(
      await subject.world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)),
    ).toBeNull()
  })

  it('does not take an account from the request: a body that names one is refused', async () => {
    const subject = harness()
    const { token } = await subject.world.invite({ email: EXISTING_EMAIL })
    const agent = await asExisting(subject)

    const response = await agent.post(`/api/invitations/${token}/accept`).send({ userId: HOST_ID })

    expect(response.status).toBe(400)
    expect(subject.world.tokens.all[0]?.consumedAt).toBeNull()
  })
})
