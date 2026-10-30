import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS } from '../../../domain/audit/auditAction'
import { AUDIT_ACTOR_KINDS } from '../../../domain/audit/auditActor'
import { AUDIT_SUBJECT_TYPES } from '../../../domain/audit/auditSubjectType'
import { CLIENT_ROLES } from '../../../domain/clients/clientRole'
import { EVENT_STATUSES } from '../../../domain/events/eventStatus'
import { SITE_ROLES } from '../../../domain/users/siteRole'
import {
  AT,
  aClient,
  aGuest,
  aMission,
  aPhoto,
  aUser,
  atPlus,
} from '../../../application/testing/builders'
import { CSRF_HEADER } from '../middleware/csrf'
import { mountedRoutes } from '../testing/routeTable'
import { anonymousCaller, type Caller } from '../testing/signIn'
import { ADDRESS, CONTENT, ID, NEWCOMER, aBox } from '../testing/siteBox'
import { PUBLIC_URL, type SiteHarness } from '../testing/siteHarness'

/**
 * Ring 4. **No response of any `/api/site` route carries a photograph, a caption, a guest's name,
 * an event's name or any other content** (roadmap §10.4 and §10.6; docs/SECURITY.md §18).
 *
 * `SiteOverview` is content-free by construction and `siteOverviewContract` proves the read model
 * is, against the fake and against SQLite. That is one layer, and this is the one over it: **a
 * route written tomorrow that reads `EventRepository` instead of `SiteOverview`, or a presenter
 * that spreads a row, is a leak the read model's tests cannot see.** So the world below is planted
 * with a distinctive string in every place content is kept, **every route the server mounts under
 * `/api/site` is called**, and everything that comes back, at every depth and in two independent
 * ways, is swept:
 *
 * 1. **by value** — no plant appears anywhere in any answer, whatever key it comes under;
 * 2. **by shape** — every string in every answer is an id, an instant, a member of a closed set
 *    (a status, a role, an action, a delivery), the code or sentence of an error, one of the two
 *    labels the operator is allowed to read (a client's name, an account's address), the
 *    operator's own reason, or — only where no mail went out — the link the operator is to pass
 *    on; and every key is a key the contract declares.
 *
 * The first alone would miss a leak that was transformed (lower-cased, truncated); the second
 * alone would pass a plant that happened to look like an id. Together they leave a leak nowhere
 * to hide but one of the labels, which the label list pins to two.
 *
 * It also holds the other half of R2: **where a mailer delivers, no answer of any route carries a
 * token or a link**, which is asserted with the tokens the mailer was actually handed.
 */

const PLANT = {
  guestName: 'Zéphyrine Kowalczyk-Plant',
  caption: 'Légende secrète du mariage 7QZ2KM',
  prompt: 'Photographiez le gâteau de ZT4W9P',
  accountName: 'Camille Dupont-Plantée',
  passwordHash: 'hash:mot-de-passe-planté-8H2K5R',
  contactEmail: 'contact-secret@plantee.example',
  photoId: 'photo-plant-9Q4X7Z',
  guestId: 'guest-plant-3M8V2C',
} as const

/** Everything a client, a guest or a host typed or stored, and no operator route may say. */
const ALL_PLANTS: readonly string[] = [
  ...Object.values(PLANT),
  CONTENT.eventName,
  CONTENT.slug,
  CONTENT.joinCode,
  CONTENT.otherEventName,
  CONTENT.otherSlug,
  CONTENT.otherJoinCode,
]

const plant = async (site: SiteHarness): Promise<void> => {
  await site.world.addGuest(
    aGuest({ id: PLANT.guestId, eventId: ID.eventK, displayName: PLANT.guestName }),
  )
  await site.world.addMission(
    aMission({ id: 'mission-plant', eventId: ID.eventK, prompt: PLANT.prompt }),
  )
  await site.world.addPhoto(
    aPhoto({
      id: PLANT.photoId,
      eventId: ID.eventK,
      status: 'published',
      caption: PLANT.caption,
      author: { kind: 'guest', id: PLANT.guestId },
      byteSize: 4_096,
    }),
  )
  await site.world.addAccount(
    aUser({
      id: '77777777-7777-4777-8777-777777777777',
      email: 'photographe@example.test',
      displayName: PLANT.accountName,
      passwordHash: PLANT.passwordHash,
    }),
  )
  await site.world.addClient(
    // A client's contact address is personal data of its own, kept beside its name.
    aClient({
      id: '88888888-8888-4888-8888-888888888888',
      name: 'Studio Contact',
      contactEmail: PLANT.contactEmail,
      createdAt: atPlus(10),
    }),
  )
}

interface Call {
  readonly name: string
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  readonly path: string
  readonly body?: object
}

/** A photograph with an id the route accepts, planted by `run` for the takedown calls to name. */
const TAKEDOWN_PHOTO = '99999999-9999-4999-8999-999999999999'

const REASON = 'Capacité du disque revue à la baisse'

/**
 * **One call for every route the namespace mounts**, in an order in which each can succeed. The
 * test below asserts the table names every mounted route, so a new one is not covered until it
 * is written here, and it is then swept against the planted world like the rest.
 */
const CALLS: readonly Call[] = [
  { name: 'get /api/site/client-defaults', method: 'get', path: '/api/site/client-defaults' },
  { name: 'get /api/site/clients', method: 'get', path: '/api/site/clients?limit=200' },
  {
    name: 'get /api/site/clients/:clientId/events',
    method: 'get',
    path: `/api/site/clients/${ID.clientK}/events`,
  },
  { name: 'get /api/site/accounts', method: 'get', path: '/api/site/accounts?limit=200' },
  {
    name: 'post /api/site/clients',
    method: 'post',
    path: '/api/site/clients',
    body: { clientName: 'Atelier Lumière', ownerEmail: NEWCOMER },
  },
  {
    name: 'patch /api/site/clients/:clientId',
    method: 'patch',
    path: `/api/site/clients/${ID.clientK}`,
    body: { name: 'Camille et Sacha, mariés' },
  },
  {
    name: 'put /api/site/clients/:clientId/ceilings',
    method: 'put',
    path: `/api/site/clients/${ID.clientK}/ceilings`,
    body: { ceilings: { maxEvents: 3, periodStartedAt: AT.toISOString() }, reason: REASON },
  },
  {
    name: 'get /api/site/events/lookup',
    method: 'get',
    path: `/api/site/events/lookup?q=${encodeURIComponent(CONTENT.slug)}`,
  },
  {
    name: 'get /api/site/events/lookup',
    method: 'get',
    path: `/api/site/events/lookup?q=${CONTENT.joinCode}`,
  },
  {
    name: 'get /api/site/events/lookup',
    method: 'get',
    path: `/api/site/events/lookup?q=${encodeURIComponent(CONTENT.eventName)}`,
  },
  { name: 'get /api/site/events/:eventId', method: 'get', path: `/api/site/events/${ID.eventK}` },
  {
    name: 'get /api/site/photos/:photoId',
    method: 'get',
    path: `/api/site/photos/${TAKEDOWN_PHOTO}`,
  },
  ...(['take-down', 'restore'] as const).map((verb): Call => ({
    name: `post /api/site/photos/:photoId/${verb}`,
    method: 'post',
    path: `/api/site/photos/${TAKEDOWN_PHOTO}/${verb}`,
    body: { reason: REASON },
  })),
  ...(['take-down', 'restore', 'purge-hold', 'purge-release'] as const).map((verb): Call => ({
    name: `post /api/site/events/:eventId/${verb}`,
    method: 'post',
    path: `/api/site/events/${ID.eventK}/${verb}`,
    body: { reason: REASON },
  })),
  {
    name: 'post /api/site/clients/:clientId/invitations',
    method: 'post',
    path: `/api/site/clients/${ID.clientK}/invitations`,
    body: { email: 'collegue@example.test', role: 'member' },
  },
  {
    name: 'post /api/site/clients/:clientId/invitations',
    method: 'post',
    path: `/api/site/clients/${ID.clientEmpty}/invitations`,
    body: { email: 'premier@example.test', role: 'owner' },
  },
  {
    name: 'post /api/site/accounts/:userId/password-reset',
    method: 'post',
    path: `/api/site/accounts/${ID.member}/password-reset`,
    body: {},
  },
  {
    name: 'post /api/site/clients/:clientId/suspend',
    method: 'post',
    path: `/api/site/clients/${ID.clientL}/suspend`,
  },
  {
    name: 'post /api/site/clients/:clientId/resume',
    method: 'post',
    path: `/api/site/clients/${ID.clientL}/resume`,
  },
  {
    name: 'post /api/site/clients/:clientId/offboard',
    method: 'post',
    path: `/api/site/clients/${ID.clientL}/offboard`,
    body: { graceDays: 30 },
  },
  {
    name: 'post /api/site/accounts/:userId/disable',
    method: 'post',
    path: `/api/site/accounts/${ID.member}/disable`,
  },
  {
    name: 'post /api/site/accounts/:userId/enable',
    method: 'post',
    path: `/api/site/accounts/${ID.member}/enable`,
  },
  {
    name: 'delete /api/site/accounts/:userId',
    method: 'delete',
    path: `/api/site/accounts/${ID.member}`,
  },
  // The log last, so it holds what every call above wrote.
  { name: 'get /api/site/audit', method: 'get', path: '/api/site/audit?limit=200' },
  {
    name: 'get /api/site/audit',
    method: 'get',
    path: `/api/site/audit?limit=200&clientId=${ID.clientK}`,
  },
]

/** The refusals each route can answer, because an error body is a response too. */
const REFUSED: readonly Call[] = [
  { name: 'get /api/site/clients', method: 'get', path: '/api/site/clients?limit=0' },
  {
    name: 'get /api/site/clients/:clientId/events',
    method: 'get',
    path: '/api/site/clients/99999999-9999-4999-8999-999999999999/events',
  },
  { name: 'get /api/site/accounts', method: 'get', path: '/api/site/accounts?after=oui' },
  { name: 'get /api/site/audit', method: 'get', path: '/api/site/audit?actor=operateur' },
  {
    name: 'post /api/site/clients',
    method: 'post',
    path: '/api/site/clients',
    body: { clientName: 'Atelier', ownerEmail: 'pas-une-adresse' },
  },
  {
    name: 'patch /api/site/clients/:clientId',
    method: 'patch',
    path: `/api/site/clients/${ID.clientK}`,
    body: { name: '' },
  },
  {
    name: 'put /api/site/clients/:clientId/ceilings',
    method: 'put',
    path: `/api/site/clients/${ID.clientK}/ceilings`,
    body: { ceilings: { maxEvents: 0 }, reason: 'Essai avec écrire à jaime@exemple.test' },
  },
  {
    name: 'post /api/site/clients/:clientId/invitations',
    method: 'post',
    path: '/api/site/clients/99999999-9999-4999-8999-999999999999/invitations',
    body: { email: NEWCOMER, role: 'member' },
  },
  {
    name: 'post /api/site/accounts/:userId/password-reset',
    method: 'post',
    path: '/api/site/accounts/99999999-9999-4999-8999-999999999999/password-reset',
    body: {},
  },
  {
    name: 'post /api/site/clients/:clientId/suspend',
    method: 'post',
    path: '/api/site/clients/99999999-9999-4999-8999-999999999999/suspend',
  },
  {
    name: 'post /api/site/clients/:clientId/resume',
    method: 'post',
    path: '/api/site/clients/99999999-9999-4999-8999-999999999999/resume',
  },
  {
    name: 'post /api/site/clients/:clientId/offboard',
    method: 'post',
    path: '/api/site/clients/99999999-9999-4999-8999-999999999999/offboard',
    body: { graceDays: 30 },
  },
  {
    name: 'post /api/site/accounts/:userId/disable',
    method: 'post',
    path: '/api/site/accounts/99999999-9999-4999-8999-999999999999/disable',
  },
  {
    name: 'post /api/site/accounts/:userId/enable',
    method: 'post',
    path: '/api/site/accounts/99999999-9999-4999-8999-999999999999/enable',
  },
  {
    name: 'delete /api/site/accounts/:userId',
    method: 'delete',
    path: '/api/site/accounts/99999999-9999-4999-8999-999999999999',
  },
]

const send = (caller: Caller, call: Call): request.Test => {
  switch (call.method) {
    case 'get':
      return caller.agent.get(call.path)
    case 'post':
      return caller.agent
        .post(call.path)
        .set(CSRF_HEADER, caller.csrf)
        .send(call.body ?? {})
    case 'put':
      return caller.agent
        .put(call.path)
        .set(CSRF_HEADER, caller.csrf)
        .send(call.body ?? {})
    case 'patch':
      return caller.agent
        .patch(call.path)
        .set(CSRF_HEADER, caller.csrf)
        .send(call.body ?? {})
    case 'delete':
      return caller.agent
        .delete(call.path)
        .set(CSRF_HEADER, caller.csrf)
        .send(call.body ?? {})
  }
}

// ------------------------------------------------------------------ the two sweeps --

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/** `client.notFound`, `request.invalid`: a stable code, never a sentence a person typed. */
const CODE = /^[A-Za-z]+(?:\.[A-Za-z]+)+$/
/** `notFound: client.notFound`: the developer's message, which is the kind and the code. */
const MESSAGE = /^[A-Za-z]+: [A-Za-z]+(?:\.[A-Za-z]+)+$/
const LINK = new RegExp(`^${PUBLIC_URL}/(?:invite|password/reset)/[A-Za-z0-9_-]{20,}$`)

/**
 * The only free text an operator may read of the box: a client's name and an account's address.
 * Two, and a third is a decision in a diff to this list, as it is in `siteOverviewRows.test.ts`.
 */
const LABELS = new Set([
  'Camille et Sacha',
  'Camille et Sacha, mariés',
  'Fondation Bleue',
  'Client neuf',
  'Studio Contact',
  'Atelier Lumière',
  ...Object.values(ADDRESS),
  NEWCOMER,
  'photographe@example.test',
  'collegue@example.test',
  'premier@example.test',
])

const CLOSED_SET = new Set<string>([
  ...EVENT_STATUSES,
  ...CLIENT_ROLES,
  ...SITE_ROLES,
  ...AUDIT_ACTOR_KINDS,
  ...AUDIT_SUBJECT_TYPES,
  ...Object.keys(AUDIT_ACTIONS),
  'mail',
  'link',
  'pendingApproval',
])

/** What every key of every answer may be called. */
const KEYS = new Set([
  'items',
  'next',
  'id',
  'name',
  'createdAt',
  'suspendedAt',
  'takenDownAt',
  'purgeHeldAt',
  'eventId',
  'purgeAfter',
  'ceilings',
  'eventsCreatedInPeriod',
  'usage',
  'eventCount',
  'liveEventCount',
  'memberCount',
  'usedBytes',
  'maxEvents',
  'maxTotalBytes',
  'maxEventQuotaBytes',
  'maxRetentionDays',
  'clipsAllowed',
  'liveAllowed',
  'maxLiveDays',
  'maxEventsPerPeriod',
  'periodStartedAt',
  'status',
  'startsAt',
  'openedAt',
  'closedAt',
  'quotaBytes',
  'photoCount',
  'email',
  'siteRole',
  'lastLoginAt',
  'disabledAt',
  'mustChangePassword',
  'ownedEventCount',
  'clients',
  'clientId',
  'role',
  'seq',
  'at',
  'action',
  'actor',
  'kind',
  'userId',
  'label',
  'subject',
  'type',
  'details',
  'before',
  'after',
  'reason',
  'pendingApproval',
  'linkShown',
  'graceDays',
  'closed',
  'archived',
  'invitation',
  'delivery',
  'expiresAt',
  'link',
  'approvalId',
  'error',
  'code',
  'message',
  'requestId',
  'fields',
  'required',
  'max',
])

const walk = (value: unknown, visit: (kind: 'key' | 'string', text: string) => void): void => {
  if (typeof value === 'string') visit('string', value)
  else if (Array.isArray(value)) for (const item of value) walk(item, visit)
  else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      visit('key', key)
      walk(nested, visit)
    }
  }
}

const sweepByValue = (answer: string): string[] =>
  ALL_PLANTS.filter(
    (text) => answer.includes(text) || answer.toLowerCase().includes(text.toLowerCase()),
  )

/**
 * What an error says besides its code: numbers, and the **names** of the fields a request got
 * wrong (`fields: 'limit'`) or the role it lacked (`required: 'operator'`). A name is the
 * request's own key, never something the box stored, and is held to the shape of an identifier.
 */
const IDENTIFIER = /^(?:[A-Za-z][A-Za-z0-9_.,]{0,63})?$/

const sweepByShape = (body: unknown, typed: readonly string[]): string[] => {
  const unknown: string[] = []
  const details =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { details?: unknown } }).error?.details
      : undefined
  const detailEntries: [string, unknown][] =
    typeof details === 'object' && details !== null ? Object.entries(details) : []
  for (const [key, value] of detailEntries) {
    if (typeof value === 'string' && !IDENTIFIER.test(value)) unknown.push(`detail ${key}`)
  }
  walk(body, (kind, text) => {
    if (kind === 'key') {
      if (!KEYS.has(text)) unknown.push(`key ${text}`)
      return
    }
    const declared =
      (detailEntries.some(([, value]) => value === text) && IDENTIFIER.test(text)) ||
      GUID.test(text) ||
      INSTANT.test(text) ||
      CODE.test(text) ||
      MESSAGE.test(text) ||
      LINK.test(text) ||
      LABELS.has(text) ||
      CLOSED_SET.has(text) ||
      typed.includes(text)
    if (!declared) unknown.push(`string ${text}`)
  })
  return unknown
}

describe.each(['delivers', 'none'] as const)(
  'the operator’s answers, on a box whose mail %s',
  (mail) => {
    const run = async () => {
      const { site } = await aBox({ mail })
      await plant(site)
      await site.world.addPhoto(
        aPhoto({ id: TAKEDOWN_PHOTO, eventId: ID.eventK, author: { kind: 'host', id: ID.owner } }),
      )
      const operator = await site.signInAsOperator()
      const answers: { call: Call; status: number; text: string; body: unknown }[] = []
      for (const call of [...CALLS, ...REFUSED]) {
        const response = await send(operator, call)
        answers.push({ call, status: response.status, text: response.text, body: response.body })
      }
      return { site, operator, answers }
    }

    it('has planted every plant in the storage it sweeps, or the sweep proves nothing', async () => {
      const { site } = await aBox({ mail })
      await plant(site)

      const stored = site.reveal()

      expect(ALL_PLANTS.filter((text) => !stored.includes(text))).toEqual([])
    })

    it('calls every route the namespace mounts, so a new one cannot escape the sweep', async () => {
      const { site } = await aBox({ mail })

      const mounted = mountedRoutes(site.app)
        .filter((route) => route.path.startsWith('/api/site/'))
        .map((route) => `${route.method} ${route.path}`)
      const called = new Set([...CALLS, ...REFUSED].map((call) => call.name))

      expect(mounted.filter((name) => !called.has(name))).toEqual([])
      expect([...called].filter((name) => !mounted.includes(name))).toEqual([])
    })

    it('answers every call as the contract says, so the sweep reads real answers and not a wall of 500s', async () => {
      const { answers } = await run()

      for (const { call, status } of answers.slice(0, CALLS.length)) {
        // A box with no relay refuses an operator's reset by default (R2), which is an answer too.
        const refusedForWantOfARelay = mail === 'none' && call.name.endsWith('/password-reset')
        expect(
          refusedForWantOfARelay ? [409] : [200, 201, 204],
          `${call.name} ${call.path}`,
        ).toContain(status)
      }
      for (const { call, status } of answers.slice(CALLS.length)) {
        expect(status, `${call.name} ${call.path}`).toBeGreaterThanOrEqual(400)
        expect(status, `${call.name} ${call.path}`).toBeLessThan(500)
      }
    })

    it('carries no planted content, however it is cased, in the answer of any route, refusals included', async () => {
      const { answers } = await run()

      for (const { call, text } of answers) {
        expect(sweepByValue(text), `${call.name} ${call.path}`).toEqual([])
      }
    })

    it('carries nothing but ids, instants, closed sets, codes, two labels, the operator’s reason and a link where none was mailed', async () => {
      const { answers } = await run()

      for (const { call, body } of answers) {
        expect(sweepByShape(body, [REASON]), `${call.name} ${call.path}`).toEqual([])
      }
    })

    it.each([
      ['its slug', CONTENT.slug],
      ['its join code', CONTENT.joinCode],
      ['its exact name', CONTENT.eventName],
    ])(
      'finds exactly the planted event from %s, so the sweep reads a real hit',
      async (_how, query) => {
        const { site } = await aBox({ mail })
        const operator = await site.signInAsOperator()

        const found = await operator.agent.get(
          `/api/site/events/lookup?q=${encodeURIComponent(query)}`,
        )

        expect(found.status).toBe(200)
        expect(found.body.items).toHaveLength(1)
        expect(found.body.items[0].id).toBe(ID.eventK)
        expect(sweepByValue(found.text)).toEqual([])
      },
    )

    it('answers the three takedown reads with no-store, so a shared cache never holds an id for a name', async () => {
      const { site } = await aBox({ mail })
      const operator = await site.signInAsOperator()

      for (const path of [
        `/api/site/events/lookup?q=${CONTENT.joinCode}`,
        `/api/site/events/${ID.eventK}`,
        '/api/site/photos/99999999-9999-4999-8999-999999999999',
      ]) {
        const response = await operator.agent.get(path)

        expect(response.headers['cache-control'], path).toBe('no-store')
      }
    })

    it('shows nothing a guest wrote, however much an event holds: the same listing for an event with a photograph and one with none', async () => {
      const { site } = await aBox({ mail })
      const operator = await site.signInAsOperator()
      const before = await operator.agent.get(`/api/site/clients/${ID.clientK}/events`)
      await plant(site)

      const after = await operator.agent.get(`/api/site/clients/${ID.clientK}/events`)

      expect(after.body.items[0].photoCount).toBe(1)
      expect(after.body.items[0].usedBytes).toBe(4_096)
      expect(Object.keys(after.body.items[0]).sort()).toEqual(
        Object.keys(before.body.items[0]).sort(),
      )
    })

    it('answers the same nothing to a caller who is not the operator: a refusal names no client, event or account', async () => {
      const { site } = await aBox({ mail })
      await plant(site)
      const owner = await site.signIn(ADDRESS.owner)
      const stranger = await anonymousCaller(site.app)

      for (const call of CALLS) {
        for (const caller of [owner, stranger]) {
          const response = await send(caller, call)
          expect([401, 403], call.path).toContain(response.status)
          expect(sweepByValue(response.text), call.path).toEqual([])
          expect(sweepByShape(response.body, []), call.path).toEqual([])
        }
      }
    })

    if (mail === 'delivers') {
      it('carries no token and no link where a mailer delivers, whatever the route: they are in the inbox and nowhere else', async () => {
        const { site, answers } = await run()

        const mails = site.mailer?.sent ?? []
        const tokens = mails.flatMap((mailed) =>
          [...mailed.text.matchAll(/\/(?:invite|password\/reset)\/([A-Za-z0-9_-]{20,})/g)].map(
            (match) => match[1] ?? '',
          ),
        )
        // Three invitations and one reset went out, so there is something to look for.
        expect(tokens).toHaveLength(4)
        for (const { call, text } of answers) {
          for (const token of tokens) expect(text, `${call.name} ${call.path}`).not.toContain(token)
          expect(text, `${call.name} ${call.path}`).not.toMatch(/\/invite\/|\/password\/reset\//)
        }
      })
    } else {
      it('hands the operator a link for an invitation only, and for no reset', async () => {
        const { answers } = await run()

        const withLink = answers.filter(({ text }) => /\/invite\/|\/password\/reset\//.test(text))

        expect(withLink.map(({ call }) => call.name)).toEqual([
          'post /api/site/clients',
          'post /api/site/clients/:clientId/invitations',
          'post /api/site/clients/:clientId/invitations',
        ])
      })
    }
  },
)
