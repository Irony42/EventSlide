import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { anAccountToken, atPlus } from '../../../application/testing/builders'
import { INVITATION_MAX_PER_ADDRESS_PER_HOUR } from '../../../domain/users/accountToken'
import { CSRF_HEADER } from '../middleware/csrf'
import { ADDRESS, ID, aBox } from '../testing/siteBox'
import { SELF_HOST_LINK, type SiteHarnessOptions } from '../testing/siteHarness'
import { A_SIGNUP, SIGNUPPER, SIGNUP_SPACE, seedSignup } from '../testing/siteSignups'
import { encodeSignupCursor } from '../signupCursor'

/**
 * Ring 4. The operator's side of the self-service signup over the wire (spec 31, PR 4): the list with its
 * cursor, the approval that opens a client, the refusal. The rules are held at ring 2 (`approveSignup.test.ts`
 * and its siblings); what only the wire can break is held here: the contract's shape, the step-up and the
 * limiter, that an unproven address is out of reach, and that no answer carries a link.
 */

const operator = async (options: SiteHarnessOptions = {}) => {
  const { site } = await aBox(options)
  const caller = await site.signInAsOperator()
  const get = (path: string): request.Test => caller.agent.get(path)
  const post = (path: string, body: object): request.Test =>
    caller.agent.post(path).set(CSRF_HEADER, caller.csrf).send(body)
  const logged = async () =>
    (await caller.agent.get('/api/site/audit')).body.items as readonly {
      readonly action: string
      readonly clientId: string | null
      readonly actor: { readonly kind: string; readonly userId: string | null }
      readonly subject: { readonly type: string; readonly id: string }
      readonly details: Record<string, unknown>
    }[]
  return { site, caller, get, post, logged }
}

const SECOND = '77777777-7777-4777-8777-777777777777'
const THIRD = '66666666-6666-4666-8666-666666666666'

describe('GET /api/site/signups', () => {
  it('answers the contract’s shape for a pending request, newest first, with the badge', async () => {
    const { site, get } = await operator()
    await seedSignup(site, { note: 'un mariage', eventDate: '2027-06-12' })

    const response = await get('/api/site/signups?status=pending')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      items: [
        {
          id: A_SIGNUP,
          email: SIGNUPPER,
          clientName: SIGNUP_SPACE,
          note: 'un mariage',
          eventDate: '2027-06-12',
          locale: 'fr',
          status: 'pending',
          createdAt: expect.any(String),
          confirmedAt: expect.any(String),
          decidedAt: null,
          clientId: null,
          existingAccount: false,
        },
      ],
      pendingCount: 1,
      next: null,
    })
  })

  it('defaults to the pending requests', async () => {
    const { site, get } = await operator()
    await seedSignup(site)

    const response = await get('/api/site/signups')

    expect(response.body.items).toHaveLength(1)
  })

  it('says existingAccount for an address that already has an account', async () => {
    const { site, get } = await operator()
    await seedSignup(site, { email: ADDRESS.owner })

    const response = await get('/api/site/signups')

    expect(response.body.items[0].existingAccount).toBe(true)
  })

  it('never shows an unproven request, and does not count it', async () => {
    const { site, get } = await operator()
    await seedSignup(site, { unconfirmed: true })

    const response = await get('/api/site/signups?status=pending')

    expect(response.body).toEqual({ items: [], pendingCount: 0, next: null })
  })

  it('pages with an opaque cursor, at the limit asked for', async () => {
    const { site, get } = await operator()
    const at = site.clock.now().getTime()
    await seedSignup(site, { id: A_SIGNUP, email: 'a@example.test', at: new Date(at - 3000) })
    await seedSignup(site, { id: SECOND, email: 'b@example.test', at: new Date(at - 2000) })
    await seedSignup(site, { id: THIRD, email: 'c@example.test', at: new Date(at - 1000) })

    const first = await get('/api/site/signups?limit=2')
    expect(first.body.items.map((row: { id: string }) => row.id)).toEqual([THIRD, SECOND])
    expect(typeof first.body.next).toBe('string')
    expect(first.body.next).not.toContain(SECOND)

    const second = await get(`/api/site/signups?limit=2&before=${first.body.next}`)
    expect(second.body.items.map((row: { id: string }) => row.id)).toEqual([A_SIGNUP])
    expect(second.body.next).toBeNull()
  })

  it('lists approved and refused requests after a decision', async () => {
    const { site, get, post } = await operator()
    await seedSignup(site)
    await seedSignup(site, { id: SECOND, email: 'b@example.test' })
    await post(`/api/site/signups/${A_SIGNUP}/approve`, {})
    await post(`/api/site/signups/${SECOND}/refuse`, { notify: false })

    const approved = await get('/api/site/signups?status=approved')
    const refused = await get('/api/site/signups?status=refused')

    expect(approved.body.items[0]).toMatchObject({
      id: A_SIGNUP,
      status: 'approved',
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      decidedAt: expect.any(String),
    })
    expect(refused.body.items[0]).toMatchObject({ id: SECOND, status: 'refused' })
    expect(approved.body.pendingCount).toBe(0)
  })

  it.each([
    ['an unknown status', '?status=expired'],
    ['unconfirmed, which an operator may not ask for', '?status=unconfirmed'],
    ['a limit of 101', '?limit=101'],
    ['a limit of 0', '?limit=0'],
    ['a cursor nobody wrote', '?before=not-a-cursor'],
    [
      'a cursor with a bad position',
      `?before=${Buffer.from('{"at":"x","id":"y"}').toString('base64url')}`,
    ],
    ['a key the contract does not have', '?after=x'],
  ])('answers 400 request.invalid for %s', async (_name, query) => {
    const { get } = await operator()

    const response = await get(`/api/site/signups${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('accepts a cursor this server wrote, even one for an instant with no row', async () => {
    const { get } = await operator()
    const before = encodeSignupCursor({ at: atPlus(0), id: A_SIGNUP })

    const response = await get(`/api/site/signups?before=${before}`)

    expect(response.status).toBe(200)
  })
})

describe('POST /api/site/signups/:id/approve', () => {
  it('opens the client, answers 201 like the client provisioning, and sends the owner’s invitation by mail', async () => {
    const { site, post } = await operator()
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      invitation: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        delivery: 'mail',
        expiresAt: atPlus(7 * 24 * 60 * 60 * 1000).toISOString(),
        pendingApproval: false,
      },
    })
    const invitation = site.mailer?.sent.find((mail) => mail.to === SIGNUPPER)
    expect(invitation).toBeDefined()
  })

  it('names the space after what the person typed and keeps their language', async () => {
    const { site, caller, post } = await operator()
    await seedSignup(site, { locale: 'de' })

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    const clients = (await caller.agent.get('/api/site/clients?limit=200')).body.items as {
      id: string
      name: string
    }[]
    expect(clients.find((row) => row.id === response.body.clientId)?.name).toBe(SIGNUP_SPACE)
    expect(site.mailer?.sent.find((mail) => mail.to === SIGNUPPER)?.subject).toBeTruthy()
  })

  it('applies the ceilings the operator typed, with the same patch shape as POST /api/site/clients', async () => {
    const { site, caller, post } = await operator()
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, {
      ceilings: { maxEvents: 2, maxTotalBytes: null },
    })

    expect(response.status).toBe(201)
    const clients = (await caller.agent.get('/api/site/clients?limit=200')).body.items as {
      id: string
      ceilings: { maxEvents: number | null; maxTotalBytes: number | null }
    }[]
    const created = clients.find((row) => row.id === response.body.clientId)
    expect(created?.ceilings.maxEvents).toBe(2)
    expect(created?.ceilings.maxTotalBytes).toBeNull()
  })

  it('writes signup.approved by the operator about the request, beside client.created, with no address in the log', async () => {
    const { site, post, logged } = await operator()
    await seedSignup(site)

    await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    const lines = await logged()
    expect(lines.find((line) => line.action === 'signup.approved')).toMatchObject({
      subject: { type: 'access_request', id: A_SIGNUP },
      actor: { kind: 'operator', userId: ID.operator },
      clientId: null,
      details: {},
    })
    expect(lines.some((line) => line.action === 'client.created')).toBe(true)
    expect(JSON.stringify(lines)).not.toContain(SIGNUPPER)
  })

  it('answers 409 signup.notPending to the second approval, and opens one client', async () => {
    const { site, post, caller } = await operator()
    await seedSignup(site)

    const first = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})
    const second = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('signup.notPending')
    const clients = (await caller.agent.get('/api/site/clients?limit=200')).body.items as {
      name: string
    }[]
    expect(clients.filter((row) => row.name === SIGNUP_SPACE)).toHaveLength(1)
  })

  it('answers 404 signup.notFound for an id nobody holds and for an unproven request', async () => {
    const { site, post } = await operator()
    await seedSignup(site, { unconfirmed: true })

    for (const id of [A_SIGNUP, SECOND]) {
      const response = await post(`/api/site/signups/${id}/approve`, {})
      expect(response.status, id).toBe(404)
      expect(response.body.error.code, id).toBe('signup.notFound')
    }
  })

  it('leaves the request pending when the provisioning is refused, so it can be retried', async () => {
    const { site, post, get } = await operator()
    await seedSignup(site)
    // Fill the address's hourly invitation cap so the invitation is refused.
    for (let attempt = 0; attempt < INVITATION_MAX_PER_ADDRESS_PER_HOUR; attempt += 1) {
      await site.repos.tokens.save(
        anAccountToken({
          id: `${attempt}aaaaaaa-aaaa-4aaa-8aaa-000000000000`,
          purpose: 'invitation',
          email: SIGNUPPER,
          userId: null,
          clientId: ID.clientK,
          clientRole: 'member',
          createdAt: site.clock.now(),
        }),
      )
    }

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    expect(response.status).toBeGreaterThanOrEqual(400)
    const pending = await get('/api/site/signups?status=pending')
    expect(pending.body.items).toHaveLength(1)
  })

  it('answers no token and no link where a mailer delivers', async () => {
    const { site, post } = await operator({ mail: 'delivers' })
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//)
    expect(response.body.invitation.link).toBeUndefined()
  })

  it.each([
    ['a body key the contract does not have', { actor: 'x' }],
    ['a ceilings key it does not have', { ceilings: { maxEvent: 1 } }],
  ])('answers 400 request.invalid for %s, and changes nothing', async (_name, body) => {
    const { site, post, get } = await operator()
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/approve`, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect((await get('/api/site/signups')).body.items).toHaveLength(1)
  })

  it('answers 400 request.invalid for an id that is not an id', async () => {
    const { post } = await operator()

    const response = await post('/api/site/signups/not-an-id/approve', {})

    expect(response.status).toBe(400)
  })

  it('asks for a fresh step-up before reading the body, and approves nothing without one', async () => {
    const { site, caller, get } = await operator()
    await seedSignup(site)
    await site.stamp(ID.operator, { stepUpAt: 0 })

    const response = await caller.agent
      .post(`/api/site/signups/${A_SIGNUP}/approve`)
      .set(CSRF_HEADER, caller.csrf)
      .send({ nonsense: true })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.stepUpRequired')
    expect((await get('/api/site/signups')).body.items).toHaveLength(1)
  })

  it('is limited like an invitation: past the hourly cap the answer is 429', async () => {
    const { site, post } = await operator()
    const cap = 30
    let last = 0
    for (let attempt = 0; attempt <= cap; attempt += 1) {
      await seedSignup(site, {
        id: `55555555-5555-4555-8555-${String(attempt).padStart(12, '0')}`,
        email: `p${attempt}@example.test`,
      })
    }
    for (let attempt = 0; attempt <= cap; attempt += 1) {
      const response = await post(
        `/api/site/signups/55555555-5555-4555-8555-${String(attempt).padStart(12, '0')}/approve`,
        {},
      )
      last = response.status
    }

    expect(last).toBe(429)
  })
})

describe('POST /api/site/signups/:id/refuse', () => {
  it('answers 204, refuses the request and writes signup.refused with the flag', async () => {
    const { site, post, get, logged } = await operator()
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/refuse`, { notify: false })

    expect(response.status).toBe(204)
    expect((await get('/api/site/signups?status=refused')).body.items[0].id).toBe(A_SIGNUP)
    expect((await get('/api/site/signups?status=pending')).body.items).toEqual([])
    expect((await logged()).find((line) => line.action === 'signup.refused')).toMatchObject({
      subject: { type: 'access_request', id: A_SIGNUP },
      actor: { kind: 'operator', userId: ID.operator },
      details: { notified: false },
    })
  })

  it('sends the neutral mail only when notify is true, with the guide and no reason', async () => {
    const { site, post } = await operator()
    await seedSignup(site)
    await seedSignup(site, { id: SECOND, email: 'quiet@example.test' })

    await post(`/api/site/signups/${SECOND}/refuse`, { notify: false })
    expect(site.mailer?.sent.filter((mail) => mail.to === 'quiet@example.test')).toEqual([])

    await post(`/api/site/signups/${A_SIGNUP}/refuse`, { notify: true })
    const mail = site.mailer?.sent.find((sent) => sent.to === SIGNUPPER)
    expect(mail?.text).toContain(SELF_HOST_LINK)
    expect(mail?.text).not.toContain(SIGNUP_SPACE)
  })

  it('answers 409 signup.notPending when it was already decided, and 404 signup.notFound for no one', async () => {
    const { site, post } = await operator()
    await seedSignup(site)
    await post(`/api/site/signups/${A_SIGNUP}/approve`, {})

    const decided = await post(`/api/site/signups/${A_SIGNUP}/refuse`, { notify: true })
    const nobody = await post(`/api/site/signups/${SECOND}/refuse`, { notify: true })

    expect(decided.status).toBe(409)
    expect(decided.body.error.code).toBe('signup.notPending')
    expect(nobody.status).toBe(404)
    expect(nobody.body.error.code).toBe('signup.notFound')
  })

  it.each([
    ['no notify flag', {}],
    ['a notify that is not a boolean', { notify: 'yes' }],
    ['a key the contract does not have', { notify: true, reason: 'spam' }],
  ])('answers 400 request.invalid for %s, and refuses nothing', async (_name, body) => {
    const { site, post, get } = await operator()
    await seedSignup(site)

    const response = await post(`/api/site/signups/${A_SIGNUP}/refuse`, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect((await get('/api/site/signups')).body.items).toHaveLength(1)
  })

  it('asks for a fresh step-up', async () => {
    const { site, caller, get } = await operator()
    await seedSignup(site)
    await site.stamp(ID.operator, { stepUpAt: 0 })

    const response = await caller.agent
      .post(`/api/site/signups/${A_SIGNUP}/refuse`)
      .set(CSRF_HEADER, caller.csrf)
      .send({ notify: false })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.stepUpRequired')
    expect((await get('/api/site/signups')).body.items).toHaveLength(1)
  })
})
