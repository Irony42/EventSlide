import type request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetClientLimits } from '../../../application/usecases/clients/getClientLimits'
import { makeListClientAudit } from '../../../application/usecases/clients/listClientAudit'
import { makeListPendingInvitations } from '../../../application/usecases/clients/listPendingInvitations'
import {
  AT,
  aClient,
  aClientCeilings,
  aPhoto,
  aUser,
  anAccountToken,
  anAuditEntry,
  anEvent,
  atPlus,
} from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import {
  A_PATH_NOBODY_WROTE,
  anonymousCaller,
  signedInAs,
  signInByAddress,
  setCookies,
} from '../testing/signIn'
import { CSRF_HEADER } from '../middleware/csrf'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'

/**
 * The client's own space over the wire (G2-16 / P3-17): `GET /api/me/limits`,
 * `GET /api/client/audit` and `GET /api/client/invitations`, through the assembled server and
 * the real use cases over the in-memory fakes.
 *
 * What is held **here** is what only the wire can break, and it is mostly one rule seen from
 * four sides: **client A never reads client B's limits, log or invitations**, and what A does
 * read names no account, no event and no address but its own invitee's. The rules behind it
 * (who may read, what is counted) are held at ring 2 in `clientSpace.test.ts`.
 *
 * It is also where "`SITE_ADMIN=off` stays byte-identical" is held for these three routes: with
 * the switch off none of them exists, and each answers as a path nobody wrote.
 */

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const OWNER_A = '22222222-2222-4222-8222-222222222222'
const MEMBER_A = '33333333-3333-4333-8333-333333333333'
const OWNER_B = '44444444-4444-4444-8444-444444444444'
const STRANGER = '55555555-5555-4555-8555-555555555555'
const BOTH = '66666666-6666-4666-8666-666666666666'
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const ACCOUNTS: Readonly<Record<string, string>> = {
  'ops@example.test': OPERATOR,
  'proprio-a@example.test': OWNER_A,
  'membre-a@example.test': MEMBER_A,
  'proprio-b@example.test': OWNER_B,
  'inconnu@example.test': STRANGER,
  'les-deux@example.test': BOTH,
}

/** What a client's guests and host typed: none of it may ever reach these three routes. */
const PLANTED_SLUG = 'mariage-secret-dupont'
const PLANTED_CODE = 'ZQ7K2M'
const PLANTED_EVENT_NAME = 'Mariage Secret Dupont'

const PATHS = ['/api/me/limits', '/api/client/audit', '/api/client/invitations'] as const

describe('the client space routes', () => {
  let subject: ServerHarness
  let audit: FakeAuditLog
  let tokens: FakeAccountTokenRepository
  let photos: FakePhotoRepository

  const build = async (siteAdmin: boolean): Promise<void> => {
    audit = new FakeAuditLog().withAccounts(asUserId(OPERATOR), asUserId(OWNER_A))
    tokens = new FakeAccountTokenRepository()
      .withAccounts(asUserId(OPERATOR), asUserId(OWNER_A), asUserId(OWNER_B))
      .withClients(asClientId(CLIENT_A), asClientId(CLIENT_B))

    // The use cases are built over the harness's own accounts and clients, which exist only
    // once the harness does, so the routes are handed functions that read the real ones.
    const wire = () => ({
      getClientLimits: makeGetClientLimits({ clients: subject.clients, photos }),
      listClientAudit: makeListClientAudit({ clients: subject.clients, audit }),
      listPendingInvitations: makeListPendingInvitations({
        clients: subject.clients,
        tokens,
        clock: subject.clock,
      }),
    })
    let wired: ReturnType<typeof wire> | undefined
    const get = () => (wired ??= wire())
    subject = buildServerHarness({
      config: { siteAdmin },
      usecases: {
        authenticateUser: signInByAddress(ACCOUNTS),
        getClientLimits: (input) => get().getClientLimits(input),
        listClientAudit: (input) => get().listClientAudit(input),
        listPendingInvitations: (input) => get().listPendingInvitations(input),
      },
    })
    photos = new FakePhotoRepository().chargeClientBytesFrom(subject.clients)

    subject.users.seed(
      aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator' }),
      aUser({ id: OWNER_A, email: 'proprio-a@example.test' }),
      aUser({ id: MEMBER_A, email: 'membre-a@example.test' }),
      aUser({ id: OWNER_B, email: 'proprio-b@example.test' }),
      aUser({ id: STRANGER, email: 'inconnu@example.test' }),
      aUser({ id: BOTH, email: 'les-deux@example.test' }),
    )
    subject.clients.seed(
      aClient({
        id: CLIENT_A,
        name: 'Atelier Alpha',
        ceilings: aClientCeilings({ maxEvents: 2, maxTotalBytes: 1_000 }),
        eventsCreatedInPeriod: 1,
      }),
      aClient({
        id: CLIENT_B,
        name: 'Atelier Bravo Confidentiel',
        suspendedAt: AT,
        ceilings: aClientCeilings({ maxEvents: 9 }),
      }),
    )
    for (const [clientId, userId, role] of [
      [CLIENT_A, OWNER_A, 'owner'],
      [CLIENT_A, MEMBER_A, 'member'],
      [CLIENT_B, OWNER_B, 'owner'],
      [CLIENT_A, BOTH, 'owner'],
      [CLIENT_B, BOTH, 'owner'],
    ] as const) {
      await subject.clients.grantMember({
        clientId: asClientId(clientId),
        userId: asUserId(userId),
        role,
        grantedAt: AT,
      })
    }
    // An event of A with content in it, so the sweeps have something to find if it leaks.
    subject.events.seed(
      anEvent({
        id: 'event-a',
        ownerId: OWNER_A,
        clientId: CLIENT_A,
        name: PLANTED_EVENT_NAME,
        slug: PLANTED_SLUG,
        joinCode: PLANTED_CODE,
      }),
    )
    await photos.save(
      aPhoto({
        id: 'photo-a',
        eventId: 'event-a',
        byteSize: 950,
        caption: 'Notre secret de famille',
      }),
    )
    // The log: two entries about A (one by the operator, one by a member), one about B.
    await audit.record(
      anAuditEntry({
        clientId: CLIENT_A,
        action: 'client.ceilingsChanged',
        actor: { kind: 'operator', userId: asUserId(OPERATOR) },
        at: atPlus(1),
      }),
    )
    await audit.record(
      anAuditEntry({
        clientId: CLIENT_A,
        action: 'invitation.approved',
        subject: { type: 'invitation', id: 'inv-a' },
        actor: { kind: 'member', userId: asUserId(OWNER_A) },
        details: {},
        at: atPlus(2),
      }),
    )
    await audit.record(
      anAuditEntry({
        clientId: CLIENT_B,
        action: 'client.ceilingsChanged',
        actor: { kind: 'operator', userId: asUserId(OPERATOR) },
        at: atPlus(3),
      }),
    )
    // Two invitations waiting: one for A, one for B.
    for (const [id, clientId, email] of [
      ['inv-a', CLIENT_A, 'invite-a@example.test'],
      ['inv-b', CLIENT_B, 'invite-b@example.test'],
    ] as const) {
      await tokens.save(
        anAccountToken({
          id,
          purpose: 'invitation',
          email,
          userId: null,
          eventId: null,
          eventRole: null,
          clientId,
          clientRole: 'member',
          requiresApproval: true,
          delivery: 'link',
          createdBy: OPERATOR,
        }),
      )
    }
  }

  const read = async (as: string, path: string): Promise<request.Response> =>
    (await signedInAs(subject.app, as)).agent.get(path)

  describe('SITE_ADMIN=on', () => {
    beforeEach(() => build(true))

    it.each(PATHS)('refuses %s to a caller with no session', async (path) => {
      const caller = await anonymousCaller(subject.app)

      const response = await caller.agent.get(path)

      expect(response.status).toBe(401)
      expect((response.body as { error: { code: string } }).error.code).toBe('auth.required')
    })

    describe('GET /api/me/limits', () => {
      it('gives an owner their own client, what it may do and what it has used', async () => {
        const response = await read('proprio-a@example.test', '/api/me/limits')

        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({
          clients: [
            {
              id: CLIENT_A,
              name: 'Atelier Alpha',
              role: 'owner',
              suspended: false,
              ceilings: { maxEvents: 2, maxTotalBytes: 1_000, clipsAllowed: true },
              usage: { events: 1, eventsCreatedInPeriod: 1, usedBytes: 950 },
              meters: [
                { kind: 'events', used: 1, max: 2, level: 'ok' },
                { kind: 'storage', used: 950, max: 1_000, level: 'warning' },
              ],
            },
          ],
        })
      })

      it('never gives client A a trace of client B, and the other way round', async () => {
        const mine = await read('proprio-a@example.test', '/api/me/limits')
        const theirs = await read('proprio-b@example.test', '/api/me/limits')

        expect(JSON.stringify(mine.body)).not.toContain(CLIENT_B)
        expect(JSON.stringify(mine.body)).not.toContain('Bravo')
        expect(JSON.stringify(theirs.body)).not.toContain(CLIENT_A)
        expect(JSON.stringify(theirs.body)).not.toContain('Alpha')
        expect(theirs.body).toMatchObject({ clients: [{ id: CLIENT_B, suspended: true }] })
      })

      it('names no event, slug, join code, caption or account, only numbers about the client', async () => {
        const response = await read('proprio-a@example.test', '/api/me/limits')
        const text = JSON.stringify(response.body)

        for (const planted of [
          PLANTED_SLUG,
          PLANTED_CODE,
          PLANTED_EVENT_NAME,
          'secret de famille',
          OPERATOR,
          OWNER_A,
          'example.test',
        ]) {
          expect(text).not.toContain(planted)
        }
      })

      it('gives an account in several clients all of them, and nothing about a third', async () => {
        const response = await read('les-deux@example.test', '/api/me/limits')

        expect(
          (response.body as { clients: { id: string }[] }).clients.map((c) => c.id).sort(),
        ).toEqual([CLIENT_A, CLIENT_B])
      })

      it('gives an account with no client, and the operator, an empty list', async () => {
        for (const email of ['inconnu@example.test', 'ops@example.test']) {
          const response = await read(email, '/api/me/limits')

          expect(response.status).toBe(200)
          expect(response.body).toEqual({ clients: [] })
        }
      })

      it('is never kept by a cache', async () => {
        const response = await read('proprio-a@example.test', '/api/me/limits')

        expect(response.headers['cache-control']).toBe('no-store')
      })

      it('refuses a parameter it does not have, such as another client’s id', async () => {
        const response = await read('proprio-a@example.test', `/api/me/limits?clientId=${CLIENT_B}`)

        expect(response.status).toBe(400)
        expect(JSON.stringify(response.body)).not.toContain('Bravo')
      })
    })

    describe('GET /api/client/audit', () => {
      it('gives an owner every entry about their client, newest first, and no other', async () => {
        const response = await read('proprio-a@example.test', '/api/client/audit')

        expect(response.status).toBe(200)
        const items = (response.body as { items: { seq: number; action: string }[] }).items
        expect(items.map((item) => item.seq)).toEqual([2, 1])
        expect(items.map((item) => item.action)).toEqual([
          'invitation.approved',
          'client.ceilingsChanged',
        ])
      })

      it('names no account: neither the operator behind an action nor the owner behind an approval', async () => {
        const response = await read('proprio-a@example.test', '/api/client/audit')
        const text = JSON.stringify(response.body)

        expect(text).not.toContain(OPERATOR)
        expect(text).not.toContain(OWNER_A)
        expect(text).not.toMatch(/userId|email|example\.test/)
        expect(response.body).toMatchObject({
          items: [
            { actor: { kind: 'member', label: null } },
            { actor: { kind: 'operator', label: null } },
          ],
        })
      })

      it('carries nothing of the content the client’s events hold', async () => {
        const text = JSON.stringify(
          (await read('proprio-a@example.test', '/api/client/audit')).body,
        )

        for (const planted of [
          PLANTED_SLUG,
          PLANTED_CODE,
          PLANTED_EVENT_NAME,
          'secret de famille',
        ]) {
          expect(text).not.toContain(planted)
        }
      })

      it('says what an operator changed, in the allow-listed numbers and switches', async () => {
        const response = await read('proprio-a@example.test', '/api/client/audit')

        expect(response.body).toMatchObject({
          items: [{}, { details: { before: { maxEvents: 5 }, after: expect.any(Object) } }],
        })
      })

      it('never gives client A the entries about client B, whichever way it asks', async () => {
        const unnamed = await read('proprio-a@example.test', '/api/client/audit')
        const named = await read('proprio-a@example.test', `/api/client/audit?clientId=${CLIENT_B}`)

        expect(JSON.stringify(unnamed.body)).not.toContain(CLIENT_B)
        expect(named.status).toBe(404)
        expect((named.body as { error: { code: string } }).error.code).toBe('client.notFound')
        // The same answer for a client that does not exist.
        const nobody = await read(
          'proprio-a@example.test',
          '/api/client/audit?clientId=cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        )
        expect(nobody.status).toBe(404)
        expect(nobody.body).toEqual(named.body)
      })

      it('lets an account in several clients choose, and only among its own', async () => {
        const needsAChoice = await read('les-deux@example.test', '/api/client/audit')
        const chosen = await read('les-deux@example.test', `/api/client/audit?clientId=${CLIENT_B}`)

        expect(needsAChoice.status).toBe(404)
        expect(chosen.status).toBe(200)
        expect((chosen.body as { items: { seq: number }[] }).items.map((i) => i.seq)).toEqual([3])
      })

      it('refuses a member who is not an owner, 403, and an account with no client, 404', async () => {
        const member = await read('membre-a@example.test', '/api/client/audit')
        const stranger = await read('inconnu@example.test', '/api/client/audit')

        expect(member.status).toBe(403)
        expect((member.body as { error: { code: string } }).error.code).toBe('client.ownerRequired')
        expect(stranger.status).toBe(404)
      })

      it('pages: limit, and the next cursor to carry on from', async () => {
        const first = await read('proprio-a@example.test', '/api/client/audit?limit=1')
        const next = (first.body as { next: number | null }).next

        expect((first.body as { items: unknown[] }).items).toHaveLength(1)
        expect(next).toBe(2)

        const second = await read(
          'proprio-a@example.test',
          `/api/client/audit?limit=1&before=${next}`,
        )

        expect((second.body as { items: { seq: number }[] }).items.map((i) => i.seq)).toEqual([1])
        expect((second.body as { next: number | null }).next).toBeNull()
      })

      it.each([
        ['an unknown filter', '?actor=operator'],
        ['a limit above the ceiling', '?limit=101'],
        ['a limit of zero', '?limit=0'],
        ['a cursor that is not a number', '?before=abc'],
        ['a client id that is not an id', '?clientId=not-an-id'],
      ])('refuses %s with a 400, so it is never believed to have applied', async (_name, query) => {
        const response = await read('proprio-a@example.test', `/api/client/audit${query}`)

        expect(response.status).toBe(400)
      })

      it('is never kept by a cache', async () => {
        const response = await read('proprio-a@example.test', '/api/client/audit')

        expect(response.headers['cache-control']).toBe('no-store')
      })
    })

    describe('GET /api/client/invitations', () => {
      it('shows an owner whom the invitations waiting on them are for, and nothing that opens one', async () => {
        const response = await read('proprio-a@example.test', '/api/client/invitations')

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          items: [
            {
              id: 'inv-a',
              email: 'invite-a@example.test',
              role: 'member',
              createdAt: AT.toISOString(),
              expiresAt: atPlus(7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        })
      })

      it('never shows client A the invitations waiting on client B', async () => {
        const mine = await read('proprio-a@example.test', '/api/client/invitations')
        const named = await read(
          'proprio-a@example.test',
          `/api/client/invitations?clientId=${CLIENT_B}`,
        )

        expect(JSON.stringify(mine.body)).not.toContain('invite-b')
        expect(named.status).toBe(404)
      })

      it('refuses a member who is not an owner, and an account with no client', async () => {
        expect((await read('membre-a@example.test', '/api/client/invitations')).status).toBe(403)
        expect((await read('inconnu@example.test', '/api/client/invitations')).status).toBe(404)
      })

      it('refuses a query it does not have', async () => {
        const response = await read('proprio-a@example.test', '/api/client/invitations?all=1')

        expect(response.status).toBe(400)
      })
    })
  })

  describe('SITE_ADMIN=off', () => {
    beforeEach(() => build(false))

    /** Everything a caller can observe of a response, less the one header that is the clock's. */
    const observable = (response: request.Response) => ({
      status: response.status,
      body: response.text,
      headers: Object.fromEntries(
        Object.entries(response.headers)
          .filter(([name]) => name !== 'date')
          .map(([name, value]): [string, unknown] =>
            name === 'set-cookie'
              ? [
                  name,
                  setCookies(response.headers).map((cookie) =>
                    cookie.replace(/Expires=[^;]+/i, 'Expires=<rolling>'),
                  ),
                ]
              : [name, value],
          )
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    })

    it.each(PATHS)('answers GET %s exactly as a path nobody wrote, for anybody', async (path) => {
      for (const email of [null, 'proprio-a@example.test', 'ops@example.test']) {
        const caller =
          email === null ? await anonymousCaller(subject.app) : await signedInAs(subject.app, email)
        const send = (target: string) =>
          caller.agent
            .get(target)
            .set('x-request-id', 'client-space-off')
            .set(CSRF_HEADER, caller.csrf)

        const reference = await send(A_PATH_NOBODY_WROTE)
        const response = await send(path)

        expect(response.status).toBe(404)
        expect((response.body as { error: { code: string } }).error.code).toBe('route.notFound')
        expect(observable(response)).toEqual(observable(reference))
      }
    })
  })
})
