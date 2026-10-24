import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT, atPlus } from '../../../application/testing/builders'
import { ClientCeilings } from '../../../domain/clients/clientCeilings'
import { CSRF_HEADER } from '../middleware/csrf'
import { ID, NEWCOMER, aBox } from '../testing/siteBox'
import type { SiteHarnessOptions } from '../testing/siteHarness'

/**
 * Ring 4. What an operator does to a client through `/api/site`: open one and invite its owner,
 * rename it, change its ceilings. The use cases behind them are held at ring 2; what is held
 * **here** is what only the wire can break: that the answer says what happened and no more, that
 * a request the contract refuses changes nothing, and that every act leaves the line the plan
 * lists for it.
 *
 * The reason for a change of ceilings has its own block, because it is the one rule of this file
 * that was decided rather than inherited (2026-10-23): without it the route answers `400` and
 * nothing is read or written.
 */

const operator = async (options: SiteHarnessOptions = {}) => {
  const { site } = await aBox(options)
  const caller = await site.signInAsOperator()
  const write = (method: 'post' | 'put' | 'patch', path: string, body: object): request.Test =>
    caller.agent[method](path).set(CSRF_HEADER, caller.csrf).send(body)
  const logged = async () =>
    (await caller.agent.get('/api/site/audit')).body.items as readonly {
      readonly action: string
      readonly clientId: string | null
      readonly actor: { readonly kind: string; readonly userId: string | null }
      readonly subject: { readonly type: string; readonly id: string }
      readonly details: Record<string, unknown>
    }[]
  const clients = async () =>
    (await caller.agent.get('/api/site/clients?limit=200')).body.items as readonly {
      readonly id: string
      readonly name: string
      readonly ceilings: Record<string, unknown>
    }[]
  return { site, caller, write, logged, clients }
}

describe('POST /api/site/clients', () => {
  const BODY = { clientName: 'Atelier Lumière', ownerEmail: NEWCOMER }

  it('opens a client, answers its id and its owner’s invitation, and the client then appears in the listing', async () => {
    const { write, clients } = await operator()

    const response = await write('post', '/api/site/clients', BODY)

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
    const listed = (await clients()).find((row) => row.id === response.body.clientId)
    expect(listed?.name).toBe('Atelier Lumière')
  })

  it('answers no token and no link where a mailer delivers: the owner’s link is in their inbox and nowhere else', async () => {
    const { site, write } = await operator({ mail: 'delivers' })

    const response = await write('post', '/api/site/clients', BODY)

    expect(site.mailer?.sent).toHaveLength(1)
    expect(site.mailer?.sent[0]?.to).toBe(NEWCOMER)
    const link = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(
      site.mailer?.sent[0]?.text ?? '',
    )?.[0]
    expect(link).toBeDefined()
    expect(response.body.invitation).not.toHaveProperty('link')
    expect(JSON.stringify(response.body)).not.toContain('/invite/')
    expect(JSON.stringify(response.body)).not.toContain(link?.split('/invite/')[1] ?? 'unreachable')
  })

  it('hands the operator the link to pass on when the box has no relay, because there is no other way to get it to the owner', async () => {
    const { write } = await operator({ mail: 'none' })

    const response = await write('post', '/api/site/clients', BODY)

    expect(response.status).toBe(201)
    expect(response.body.invitation.delivery).toBe('link')
    expect(response.body.invitation.link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/)
  })

  it('starts the client with the ceilings the operator named and the box’s defaults for the rest', async () => {
    const { write, clients } = await operator({
      newClientDefaults: {
        maxEvents: 1,
        maxEventsPerPeriod: null,
        maxTotalBytes: 20_000_000_000,
        maxEventQuotaBytes: null,
        maxRetentionDays: 30,
        maxLiveDays: null,
        clipsAllowed: false,
      },
    })

    const response = await write('post', '/api/site/clients', {
      ...BODY,
      ceilings: { maxEvents: 5, maxRetentionDays: null },
    })

    const created = (await clients()).find((row) => row.id === response.body.clientId)
    expect(created?.ceilings).toMatchObject({
      maxEvents: 5,
      maxTotalBytes: 20_000_000_000,
      maxRetentionDays: null,
      clipsAllowed: false,
    })
  })

  it('writes client.created and invitation.issued, by the operator, each naming the client and neither naming the owner', async () => {
    const { write, logged } = await operator()

    const response = await write('post', '/api/site/clients', BODY)

    const lines = [...(await logged())].reverse()
    expect(lines.map((line) => line.action)).toEqual(['client.created', 'invitation.issued'])
    for (const line of lines) {
      expect(line.actor).toEqual({ kind: 'operator', userId: ID.operator, label: null })
      expect(line.clientId).toBe(response.body.clientId)
    }
    expect(lines[1]?.subject).toEqual({ type: 'invitation', id: response.body.invitation.id })
    expect(lines[1]?.details).toEqual({ pendingApproval: false })
    expect(JSON.stringify(lines)).not.toContain(NEWCOMER)
    expect(JSON.stringify(lines)).not.toContain('Atelier Lumière')
  })

  it.each([
    ['an address that is not one', { ...BODY, ownerEmail: 'pas-une-adresse' }, 'email.malformed'],
    [
      'an address of three hundred characters',
      { ...BODY, ownerEmail: `${'a'.repeat(300)}@example.org` },
      'email.tooLong',
    ],
    ['a name that is empty', { ...BODY, clientName: '' }, 'clientName.empty'],
    [
      'a ceiling the catalogue refuses',
      { ...BODY, ceilings: { maxEvents: 0 } },
      'clientCeilings.maxEventsInvalid',
    ],
  ])('answers 400 %s, and opens no client and writes no line', async (_label, body, code) => {
    const { write, clients, logged } = await operator()
    const before = (await clients()).length

    const response = await write('post', '/api/site/clients', body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
    expect(await clients()).toHaveLength(before)
    expect(await logged()).toEqual([])
  })

  it.each([
    ['no owner', { clientName: 'Atelier Lumière' }],
    ['no name', { ownerEmail: NEWCOMER }],
    ['a key the contract does not have', { ...BODY, createdBy: ID.stranger }],
    ['a ceiling that is not one', { ...BODY, ceilings: { maxEvents: 'beaucoup' } }],
    ['a ceiling this contract does not have', { ...BODY, ceilings: { maxPhotos: 3 } }],
    ['a locale outside the catalogue', { ...BODY, locale: 'nl' }],
  ])('answers 400 request.invalid for %s', async (_label, body) => {
    const { write } = await operator()

    const response = await write('post', '/api/site/clients', body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('mails the invitation in the language of the console’s page: one subject per language, none forced', async () => {
    const { site, write } = await operator()

    for (const [index, locale] of ['fr', 'en', 'de', 'es', 'it'].entries()) {
      await write('post', '/api/site/clients', {
        clientName: `Atelier ${index}`,
        ownerEmail: `proprietaire-${index}@example.test`,
        locale,
      })
    }

    const subjects = (site.mailer?.sent ?? []).map((mail) => mail.subject.replace(/\d/g, ''))
    expect(subjects).toHaveLength(5)
    expect(new Set(subjects).size).toBe(5)
  })

  it('shows the owner’s link to the operator when the relay refused the mail, because nobody else has it', async () => {
    // "Where a mailer delivers" is a fact about **this** mail: a relay that is down is not a
    // mailer that delivered, and the link has to get to its owner some way. The use case writes
    // the token with `delivery: link` for the same reason (accepting it proves nothing about the
    // mailbox), and docs/SECURITY.md §22 names this as the one exception.
    const { site, write } = await operator({ mail: 'delivers' })
    site.mailer?.failNextWith('transient')

    const response = await write('post', '/api/site/clients', BODY)

    expect(response.status).toBe(201)
    expect(response.body.invitation.delivery).toBe('link')
    expect(response.body.invitation.link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/)
    expect(site.mailer?.sent).toEqual([])
  })
})

describe('each of the nine ceilings, on its own, reaches the use case', () => {
  // A route that drops a key answers 200 and writes nothing, because the answer is read back from
  // storage and a patch that changes nothing is not logged. So each key is sent alone and what is
  // stored is read: a tenth ceiling, or a key the handler forgot, is a row here that goes red.
  const EACH: readonly (readonly [string, unknown])[] = [
    ['maxEvents', 3],
    ['maxTotalBytes', 5_000],
    ['maxEventQuotaBytes', 4_000],
    ['maxRetentionDays', 60],
    ['clipsAllowed', false],
    ['liveAllowed', false],
    ['maxLiveDays', 4],
    ['maxEventsPerPeriod', 6],
    ['periodStartedAt', AT.toISOString()],
  ]

  it('names exactly the nine ceilings of the catalogue, so a tenth cannot go untested', () => {
    expect(EACH.map(([key]) => key).sort()).toEqual(
      Object.keys(ClientCeilings.unlimited().toProps()).sort(),
    )
  })

  it.each(EACH)('PUT changes %s alone, and the listing agrees', async (key, value) => {
    const { write, clients } = await operator()

    const response = await write('put', `/api/site/clients/${ID.clientK}/ceilings`, {
      ceilings: { [key]: value },
      reason: 'Essai d’une seule limite',
    })

    expect(response.status).toBe(200)
    expect(response.body.ceilings[key]).toEqual(value)
    const stored = (await clients()).find((row) => row.id === ID.clientK)?.ceilings ?? {}
    expect(stored[key]).toEqual(value)
  })

  it.each(EACH)('POST keeps %s as the operator named it', async (key, value) => {
    const { write, clients } = await operator()

    const response = await write('post', '/api/site/clients', {
      clientName: 'Atelier Lumière',
      ownerEmail: NEWCOMER,
      ceilings: { [key]: value },
    })

    expect(response.status).toBe(201)
    const created = (await clients()).find((row) => row.id === response.body.clientId)
    expect(created?.ceilings[key]).toEqual(value)
  })
})

describe('PATCH /api/site/clients/:clientId', () => {
  it('renames the client and answers nothing, and the listing says the new name', async () => {
    const { write, clients } = await operator()

    const response = await write('patch', `/api/site/clients/${ID.clientK}`, {
      name: 'Camille & Sacha',
    })

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect((await clients()).find((row) => row.id === ID.clientK)?.name).toBe('Camille & Sacha')
  })

  it('writes client.renamed by the operator, naming neither the old name nor the new', async () => {
    const { write, logged } = await operator()

    await write('patch', `/api/site/clients/${ID.clientK}`, { name: 'Camille & Sacha' })

    const [line, ...rest] = await logged()
    expect(rest).toEqual([])
    expect(line).toMatchObject({
      action: 'client.renamed',
      actor: { kind: 'operator', userId: ID.operator },
      subject: { type: 'client', id: ID.clientK },
      clientId: ID.clientK,
      details: {},
    })
    expect(JSON.stringify(line)).not.toContain('Camille')
  })

  it('answers 404 client.notFound for a client that does not exist, and 400 for an id that is not one', async () => {
    const { write } = await operator()

    const unknown = await write('patch', '/api/site/clients/99999999-9999-4999-8999-999999999999', {
      name: 'Qui',
    })
    const malformed = await write('patch', '/api/site/clients/k', { name: 'Qui' })

    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'client.notFound'])
    expect([malformed.status, malformed.body.error.code]).toEqual([400, 'request.invalid'])
  })

  it('answers 400 for a name the domain refuses and for a key it does not have, and renames nothing', async () => {
    const { write, clients, logged } = await operator()

    const empty = await write('patch', `/api/site/clients/${ID.clientK}`, { name: '   ' })
    const extra = await write('patch', `/api/site/clients/${ID.clientK}`, {
      name: 'Autre',
      contactEmail: 'x@example.test',
    })

    expect([empty.status, empty.body.error.code]).toEqual([400, 'clientName.empty'])
    expect([extra.status, extra.body.error.code]).toEqual([400, 'request.invalid'])
    expect((await clients()).find((row) => row.id === ID.clientK)?.name).toBe('Camille et Sacha')
    expect(await logged()).toEqual([])
  })
})

describe('PUT /api/site/clients/:clientId/ceilings', () => {
  const REASON = 'Forfait mis à jour, ticket 42'
  const put = (
    write: Awaited<ReturnType<typeof operator>>['write'],
    body: object,
    clientId: string = ID.clientK,
  ) => write('put', `/api/site/clients/${clientId}/ceilings`, body)

  it('applies the patch, keeps every ceiling it does not mention, and says what is in force now', async () => {
    const { write } = await operator()
    await put(write, { ceilings: { maxTotalBytes: 5_000, maxRetentionDays: 60 }, reason: REASON })

    const response = await put(write, { ceilings: { maxEvents: 3 }, reason: REASON })

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      ceilings: {
        maxEvents: 3,
        maxTotalBytes: 5_000,
        maxEventQuotaBytes: null,
        maxRetentionDays: 60,
        clipsAllowed: true,
        liveAllowed: true,
        maxLiveDays: null,
        maxEventsPerPeriod: null,
        periodStartedAt: null,
      },
      eventsCreatedInPeriod: 0,
    })
  })

  it('removes a ceiling when the patch says null, and the listing agrees', async () => {
    const { write, clients } = await operator()
    await put(write, { ceilings: { maxEvents: 3 }, reason: REASON })

    await put(write, { ceilings: { maxEvents: null }, reason: REASON })

    expect((await clients()).find((row) => row.id === ID.clientK)?.ceilings).toMatchObject({
      maxEvents: null,
    })
  })

  it('writes client.ceilingsChanged with the full before and after, the operator and the reason as typed', async () => {
    const { write, logged } = await operator()

    await put(write, { ceilings: { maxEvents: 3 }, reason: `  ${REASON}  ` })

    const [line] = await logged()
    expect(line).toMatchObject({
      action: 'client.ceilingsChanged',
      actor: { kind: 'operator', userId: ID.operator },
      clientId: ID.clientK,
      details: {
        before: { maxEvents: null, clipsAllowed: true },
        after: { maxEvents: 3, clipsAllowed: true },
        reason: REASON,
      },
    })
  })

  it('also writes client.periodReset when a renewal moves the period, and not the reason with it', async () => {
    const { write, logged } = await operator()

    const response = await put(write, {
      ceilings: { periodStartedAt: AT.toISOString(), maxEventsPerPeriod: 6 },
      reason: REASON,
    })

    expect(response.status).toBe(200)
    expect(response.body.ceilings.periodStartedAt).toBe(AT.toISOString())
    const lines = [...(await logged())].reverse()
    expect(lines.map((line) => line.action)).toEqual([
      'client.ceilingsChanged',
      'client.periodReset',
    ])
    expect(lines[1]?.details).not.toHaveProperty('reason')
  })

  it('writes nothing for a patch that changes nothing, though the reason is still required', async () => {
    const { write, logged } = await operator()

    const response = await put(write, { ceilings: { clipsAllowed: true }, reason: REASON })

    expect(response.status).toBe(200)
    expect(await logged()).toEqual([])
  })

  describe('the reason, which is mandatory (decided 2026-10-23)', () => {
    it('answers 400 request.invalid without one, changes nothing and writes no line', async () => {
      const { write, clients, logged } = await operator()

      const response = await put(write, { ceilings: { maxEvents: 3 } })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
      expect((await clients()).find((row) => row.id === ID.clientK)?.ceilings).toMatchObject({
        maxEvents: null,
      })
      expect(await logged()).toEqual([])
    })

    it.each([
      ['blank', '   '],
      ['empty', ''],
      ['an address', 'demande de marie@example.test'],
      ['over the bound', 'a'.repeat(201)],
      ['on several lines', 'une\nautre'],
    ])(
      'answers 400 audit.reasonInvalid for a reason that is %s, and changes nothing',
      async (_label, reason) => {
        const { write, clients, logged } = await operator()

        const response = await put(write, { ceilings: { maxEvents: 3 }, reason })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('audit.reasonInvalid')
        expect(response.body.error.details).toEqual({ max: 200 })
        expect((await clients()).find((row) => row.id === ID.clientK)?.ceilings).toMatchObject({
          maxEvents: null,
        })
        expect(await logged()).toEqual([])
      },
    )

    it('answers 400 for a reason that is not text', async () => {
      const { write } = await operator()

      const response = await put(write, { ceilings: { maxEvents: 3 }, reason: 42 })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('answers 400 for a missing reason even where the client does not exist: the shape is judged first', async () => {
      const { write } = await operator()

      const response = await put(
        write,
        { ceilings: { maxEvents: 3 } },
        '99999999-9999-4999-8999-999999999999',
      )

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('never says the reason back in an error', async () => {
      const { write } = await operator()

      const response = await put(write, {
        ceilings: { maxEvents: 3 },
        reason: 'ecrire a marie@example.test',
      })

      expect(JSON.stringify(response.body)).not.toContain('marie')
    })

    it('is not shown to the client’s owner, who reads the same line without it', async () => {
      const { site, write } = await operator()
      await put(write, { ceilings: { maxEvents: 3 }, reason: 'Note interne : mauvais payeur' })
      const owner = await site.signIn('proprio@example.test')

      const response = await owner.agent.get('/api/client/audit')

      expect(response.status).toBe(200)
      const line = response.body.items.find(
        (entry: { action: string }) => entry.action === 'client.ceilingsChanged',
      )
      expect(line.details).toEqual({ before: expect.any(Object), after: expect.any(Object) })
      expect(JSON.stringify(response.body)).not.toContain('payeur')
    })
  })

  it.each([
    ['a ceiling below the catalogue’s bound', { maxEvents: 0 }, 'clientCeilings.maxEventsInvalid'],
    [
      'a retention outside the catalogue',
      { maxRetentionDays: 100_000 },
      'clientCeilings.maxRetentionDaysInvalid',
    ],
  ])('answers 400 for %s, and changes nothing', async (_label, ceilings, code) => {
    const { write, logged } = await operator()

    const response = await put(write, { ceilings, reason: REASON })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
    expect(await logged()).toEqual([])
  })

  it.each([
    ['a ceiling this contract does not have', { ceilings: { maxPhotos: 3 }, reason: 'x y' }],
    ['a ceiling that is a string', { ceilings: { maxEvents: '3' }, reason: 'x y' }],
    ['a fractional ceiling', { ceilings: { maxEvents: 1.5 }, reason: 'x y' }],
    ['a period that is not an instant', { ceilings: { periodStartedAt: 'demain' }, reason: 'x y' }],
    ['no ceilings object', { reason: 'x y' }],
    ['a key beside them', { ceilings: {}, reason: 'x y', dryRun: true }],
  ])('answers 400 request.invalid for %s', async (_label, body) => {
    const { write } = await operator()

    const response = await put(write, body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 404 client.notFound for a client that does not exist', async () => {
    const { write } = await operator()

    const response = await put(
      write,
      { ceilings: { maxEvents: 3 }, reason: REASON },
      '99999999-9999-4999-8999-999999999999',
    )

    expect([response.status, response.body.error.code]).toEqual([404, 'client.notFound'])
  })

  it('changes only the client it names: another client’s ceilings and log are untouched', async () => {
    const { write, clients, logged } = await operator()

    await put(write, { ceilings: { maxEvents: 3 }, reason: REASON })

    const other = (await clients()).find((row) => row.id === ID.clientL)
    expect(other?.ceilings).toMatchObject({ maxEvents: null })
    expect((await logged()).map((line) => line.clientId)).toEqual([ID.clientK])
  })
})
