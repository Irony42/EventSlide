import { describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { AT, aClient, atPlus } from '../../../application/testing/builders'
import { CSRF_HEADER } from '../middleware/csrf'
import { ADDRESS, CONTENT, ID, aBox } from '../testing/siteBox'

/**
 * Ring 4. What an operator reads of the box (`GET /api/site/clients`, `/clients/:clientId/events`,
 * `/accounts`, `/audit`), through the assembled server over real storage.
 *
 * Who may call them is `siteRoutes.test.ts`'s; that none of them can carry content is
 * `siteRoutes.contentFree.test.ts`'s. What is held here is what each one **says**: the shape of
 * a row, the scoping of a client's events to that client, how a page ends, and what a malformed
 * request is told.
 */

const operatorGets = async (path: string) => {
  const { site } = await aBox()
  const caller = await site.signInAsOperator()
  return { site, response: await caller.agent.get(path) }
}

const idsOf = (rows: readonly { readonly id: string }[]): string[] => rows.map((row) => row.id)

describe('GET /api/site/clients', () => {
  it('lists every client of the box with its ceilings and what it uses, and nothing it holds', async () => {
    const { response } = await operatorGets('/api/site/clients')

    expect(response.status).toBe(200)
    expect(idsOf(response.body.items).sort()).toEqual(
      [ID.clientK, ID.clientL, ID.clientEmpty].sort(),
    )
    const camille = response.body.items.find((row: { id: string }) => row.id === ID.clientK)
    expect(camille).toEqual({
      id: ID.clientK,
      name: 'Camille et Sacha',
      createdAt: AT.toISOString(),
      suspendedAt: null,
      purgeAfter: null,
      ceilings: {
        maxEvents: null,
        maxTotalBytes: null,
        maxEventQuotaBytes: null,
        maxRetentionDays: null,
        clipsAllowed: true,
        liveAllowed: true,
        maxLiveDays: null,
        maxEventsPerPeriod: null,
        periodStartedAt: null,
      },
      eventsCreatedInPeriod: 0,
      usage: { eventCount: 1, liveEventCount: 1, memberCount: 3, usedBytes: 0 },
    })
    expect(response.body.next).toBeNull()
  })

  it('is never kept by a cache: it moves with every upload and is nobody else’s to hold', async () => {
    const { response } = await operatorGets('/api/site/clients')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('shows a client that is suspended as such, with the instant', async () => {
    const { site } = await aBox()
    await site.world.addClient(
      aClient({ id: '99999999-9999-4999-8999-999999999999', name: 'Gelé', suspendedAt: atPlus(5) }),
    )
    const caller = await site.signInAsOperator()

    const response = await caller.agent.get('/api/site/clients')

    const frozen = response.body.items.find(
      (row: { id: string }) => row.id === '99999999-9999-4999-8999-999999999999',
    )
    expect(frozen.suspendedAt).toBe(atPlus(5).toISOString())
  })

  it('pages with the cursor it hands out, without repeating or skipping a client, and ends with a null', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()

    const first = await caller.agent.get('/api/site/clients?limit=2')
    const second = await caller.agent.get(`/api/site/clients?limit=2&after=${first.body.next}`)

    expect(first.body.items).toHaveLength(2)
    expect(first.body.next).not.toBeNull()
    expect(second.body.items).toHaveLength(1)
    expect(second.body.next).toBeNull()
    expect([...idsOf(first.body.items), ...idsOf(second.body.items)].sort()).toEqual(
      [ID.clientK, ID.clientL, ID.clientEmpty].sort(),
    )
  })

  it('answers an empty page, and not the first one again, for a cursor that names nobody', async () => {
    const { response } = await operatorGets(
      '/api/site/clients?after=99999999-9999-4999-8999-999999999999',
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], next: null })
  })

  it.each([
    ['a page of zero', '?limit=0'],
    ['a negative page', '?limit=-1'],
    ['a page over the bound', '?limit=201'],
    ['a page that is not a number', '?limit=many'],
    ['a fractional page', '?limit=1.5'],
    ['a cursor that is not an id', '?after=client-k'],
    ['a filter this contract does not have', '?name=Camille'],
    ['a second spelling of the cursor', '?cursor=abc'],
  ])('answers 400 request.invalid for %s, and reads nothing', async (_label, query) => {
    const { response } = await operatorGets(`/api/site/clients${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('GET /api/site/clients/:clientId/events', () => {
  it('lists the client’s events as ids, statuses, dates and sizes, with no name, slug, join code or photograph', async () => {
    const { response } = await operatorGets(`/api/site/clients/${ID.clientK}/events`)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      items: [
        {
          id: ID.eventK,
          status: 'live',
          createdAt: AT.toISOString(),
          startsAt: null,
          openedAt: AT.toISOString(),
          closedAt: null,
          quotaBytes: expect.any(Number),
          usedBytes: 0,
          photoCount: 0,
        },
      ],
      next: null,
    })
    expect(JSON.stringify(response.body)).not.toContain(CONTENT.eventName)
    expect(JSON.stringify(response.body)).not.toContain(CONTENT.slug)
    expect(JSON.stringify(response.body)).not.toContain(CONTENT.joinCode)
  })

  it('answers an empty page for a client with no event, which is not a client that does not exist', async () => {
    const { response } = await operatorGets(`/api/site/clients/${ID.clientEmpty}/events`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], next: null })
  })

  it('answers 404 client.notFound for a client that does not exist', async () => {
    const { response } = await operatorGets(
      '/api/site/clients/99999999-9999-4999-8999-999999999999/events',
    )

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('client.notFound')
  })

  it('answers 400 for an id that is not one, before any storage is asked', async () => {
    const { response } = await operatorGets('/api/site/clients/not-an-id/events')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('never lists another client’s event: tenant isolation holds for the operator’s own read model', async () => {
    const { site, response } = await operatorGets(`/api/site/clients/${ID.clientK}/events`)
    const other = await (
      await site.signInAsOperator()
    ).agent.get(`/api/site/clients/${ID.clientL}/events`)

    expect(idsOf(response.body.items)).toEqual([ID.eventK])
    expect(idsOf(other.body.items)).toEqual([ID.eventL])
  })

  it('answers an empty page, not the client’s first page, for a cursor that is another client’s event', async () => {
    const { response } = await operatorGets(
      `/api/site/clients/${ID.clientK}/events?after=${ID.eventL}`,
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], next: null })
  })

  it('answers 400 for a page outside the bound and for a key this contract does not have', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()

    const tooBig = await caller.agent.get(`/api/site/clients/${ID.clientK}/events?limit=500`)
    const unknown = await caller.agent.get(`/api/site/clients/${ID.clientK}/events?status=live`)

    expect([tooBig.status, unknown.status]).toEqual([400, 400])
  })
})

describe('GET /api/site/accounts', () => {
  it('lists every account by address, with the clients it belongs to, and says which one operates the box', async () => {
    const { response } = await operatorGets('/api/site/accounts')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const byAddress = Object.fromEntries(
      response.body.items.map((row: { email: string }) => [row.email, row]),
    )
    expect(Object.keys(byAddress).sort()).toEqual(Object.values(ADDRESS).sort())
    expect(byAddress[ADDRESS.operator]).toMatchObject({ siteRole: 'operator', clients: [] })
    expect(byAddress[ADDRESS.owner]).toMatchObject({
      siteRole: 'none',
      disabledAt: null,
      mustChangePassword: false,
      ownedEventCount: 1,
      clients: [{ clientId: ID.clientK, role: 'owner' }],
    })
    expect(byAddress[ADDRESS.member].clients).toEqual([{ clientId: ID.clientK, role: 'member' }])
    expect(byAddress[ADDRESS.stranger]).toMatchObject({ clients: [], ownedEventCount: 0 })
  })

  it('names no hash and no display name: a row is how the account is recognised and what it may do', async () => {
    const { response } = await operatorGets('/api/site/accounts')

    for (const row of response.body.items) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'clients',
          'createdAt',
          'disabledAt',
          'email',
          'id',
          'lastLoginAt',
          'mustChangePassword',
          'ownedEventCount',
          'siteRole',
          'termsAcceptedAt',
          'termsVersion',
        ].sort(),
      )
    }
  })

  it('pages like the clients do', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()

    const first = await caller.agent.get('/api/site/accounts?limit=4')
    const second = await caller.agent.get(`/api/site/accounts?limit=4&after=${first.body.next}`)

    expect(first.body.items).toHaveLength(4)
    expect(second.body.items).toHaveLength(2)
    expect(second.body.next).toBeNull()
  })

  it.each([
    ['a page outside the bound', '?limit=0'],
    ['a filter this contract does not have', '?email=ops'],
    ['a cursor that is not an id', '?after=compte-1'],
  ])('answers 400 request.invalid for %s', async (_label, query) => {
    const { response } = await operatorGets(`/api/site/accounts${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('GET /api/site/audit', () => {
  const rename = async (
    site: Awaited<ReturnType<typeof aBox>>['site'],
    caller: Awaited<ReturnType<typeof site.signInAsOperator>>,
    clientId: string,
    name: string,
  ) =>
    caller.agent.patch(`/api/site/clients/${clientId}`).set(CSRF_HEADER, caller.csrf).send({ name })

  it('reads the whole box when no client is named, newest first: the operator’s view is unfiltered', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    await rename(site, caller, ID.clientK, 'Camille et Sacha, mariés')
    await rename(site, caller, ID.clientL, 'Fondation Bleue, 2e édition')

    const response = await caller.agent.get('/api/site/audit')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(
      response.body.items.map((entry: { action: string; clientId: string }) => [
        entry.action,
        entry.clientId,
      ]),
    ).toEqual([
      ['client.renamed', ID.clientL],
      ['client.renamed', ID.clientK],
    ])
  })

  it('names the operator behind a line, which the client’s own view never does', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    await rename(site, caller, ID.clientK, 'Camille et Sacha, mariés')

    const response = await caller.agent.get('/api/site/audit')

    expect(response.body.items[0]).toMatchObject({
      action: 'client.renamed',
      actor: { kind: 'operator', userId: ID.operator, label: null },
      subject: { type: 'client', id: ID.clientK },
      clientId: ID.clientK,
      details: {},
      at: AT.toISOString(),
    })
  })

  it('reads one client’s lines when `clientId` names it, and no other’s', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    await rename(site, caller, ID.clientK, 'Camille et Sacha, mariés')
    await rename(site, caller, ID.clientL, 'Fondation Bleue, 2e édition')

    const response = await caller.agent.get(`/api/site/audit?clientId=${ID.clientK}`)

    expect(response.body.items.map((entry: { clientId: string }) => entry.clientId)).toEqual([
      ID.clientK,
    ])
  })

  it('pages with the cursor it hands out and ends with a null', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    for (const name of ['Un', 'Deux', 'Trois']) {
      await rename(site, caller, ID.clientEmpty, `Client ${name}`)
    }

    const first = await caller.agent.get('/api/site/audit?limit=2')
    const second = await caller.agent.get(`/api/site/audit?limit=2&before=${first.body.next}`)

    expect(first.body.items).toHaveLength(2)
    expect(second.body.items).toHaveLength(1)
    expect(second.body.next).toBeNull()
    expect(first.body.items[1].seq).toBeGreaterThan(second.body.items[0].seq)
  })

  it('shows the reason an operator gave for a change of ceilings, which a client’s owner is not shown', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    await caller.agent
      .put(`/api/site/clients/${ID.clientK}/ceilings`)
      .set(CSRF_HEADER, caller.csrf)
      .send({ ceilings: { maxEvents: 3 }, reason: 'Forfait mis à jour, ticket 42' })
      .expect(200)

    const response = await caller.agent.get('/api/site/audit')

    expect(response.body.items[0].details).toMatchObject({
      reason: 'Forfait mis à jour, ticket 42',
      before: { maxEvents: null },
      after: { maxEvents: 3 },
    })
  })

  it('checks again, at the door, what an old row holds: a string that is no instant and no reason is dropped', async () => {
    const { site } = await aBox()
    const caller = await site.signInAsOperator()
    // A row written under an older allow-list can say anything: it must still be readable, and
    // what it says in text must not reach the wire.
    site.db
      .prepare(
        `INSERT INTO audit_log (at, actor_kind, action, subject_type, subject_id, client_id, details)
         VALUES (?, 'system', 'client.ceilingsChanged', 'client', ?, ?, ?)`,
      )
      .run(
        AT.toISOString(),
        ID.clientK,
        ID.clientK,
        JSON.stringify({
          count: 3,
          note: 'ne pas montrer',
          at: AT.toISOString(),
          nested: { caption: 'une légende', n: 1 },
          list: ['a'],
          reason: ' pas canonique ',
          // A sentence that would pass as a reason, but only the top of an entry may carry one.
          after: { reason: 'une phrase plausible' },
        }),
      )

    const response = await caller.agent.get('/api/site/audit')

    expect(response.body.items[0].details).toEqual({
      count: 3,
      at: AT.toISOString(),
      nested: { n: 1 },
      after: {},
    })
  })

  it.each([
    ['a page of zero', '?limit=0'],
    ['a page over the bound', '?limit=201'],
    ['a cursor of zero', '?before=0'],
    ['a client that is not an id', '?clientId=client-k'],
    ['a filter this contract does not have', '?actor=operateur'],
  ])('answers 400 request.invalid for %s', async (_label, query) => {
    const { response } = await operatorGets(`/api/site/audit${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers an empty page for a client the log has never heard of', async () => {
    const { response } = await operatorGets(
      `/api/site/audit?clientId=${asClientId('99999999-9999-4999-8999-999999999999')}`,
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], next: null })
  })
})
