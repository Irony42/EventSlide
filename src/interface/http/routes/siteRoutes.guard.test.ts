import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT } from '../../../application/testing/builders'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import { CSRF_HEADER } from '../middleware/csrf'
import { anonymousCaller, type Caller } from '../testing/signIn'
import { ADDRESS, ID, NEWCOMER, aBox } from '../testing/siteBox'
import type { SiteHarnessOptions } from '../testing/siteHarness'

/**
 * Ring 4. The operator guard (R1 and R2, docs/SECURITY.md §20) as the operator meets it on the
 * wire: `POST /api/site/clients/:clientId/invitations`, `POST /api/site/accounts/:userId/password-reset`,
 * and the owner's two approvals, `POST /api/client/invitations/:id/approve` and
 * `POST /api/client/password-resets/:id/approve`.
 *
 * The rules themselves are held at ring 2 (`operatorGuard.test.ts` and the use cases' own files),
 * where a rule is held whichever route reaches it. What only the wire can break is held here: that
 * the route passes the **operator from the session** and nothing the body says, that the answer
 * says what the guard decided and no more, and that **no answer carries a token or a link where a
 * mailer delivers**. `siteRoutes.escalation.test.ts` is the net under a route that forgets all of
 * that.
 */

const LINK = /https?:\/\/\S+\/(?:invite|password\/reset)\/([A-Za-z0-9_-]+)/

const operator = async (options: SiteHarnessOptions = {}) => {
  const { site } = await aBox(options)
  const caller = await site.signInAsOperator()
  const post = (path: string, body: object = {}): request.Test =>
    caller.agent.post(path).set(CSRF_HEADER, caller.csrf).send(body)
  const logged = async () =>
    (await caller.agent.get('/api/site/audit')).body.items as readonly {
      readonly action: string
      readonly clientId: string | null
      readonly actor: { readonly kind: string; readonly userId: string | null }
      readonly details: Record<string, unknown>
    }[]
  return { site, caller, post, logged }
}

const postAs = (caller: Caller, path: string, body: object = {}): request.Test =>
  caller.agent.post(path).set(CSRF_HEADER, caller.csrf).send(body)

describe('POST /api/site/clients/:clientId/invitations (R1)', () => {
  const invite = (
    post: Awaited<ReturnType<typeof operator>>['post'],
    clientId: string,
    body: object = { email: NEWCOMER, role: 'member' },
  ) => post(`/api/site/clients/${clientId}/invitations`, body)

  it('writes an invitation into a client that is in use as waiting for an owner, and says so', async () => {
    const { post } = await operator()

    const response = await invite(post, ID.clientK)

    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      invitation: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        delivery: 'mail',
        expiresAt: expect.any(String),
        pendingApproval: true,
      },
    })
  })

  it('writes an invitation into a client that holds nothing as usable at once', async () => {
    const { post } = await operator()

    const response = await invite(post, ID.clientEmpty, { email: NEWCOMER, role: 'owner' })

    expect(response.status).toBe(201)
    expect(response.body.invitation.pendingApproval).toBe(false)
  })

  it('waits for an owner even when the operator invites an owner, or invites themself', async () => {
    const { post, logged } = await operator()

    const owner = await invite(post, ID.clientK, { email: NEWCOMER, role: 'owner' })
    const self = await invite(post, ID.clientK, { email: ADDRESS.operator, role: 'owner' })

    expect([owner.body.invitation.pendingApproval, self.body.invitation.pendingApproval]).toEqual([
      true,
      true,
    ])
    expect((await logged()).map((line) => line.details['pendingApproval'])).toEqual([true, true])
  })

  it('opens nothing for the invitee until an owner of the client approves it, then opens it', async () => {
    const { site, post } = await operator()
    const invitation = await invite(post, ID.clientK)
    const link = LINK.exec(site.mailer?.sent[0]?.text ?? '')?.[0]
    if (link === undefined) throw new Error('fixture rejected: no link in the mail')
    const token = link.split('/invite/')[1]
    const stranger = await anonymousCaller(site.app)

    const before = await stranger.agent.get(`/api/invitations/${token}`)
    const owner = await site.signIn(ADDRESS.owner)
    const approval = await postAs(
      owner,
      `/api/client/invitations/${invitation.body.invitation.id}/approve`,
    )
    const after = await stranger.agent.get(`/api/invitations/${token}`)

    expect(before.status).toBe(404)
    expect(approval.status).toBe(204)
    expect(after.status).toBe(200)
  })

  it('refuses an operator’s own approval of what they wrote, even where the client made them an owner', async () => {
    const { site, post } = await operator()
    await site.world.addClientMember({
      clientId: asClientId(ID.clientK),
      userId: asUserId(ID.operator),
      role: 'owner',
      grantedAt: AT,
    })
    const invitation = await invite(post, ID.clientK)

    const approval = await post(`/api/client/invitations/${invitation.body.invitation.id}/approve`)

    expect(approval.status).toBe(403)
    expect(approval.body.error.code).toBe('auth.forbidden')
  })

  it('writes invitation.issued with the operator and whether it waits, and names neither the address nor the role', async () => {
    const { post, logged } = await operator()

    const response = await invite(post, ID.clientK, { email: NEWCOMER, role: 'owner' })

    const [line] = await logged()
    expect(line).toMatchObject({
      action: 'invitation.issued',
      actor: { kind: 'operator', userId: ID.operator },
      clientId: ID.clientK,
      details: { pendingApproval: true },
    })
    expect(JSON.stringify(line)).not.toContain(NEWCOMER)
    expect(JSON.stringify(line)).not.toContain('owner')
    expect(line).toBeDefined()
    expect(response.body.invitation.id).toBeDefined()
  })

  it('answers no token and no link where a mailer delivers, whether or not the invitation waits', async () => {
    const { site, post } = await operator({ mail: 'delivers' })

    const waiting = await invite(post, ID.clientK)
    const usable = await invite(post, ID.clientEmpty, {
      email: 'autre@example.test',
      role: 'owner',
    })

    for (const response of [waiting, usable]) {
      expect(response.body.invitation).not.toHaveProperty('link')
      expect(JSON.stringify(response.body)).not.toContain('/invite/')
    }
    const tokens = (site.mailer?.sent ?? []).map((mail) => LINK.exec(mail.text)?.[1])
    expect(tokens).toHaveLength(2)
    for (const token of tokens) {
      expect(JSON.stringify([waiting.body, usable.body])).not.toContain(token ?? 'unreachable')
    }
  })

  it('hands the operator the link where no mail went out, which is the only way it gets to the invitee, and it still waits', async () => {
    const { site, post } = await operator({ mail: 'none' })

    const response = await invite(post, ID.clientK)

    expect(response.body.invitation).toMatchObject({ delivery: 'link', pendingApproval: true })
    const token = /\/invite\/([A-Za-z0-9_-]+)$/.exec(response.body.invitation.link)?.[1]
    expect(
      (await (await anonymousCaller(site.app)).agent.get(`/api/invitations/${token}`)).status,
    ).toBe(404)
  })

  it('makes the operator no member of the client, whoever they invited into it', async () => {
    const { caller, post } = await operator()
    await invite(post, ID.clientK, { email: ADDRESS.operator, role: 'owner' })

    const accounts = await caller.agent.get('/api/site/accounts?limit=200')

    const mine = accounts.body.items.find((row: { id: string }) => row.id === ID.operator)
    expect(mine.clients).toEqual([])
  })

  it('answers 404 client.notFound for a client that does not exist and 400 for an address that is not one', async () => {
    const { post } = await operator()

    const unknown = await invite(post, '99999999-9999-4999-8999-999999999999')
    const malformed = await invite(post, ID.clientK, { email: 'pas-une-adresse', role: 'member' })

    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'client.notFound'])
    expect([malformed.status, malformed.body.error.code]).toEqual([400, 'email.malformed'])
  })

  it.each([
    ['no role', { email: NEWCOMER }],
    ['a role this product does not have', { email: NEWCOMER, role: 'moderator' }],
    ['no address', { role: 'member' }],
    ['a key the contract does not have', { email: NEWCOMER, role: 'member', approved: true }],
    ['an actor named in the body', { email: NEWCOMER, role: 'member', actorId: ID.owner }],
  ])('answers 400 request.invalid for %s, and writes nothing', async (_label, body) => {
    const { post, logged } = await operator()

    const response = await invite(post, ID.clientK, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(await logged()).toEqual([])
  })

  it('writes its invitation for the client in the path and for no other', async () => {
    const { post, logged } = await operator()

    await invite(post, ID.clientK)

    expect((await logged()).map((line) => line.clientId)).toEqual([ID.clientK])
  })
})

describe('POST /api/site/accounts/:userId/password-reset (R2)', () => {
  const reset = (
    post: Awaited<ReturnType<typeof operator>>['post'],
    userId: string = ID.member,
    body: object = {},
  ) => post(`/api/site/accounts/${userId}/password-reset`, body)

  it('mails the link to the account’s own address and answers that it went, with no token, no link and no address', async () => {
    const { site, post } = await operator()

    const response = await reset(post)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({ delivery: 'mail', expiresAt: expect.any(String) })
    expect(site.mailer?.sent).toHaveLength(1)
    expect(site.mailer?.sent[0]?.to).toBe(ADDRESS.member)
    const token = LINK.exec(site.mailer?.sent[0]?.text ?? '')?.[1]
    expect(token).toBeDefined()
    expect(JSON.stringify(response.body)).not.toContain(token ?? 'unreachable')
    expect(JSON.stringify(response.body)).not.toContain(ADDRESS.member)
  })

  it('writes account.resetIssued {linkShown: false} once for each client the account is in, by the operator', async () => {
    const { site, post, logged } = await operator()
    await site.world.addClientMember({
      clientId: asClientId(ID.clientL),
      userId: asUserId(ID.member),
      role: 'member',
      grantedAt: AT,
    })

    await reset(post)

    const lines = await logged()
    expect(lines.map((line) => line.clientId).sort()).toEqual([ID.clientK, ID.clientL].sort())
    for (const line of lines) {
      expect(line).toMatchObject({
        action: 'account.resetIssued',
        actor: { kind: 'operator', userId: ID.operator },
        details: { linkShown: false },
      })
    }
  })

  it('refuses on a box with no relay, by default, and issues nothing', async () => {
    const { post, logged } = await operator({ mail: 'none' })

    const response = await reset(post)

    expect([response.status, response.body.error.code]).toEqual([409, 'reset.mailerRequired'])
    expect(JSON.stringify(response.body)).not.toMatch(/https?:/)
    expect(await logged()).toEqual([])
  })

  it('answers 409 reset.mailNotSent, and still no link, when the relay refused the mail', async () => {
    const { site, post } = await operator()
    site.mailer?.failNextWith('transient')

    const response = await reset(post)

    expect([response.status, response.body.error.code]).toEqual([409, 'reset.mailNotSent'])
    expect(JSON.stringify(response.body)).not.toMatch(/https?:/)
  })

  it('answers 429 reset.tooManyForAddress once an inbox has had its three an hour', async () => {
    const { post } = await operator()

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await reset(post)).status)

    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('answers 404 user.notFound for an account that does not exist, and 409 account.disabled for one that is switched off', async () => {
    const { site, post } = await operator()
    const member = await site.repos.users.findById(asUserId(ID.member))
    if (member === null) throw new Error('fixture rejected')
    await site.repos.users.save(member.disable(site.clock.now()))

    const unknown = await reset(post, '99999999-9999-4999-8999-999999999999')
    const disabled = await reset(post, ID.member)

    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'user.notFound'])
    expect([disabled.status, disabled.body.error.code]).toEqual([409, 'account.disabled'])
  })

  it.each([
    ['a language this product does not speak', { locale: 'nl' }],
    ['a key the contract does not have', { notify: false }],
    ['an approval that is not an id', { approvalId: 'oui' }],
  ])('answers 400 request.invalid for %s, and sends nothing', async (_label, body) => {
    const { site, post } = await operator()

    const response = await reset(post, ID.member, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(site.mailer?.sent).toEqual([])
  })

  describe('with OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval, on a box with no relay', () => {
    const OPTIONS: SiteHarnessOptions = { mail: 'none', resetLinks: 'copyLinkWithOwnerApproval' }

    it('writes a request that holds no link, and says who is to approve it', async () => {
      const { post, logged } = await operator(OPTIONS)

      const response = await reset(post)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        delivery: 'pendingApproval',
        expiresAt: expect.any(String),
        approvalId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
      expect(JSON.stringify(response.body)).not.toMatch(/https?:/)
      expect((await logged()).map((line) => line.action)).toEqual(['account.resetRequested'])
    })

    it('hands the operator a link only after another owner approved the very request, and only once', async () => {
      const { site, post, logged } = await operator(OPTIONS)
      const request1 = await reset(post)
      const approvalId: string = request1.body.approvalId
      const before = await reset(post, ID.member, { approvalId })
      const coOwner = await site.signIn(ADDRESS.coOwner)

      const approval = await postAs(coOwner, `/api/client/password-resets/${approvalId}/approve`)
      const redeemed = await reset(post, ID.member, { approvalId })
      const again = await reset(post, ID.member, { approvalId })

      expect([before.status, before.body.error.code]).toEqual([404, 'reset.requestNotFound'])
      expect(approval.status).toBe(204)
      expect(redeemed.status).toBe(200)
      expect(redeemed.body).toEqual({
        delivery: 'link',
        expiresAt: expect.any(String),
        link: expect.stringMatching(/\/password\/reset\/[A-Za-z0-9_-]{20,}$/),
      })
      expect([again.status, again.body.error.code]).toEqual([404, 'reset.requestNotFound'])
      expect((await logged()).map((line) => line.action).reverse()).toEqual([
        'account.resetRequested',
        'account.resetApproved',
        'account.resetIssued',
      ])
    })

    it('refuses an account in two clients, whose approval would be two owners’ and is recorded as one', async () => {
      const { site, post } = await operator(OPTIONS)
      await site.world.addClientMember({
        clientId: asClientId(ID.clientL),
        userId: asUserId(ID.member),
        role: 'member',
        grantedAt: AT,
      })

      const response = await reset(post)

      expect([response.status, response.body.error.code]).toEqual([
        409,
        'reset.approverUnavailable',
      ])
    })

    it('does not let the account being reset approve its own reset', async () => {
      const { site, post } = await operator(OPTIONS)
      const request1 = await reset(post, ID.coOwner)
      const self = await site.signIn(ADDRESS.coOwner)

      const approval = await postAs(
        self,
        `/api/client/password-resets/${request1.body.approvalId}/approve`,
      )

      expect([approval.status, approval.body.error.code]).toEqual([403, 'auth.forbidden'])
    })
  })

  describe('POST /api/client/password-resets/:requestId/approve (the owner’s half)', () => {
    const OPTIONS: SiteHarnessOptions = { mail: 'none', resetLinks: 'copyLinkWithOwnerApproval' }

    const aRequest = async () => {
      const subject = await operator(OPTIONS)
      const made = await reset(subject.post)
      return { ...subject, id: made.body.approvalId as string }
    }

    it('answers 401 to a caller who is not signed in', async () => {
      const { site, id } = await aRequest()
      const stranger = await anonymousCaller(site.app)

      const response = await postAs(stranger, `/api/client/password-resets/${id}/approve`)

      expect([response.status, response.body.error.code]).toEqual([401, 'auth.required'])
    })

    it('answers 404 reset.requestNotFound to an account that is no part of the client: it learns nothing about it', async () => {
      const { site, id } = await aRequest()

      for (const address of [ADDRESS.stranger, ADDRESS.otherOwner]) {
        const caller = await site.signIn(address)
        const response = await postAs(caller, `/api/client/password-resets/${id}/approve`)

        expect([response.status, response.body.error.code], address).toEqual([
          404,
          'reset.requestNotFound',
        ])
      }
    })

    it('answers 403 to a member who is not an owner, and to the operator, whatever the client made them', async () => {
      const { site, id, caller } = await aRequest()
      await site.world.addClientMember({
        clientId: asClientId(ID.clientK),
        userId: asUserId(ID.operator),
        role: 'owner',
        grantedAt: AT,
      })

      const member = await postAs(
        await site.signIn(ADDRESS.member),
        `/api/client/password-resets/${id}/approve`,
      )
      const operatorOwner = await postAs(caller, `/api/client/password-resets/${id}/approve`)

      expect([member.status, member.body.error.code]).toEqual([403, 'auth.forbidden'])
      expect([operatorOwner.status, operatorOwner.body.error.code]).toEqual([403, 'auth.forbidden'])
    })

    it('answers 404 for an id that is nobody’s, an invitation’s, and 400 for one that is not an id', async () => {
      const { site, post } = await aRequest()
      const invitation = await post(`/api/site/clients/${ID.clientK}/invitations`, {
        email: NEWCOMER,
        role: 'member',
      })
      const owner = await site.signIn(ADDRESS.coOwner)

      const unknown = await postAs(
        owner,
        '/api/client/password-resets/99999999-9999-4999-8999-999999999999/approve',
      )
      const anInvitation = await postAs(
        owner,
        `/api/client/password-resets/${invitation.body.invitation.id}/approve`,
      )
      const malformed = await postAs(owner, '/api/client/password-resets/oui/approve')

      expect([unknown.status, unknown.body.error.code]).toEqual([404, 'reset.requestNotFound'])
      expect([anInvitation.status, anInvitation.body.error.code]).toEqual([
        404,
        'reset.requestNotFound',
      ])
      expect([malformed.status, malformed.body.error.code]).toEqual([400, 'request.invalid'])
    })

    it('lets another owner approve, answers 204 again for the same request, and writes one line', async () => {
      const { site, id, logged } = await aRequest()
      const owner = await site.signIn(ADDRESS.owner)

      const first = await postAs(owner, `/api/client/password-resets/${id}/approve`)
      const second = await postAs(owner, `/api/client/password-resets/${id}/approve`)

      expect([first.status, second.status]).toEqual([204, 204])
      expect((await logged()).filter((line) => line.action === 'account.resetApproved')).toEqual([
        expect.objectContaining({ actor: { kind: 'member', userId: ID.owner, label: null } }),
      ])
    })

    it('is unmounted with SITE_ADMIN=off, like the rest of the client space', async () => {
      const { site } = await aBox({ siteAdmin: false })
      const owner = await site.signIn(ADDRESS.owner)

      const response = await postAs(
        owner,
        '/api/client/password-resets/99999999-9999-4999-8999-999999999999/approve',
      )

      expect([response.status, response.body.error.code]).toEqual([404, 'route.notFound'])
    })

    it('is a stranger’s 404 to an owner of another client, who cannot approve what is not their client’s', async () => {
      const { site, id } = await aRequest()
      const other = await site.signIn(ADDRESS.otherOwner)

      const response = await postAs(other, `/api/client/password-resets/${id}/approve`)

      expect(response.status).toBe(404)
    })
  })
})
