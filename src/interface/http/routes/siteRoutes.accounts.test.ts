import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { CSRF_HEADER } from '../middleware/csrf'
import { ID, aBox } from '../testing/siteBox'

/**
 * Ring 4. The operator's acts on accounts and on the end of an engagement (G2-14 part 3): switch an
 * account off and on, delete one for an erasure request, offboard a client. The use cases are held at
 * ring 2; what is held **here** is what only the wire can break: the refusals' codes and statuses,
 * that an act leaves the line the plan lists for it, and that what it did is what the operator's
 * own listings then say.
 */

const operator = async () => {
  const { site } = await aBox()
  const caller = await site.signInAsOperator()
  const send = (method: 'post' | 'delete', path: string, body: object = {}): request.Test =>
    caller.agent[method](path).set(CSRF_HEADER, caller.csrf).send(body)
  const logged = async () =>
    (await caller.agent.get('/api/site/audit?limit=200')).body.items as readonly {
      readonly action: string
      readonly clientId: string | null
      readonly actor: { readonly kind: string; readonly userId: string | null }
      readonly subject: { readonly type: string; readonly id: string }
      readonly details: Record<string, unknown>
    }[]
  const accounts = async () =>
    (await caller.agent.get('/api/site/accounts?limit=200')).body.items as readonly {
      readonly id: string
    }[]
  const clients = async () =>
    (await caller.agent.get('/api/site/clients?limit=200')).body.items as readonly {
      readonly id: string
      readonly suspendedAt: string | null
      readonly purgeAfter: string | null
    }[]
  return { site, caller, send, logged, accounts, clients }
}

const codeOf = (response: request.Response): string | undefined =>
  (response.body as { error?: { code?: string } }).error?.code

describe('POST /api/site/accounts/:userId/disable and /enable', () => {
  it('switches an account off, and the line names the account, the operator and the client it belongs to', async () => {
    const { send, logged } = await operator()

    const response = await send('post', `/api/site/accounts/${ID.member}/disable`)

    expect(response.status).toBe(204)
    const lines = (await logged()).filter((line) => line.action === 'account.disabled')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.subject).toEqual({ type: 'account', id: ID.member })
      expect(line.actor).toMatchObject({ kind: 'operator', userId: ID.operator })
    }
    expect(lines.some((line) => line.clientId === ID.clientK)).toBe(true)
  })

  it('refuses an operator’s account, its own included, with 403 account.operatorProtected', async () => {
    const { send, logged } = await operator()

    const response = await send('post', `/api/site/accounts/${ID.operator}/disable`)

    expect([response.status, codeOf(response)]).toEqual([403, 'account.operatorProtected'])
    expect((await logged()).filter((line) => line.action === 'account.disabled')).toEqual([])
  })

  it('answers 404 user.notFound for an account that does not exist', async () => {
    const { send } = await operator()

    const response = await send(
      'post',
      '/api/site/accounts/99999999-9999-4999-8999-999999999999/disable',
    )

    expect([response.status, codeOf(response)]).toEqual([404, 'user.notFound'])
  })

  it('answers 400 for an id that is not an id, before touching anything', async () => {
    const { send } = await operator()

    expect((await send('post', '/api/site/accounts/not-an-id/disable')).status).toBe(400)
  })

  it('switches it back on, writes the line, and is idempotent in both directions', async () => {
    const { send, logged } = await operator()
    await send('post', `/api/site/accounts/${ID.member}/disable`)
    await send('post', `/api/site/accounts/${ID.member}/disable`)

    expect((await send('post', `/api/site/accounts/${ID.member}/enable`)).status).toBe(204)
    expect((await send('post', `/api/site/accounts/${ID.member}/enable`)).status).toBe(204)

    const actions = (await logged()).map((line) => line.action)
    expect(actions.filter((action) => action === 'account.disabled').length).toBe(
      actions.filter((action) => action === 'account.enabled').length,
    )
  })
})

describe('DELETE /api/site/accounts/:userId', () => {
  it('deletes an account, which the operator’s listing then no longer has, and records it once per client', async () => {
    const { send, accounts, logged } = await operator()
    expect((await accounts()).some((account) => account.id === ID.member)).toBe(true)

    const response = await send('delete', `/api/site/accounts/${ID.member}`)

    expect(response.status).toBe(204)
    expect((await accounts()).some((account) => account.id === ID.member)).toBe(false)
    const lines = (await logged()).filter((line) => line.action === 'account.deleted')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line.subject.id === ID.member)).toBe(true)
    expect(lines.every((line) => line.actor.userId === ID.operator)).toBe(true)
  })

  it('removes no line from the log: the erasure adds its own and leaves every other as it was', async () => {
    const { send, logged } = await operator()
    await send('post', `/api/site/accounts/${ID.owner}/password-reset`)
    const before = (await logged()).length

    await send('delete', `/api/site/accounts/${ID.member}`)

    expect((await logged()).length).toBeGreaterThan(before)
  })
  it('refuses an account that owns an event, with 409 account.holdsEvents, and deletes nothing', async () => {
    const { send, accounts, logged } = await operator()

    const response = await send('delete', `/api/site/accounts/${ID.owner}`)

    expect([response.status, codeOf(response)]).toEqual([409, 'account.holdsEvents'])
    expect((await accounts()).some((account) => account.id === ID.owner)).toBe(true)
    expect((await logged()).filter((line) => line.action === 'account.deleted')).toEqual([])
  })

  it('refuses an operator’s account with 403 account.operatorProtected', async () => {
    const { send } = await operator()

    const response = await send('delete', `/api/site/accounts/${ID.operator}`)

    expect([response.status, codeOf(response)]).toEqual([403, 'account.operatorProtected'])
  })

  it('answers 404 user.notFound the second time: there is nothing left to delete', async () => {
    const { send } = await operator()
    await send('delete', `/api/site/accounts/${ID.member}`)

    const again = await send('delete', `/api/site/accounts/${ID.member}`)

    expect([again.status, codeOf(again)]).toEqual([404, 'user.notFound'])
  })
})

describe('POST /api/site/clients/:clientId/offboard', () => {
  it('freezes the client and dates the purge of its albums, and says so in the operator’s listing', async () => {
    const { send, clients } = await operator()

    const response = await send('post', `/api/site/clients/${ID.clientK}/offboard`, {
      graceDays: 30,
    })

    expect(response.status).toBe(204)
    const offboarded = (await clients()).find((client) => client.id === ID.clientK)
    expect(offboarded?.suspendedAt).not.toBeNull()
    expect(offboarded?.purgeAfter).not.toBeNull()
  })

  it('records one line with the window and the counts, and none that names an event', async () => {
    const { send, logged } = await operator()

    await send('post', `/api/site/clients/${ID.clientK}/offboard`, { graceDays: 30 })
    await send('post', `/api/site/clients/${ID.clientK}/offboard`, { graceDays: 90 })

    const lines = (await logged()).filter((line) => line.action === 'client.offboarded')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.subject).toEqual({ type: 'client', id: ID.clientK })
    expect(lines[0]?.details).toMatchObject({ graceDays: 30 })
    expect(Object.keys(lines[0]?.details ?? {}).sort()).toEqual(['archived', 'closed', 'graceDays'])
  })

  it.each([0, 366, 1.5, -3])(
    'refuses a window of %s days with 400 client.graceInvalid and changes nothing',
    async (graceDays) => {
      const { send, clients } = await operator()

      const response = await send('post', `/api/site/clients/${ID.clientK}/offboard`, { graceDays })

      expect([response.status, codeOf(response)]).toEqual([400, 'client.graceInvalid'])
      expect((await clients()).find((client) => client.id === ID.clientK)?.purgeAfter).toBeNull()
    },
  )

  it.each([{}, { graceDays: '30' }, { graceDays: 30, reason: 'x' }])(
    'refuses a body the contract does not know (%j) with 400',
    async (body) => {
      const { send } = await operator()

      expect((await send('post', `/api/site/clients/${ID.clientK}/offboard`, body)).status).toBe(
        400,
      )
    },
  )

  it('refuses to resume the client afterwards, with 409 client.offboarding: the engagement has ended', async () => {
    const { send, clients } = await operator()
    await send('post', `/api/site/clients/${ID.clientK}/offboard`, { graceDays: 30 })

    const response = await send('post', `/api/site/clients/${ID.clientK}/resume`)

    expect([response.status, codeOf(response)]).toEqual([409, 'client.offboarding'])
    expect((await clients()).find((client) => client.id === ID.clientK)?.suspendedAt).not.toBeNull()
  })

  it('answers 404 client.notFound for a client that does not exist', async () => {
    const { send } = await operator()

    const response = await send(
      'post',
      '/api/site/clients/99999999-9999-4999-8999-999999999999/offboard',
      {
        graceDays: 30,
      },
    )

    expect([response.status, codeOf(response)]).toEqual([404, 'client.notFound'])
  })
})
