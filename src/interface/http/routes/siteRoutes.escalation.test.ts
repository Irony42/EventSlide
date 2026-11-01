import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT, aUser, anEvent } from '../../../application/testing/builders'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { CSRF_HEADER } from '../middleware/csrf'
import { mountedRoutes, type Route } from '../testing/routeTable'
import { anonymousCaller, type Caller } from '../testing/signIn'
import { ADDRESS, ID, aBox } from '../testing/siteBox'
import type { SiteHarness } from '../testing/siteHarness'

/**
 * Ring 4. **The operator, and anybody the operator invited without an owner's approval, is a
 * stranger to every event of the client, after every mutation they make** (anti-escalation, the
 * operator guard R1 to R6, docs/SECURITY.md §20; paid plan P3-13).
 *
 * The guard's rules are in the use cases, and each is held there. This is the net under a **route
 * that forgets one**, or a rule that is right and a route that hands the operator what the rule
 * withheld: it drives the operator through `/api/site` as an operator would, and after **every
 * step** asks every event route of the box what the operator and the accounts it brought in are
 * told. The answer has to be the one a stranger gets, route by route: a `404` where `requireRole`
 * hides the event, a `401` where a guest's token is asked for. Never a `2xx`, and never anything
 * that differs from what an account with no part in the client is told.
 *
 * "The accounts it brought in" is the account an operator may create without anybody's say: one
 * invited into a client that holds nothing (R1's one exception). It becomes a **member of the
 * client** and nothing more, because a client is not an event, and what is held here is that
 * membership of the one never reads as membership of the other.
 *
 * **What this does not claim**, written down because a sweep that over-claims is trusted too far:
 * it asks what the operator's own session and the accounts it invited can do to a client's events
 * with the routes the product mounts. It does not ask what an operator who *controls* such an
 * account can get an **owner's approval** to do on a box that opted into
 * `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`; that weakening is said, with its limit, in
 * SECURITY.md §20 and §22.
 */

const PASSWORD = 'une phrase de passe 2026'
const ACCOMPLICE = 'complice@example.test'
const SECOND = 'second@example.test'
const JEAN = '99999999-9999-4999-8999-999999999999'
const FETE = '88888888-8888-4888-8888-888888888888'

/** What the sweep puts in a path for each parameter an event route has. Never reached. */
const PARAMETERS: Readonly<Record<string, string>> = {
  eventSlug: 'fete-de-jean',
  photoId: '33333333-3333-4333-8333-333333333333',
  guestId: '33333333-3333-4333-8333-333333333333',
  userId: '33333333-3333-4333-8333-333333333333',
  clipJobId: '33333333-3333-4333-8333-333333333333',
  missionId: '33333333-3333-4333-8333-333333333333',
  linkId: '33333333-3333-4333-8333-333333333333',
  variant: 'display',
  hash: '0'.repeat(64),
  kind: 'love',
  token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
}

const withParameters = (path: string): string =>
  path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = PARAMETERS[name]
    if (value === undefined) throw new Error(`no placeholder for ":${name}" in ${path}`)
    return value
  })

/**
 * The routes about an account or the box and not about a client's events: the answer to the
 * operator is **meant** to differ from a stranger's there, because it is about who is asking.
 * Everything else the server mounts is swept, so a route nobody classified is swept and not
 * skipped.
 */
const NOT_ABOUT_EVENTS: readonly string[] = [
  // Public by token, where the token is the credential and a caller who does not hold it is
  // answered the same neutral way whoever it is. They are rate-limited per caller, so what two
  // callers are told differs with how many times each has asked, which says nothing about access;
  // `siteOperatorScope.test.ts` asserts of each that it answers a caller with no credential at all.
  '/api/gallery',
  '/api/gallery-media',
  '/api/join',
  '/api/site',
  '/api/auth',
  '/api/health',
  '/api/ready',
  '/api/about',
  '/api/client',
  '/api/me',
  '/api/invitations',
]
/** The caller's own dashboard, and creating an event of one's own: about who is asking. */
const ACCOUNT_LEVEL: ReadonlySet<string> = new Set(['get /api/events', 'post /api/events'])

/**
 * The one route that is public **and never ends**: the wall's channel, which a projector opens
 * with no credential and which answers everybody the same open stream. Asking it would hang the
 * sweep, and what it would show is that the operator is told what everybody is told, which a
 * public route is by definition. `siteOperatorScope.test.ts` reads its status line and hangs up.
 */
const OPEN_FOR_EVERYBODY = 'get /api/events/:eventSlug/stream'

/**
 * The public routes of an event that reach a use case this harness does not wire, so that every
 * caller, a stranger included, is answered a 500 by them. A route that is public is the same for
 * everybody by definition; any **other** route a stranger can crash is a defect of its own, and
 * the sweep names it instead of calling two crashes the same answer.
 */
const PUBLIC_AND_UNWIRED: ReadonlySet<string> = new Set([
  'get /api/events/:eventSlug/wall',
  'get /api/events/:eventSlug/photos/:photoId/:variant',
  'get /api/events/:eventSlug/venue-photo/:hash',
  'get /api/events/:eventSlug/logo/:hash',
])

const isLeftOut = (route: Route): boolean =>
  `${route.method} ${route.path}` === OPEN_FOR_EVERYBODY ||
  ACCOUNT_LEVEL.has(`${route.method} ${route.path}`) ||
  NOT_ABOUT_EVENTS.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`))

const eventRoutes = (site: SiteHarness): readonly Route[] =>
  mountedRoutes(site.app).filter((route) => !isLeftOut(route))

const send = (caller: Caller, route: Route): request.Test => {
  const path = withParameters(route.path)
  switch (route.method) {
    case 'get':
      return caller.agent.get(path)
    case 'post':
      return caller.agent.post(path).set(CSRF_HEADER, caller.csrf).send({})
    case 'patch':
      return caller.agent.patch(path).set(CSRF_HEADER, caller.csrf).send({})
    case 'put':
      return caller.agent.put(path).set(CSRF_HEADER, caller.csrf).send({})
    case 'delete':
      return caller.agent.delete(path).set(CSRF_HEADER, caller.csrf)
    default:
      throw new Error(`this sweep does not know how to issue a ${route.method} request`)
  }
}

const answerTo = async (caller: Caller, route: Route) => {
  const response = await send(caller, route)
  const code = (response.body as { error?: { code?: string } }).error?.code ?? null
  return { status: response.status, code }
}

const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error('fixture rejected')
  return parsed.value
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

describe('the operator and the accounts it brought in, on the events of a client they have no part in', () => {
  /**
   * A box where the operator can do everything an operator may: no relay, so it is handed every
   * link it writes, and `copyLinkWithOwnerApproval`, the most that R2 lets it ask for.
   */
  const aBoxToSweep = async () => {
    const { site } = await aBox({ mail: 'none', resetLinks: 'copyLinkWithOwnerApproval' })
    const operator = await site.signInAsOperator()
    const act = (method: Method, path: string, body: object = {}): request.Test =>
      method === 'get'
        ? operator.agent.get(path)
        : operator.agent[method](path).set(CSRF_HEADER, operator.csrf).send(body)

    // The one account an operator may bring in without anybody's say: the first owner of a
    // client it has just opened, an address it controls. The invitation waits for nobody, because
    // the client holds nothing, and a second one would (SECURITY.md §20, R1).
    const opened = await act('post', '/api/site/clients', {
      clientName: 'Le complice et compagnie',
      ownerEmail: ACCOMPLICE,
    })
    const clientId: string = opened.body.clientId
    expect(opened.body.invitation.pendingApproval).toBe(false)
    const token = /\/invite\/([A-Za-z0-9_-]+)$/.exec(opened.body.invitation.link)?.[1]
    const newcomer = await anonymousCaller(site.app)
    const accepted = await newcomer.agent
      .post(`/api/invitations/${token}/accept`)
      .set(CSRF_HEADER, newcomer.csrf)
      .send({ displayName: 'Le complice', password: PASSWORD })
    expect(accepted.status).toBe(200)
    expect(await site.recognise(ACCOMPLICE)).toBe(true)

    // Then a customer of the same client, who has an event: the evening this is all about. How
    // they came to be in the client (an invitation an owner approved) is not what is swept; what
    // is held is that the client's owner and the operator are told nothing of their event.
    await site.addAccount(aUser({ id: JEAN, email: 'jean@example.test' }))
    await site.world.addClientMember({
      clientId: asClientId(clientId),
      userId: asUserId(JEAN),
      role: 'owner',
      grantedAt: AT,
    })
    await site.world.addEvent(
      anEvent({ id: FETE, ownerId: JEAN, clientId, name: 'La fête de Jean', slug: 'fete-de-jean' }),
    )
    await site.repos.memberships.grant({
      eventId: asEventId(FETE),
      userId: asUserId(JEAN),
      role: 'owner',
      grantedAt: AT,
    })

    const accomplice = await site.signIn(ACCOMPLICE)
    const stranger = await site.signIn(ADDRESS.stranger)
    return { site, operator, accomplice, stranger, act, clientId }
  }

  type Scene = Awaited<ReturnType<typeof aBoxToSweep>>

  /**
   * What every event route tells the operator (the very session that just acted) and the account
   * it invited, against what it tells a stranger. Returns the routes where they were not told the
   * same thing, or were let in.
   */
  const differencesFromAStranger = async (scene: Scene): Promise<string[]> => {
    const different: string[] = []
    for (const route of eventRoutes(scene.site)) {
      const theirs = await answerTo(scene.stranger, route)
      const name = `${route.method} ${route.path}`
      if (theirs.status >= 500 && !PUBLIC_AND_UNWIRED.has(name)) {
        different.push(`a stranger crashed ${name}: ${theirs.status}`)
      }
      for (const [who, caller] of [
        ['the operator', scene.operator],
        ['the account it invited', scene.accomplice],
      ] as const) {
        const ours = await answerTo(caller, route)
        if (ours.status !== theirs.status || ours.code !== theirs.code) {
          different.push(
            `${who}: ${name} answered ${ours.status} ${ours.code}, a stranger ${theirs.status} ${theirs.code}`,
          )
        }
        // A 2xx where a stranger is refused is the leak. A route that answers 5xx to a stranger
        // reaches a use case this harness does not wire: it is public, by definition, and then
        // the same for everyone, which the comparison above holds.
        if (ours.status >= 200 && ours.status < 300 && theirs.status >= 400) {
          different.push(`${who}: ${name} was let in`)
        }
      }
    }
    return different
  }

  it('sweeps the event routes this server mounts, a good many of them, or it proves nothing', async () => {
    const { site } = await aBox()

    const names = eventRoutes(site).map((route) => `${route.method} ${route.path}`)

    expect(names).toEqual(
      expect.arrayContaining([
        'get /api/events/:eventSlug/moderation',
        'patch /api/events/:eventSlug/photos/:photoId/status',
        'get /api/events/:eventSlug/album.zip',
        'patch /api/events/:eventSlug/settings',
        'post /api/events/:eventSlug/moderators',
      ]),
    )
    expect(names.length).toBeGreaterThanOrEqual(30)
  })

  it('leaves out only the account-level and box-level routes, and every one it leaves out is mounted', async () => {
    const { site } = await aBox()

    const left = mountedRoutes(site.app).filter(isLeftOut)

    expect(left.length).toBeGreaterThan(10)
    for (const name of ACCOUNT_LEVEL) {
      expect(left.map((route) => `${route.method} ${route.path}`)).toContain(name)
    }
    for (const prefix of NOT_ABOUT_EVENTS) {
      expect(
        left.some((route) => route.path === prefix || route.path.startsWith(`${prefix}/`)),
        prefix,
      ).toBe(true)
    }
  })

  it('has set the scene: the account the operator invited is a member of the client and of no event', async () => {
    const { site, clientId } = await aBoxToSweep()

    const accounts = await (await site.signInAsOperator()).agent.get('/api/site/accounts?limit=200')

    const complice = accounts.body.items.find((row: { email: string }) => row.email === ACCOMPLICE)
    expect(complice.clients).toEqual([{ clientId, role: 'owner' }])
    expect(complice.ownedEventCount).toBe(0)
  })

  it('tells them what it tells a stranger before the operator has done anything more', async () => {
    const scene = await aBoxToSweep()

    expect(await differencesFromAStranger(scene)).toEqual([])
  })

  it('tells them what it tells a stranger after every mutation the operator can make', async () => {
    const scene = await aBoxToSweep()
    const { act, clientId, site } = scene
    const accomplice = (await site.repos.users.findByEmail(emailOf(ACCOMPLICE)))?.id ?? ''

    const mutations: readonly { readonly name: string; readonly run: () => request.Test }[] = [
      {
        name: 'opens another client',
        run: () => act('post', '/api/site/clients', { clientName: 'Autre', ownerEmail: SECOND }),
      },
      {
        name: 'renames the client',
        run: () => act('patch', `/api/site/clients/${clientId}`, { name: 'Jean et Marie, mariés' }),
      },
      {
        name: 'changes its ceilings',
        run: () =>
          act('put', `/api/site/clients/${clientId}/ceilings`, {
            ceilings: { maxEvents: 5 },
            reason: 'Forfait mis à jour',
          }),
      },
      {
        name: 'invites somebody into the client, which now waits for an owner',
        run: () =>
          act('post', `/api/site/clients/${clientId}/invitations`, {
            email: SECOND,
            role: 'member',
          }),
      },
      {
        name: 'invites itself into the client as an owner',
        run: () =>
          act('post', `/api/site/clients/${clientId}/invitations`, {
            email: ADDRESS.operator,
            role: 'owner',
          }),
      },
      {
        name: 'asks for a reset link for the customer’s password',
        run: () => act('post', `/api/site/accounts/${JEAN}/password-reset`),
      },
      {
        name: 'asks for a reset link for the account it invited',
        run: () => act('post', `/api/site/accounts/${accomplice}/password-reset`),
      },
      {
        name: 'switches the customer’s account off',
        run: () => act('post', `/api/site/accounts/${JEAN}/disable`),
      },
      {
        name: 'switches it back on',
        run: () => act('post', `/api/site/accounts/${JEAN}/enable`),
      },
      {
        name: 'deletes the account it invited',
        run: () => act('delete', `/api/site/accounts/${accomplice}`),
      },
      {
        name: 'ends the client’s engagement',
        run: () => act('post', `/api/site/clients/${clientId}/offboard`, { graceDays: 30 }),
      },
    ]

    const failed: string[] = []
    for (const mutation of mutations) {
      const response = await mutation.run()
      // Whatever the answer, a guard's refusal included, the events must have stayed the client's.
      if (response.status >= 500) failed.push(`${mutation.name}: ${response.status}`)
      expect(await differencesFromAStranger(scene), `after the operator ${mutation.name}`).toEqual(
        [],
      )
    }
    expect(failed).toEqual([])
  })

  it('does not make the operator a member of anything, whoever it invited or asked a link for', async () => {
    const scene = await aBoxToSweep()
    await scene.act('post', `/api/site/clients/${scene.clientId}/invitations`, {
      email: ADDRESS.operator,
      role: 'owner',
    })

    const accounts = await scene.operator.agent.get('/api/site/accounts?limit=200')

    const operator = accounts.body.items.find((row: { id: string }) => row.id === ID.operator)
    expect(operator.clients).toEqual([])
    expect(operator.ownedEventCount).toBe(0)
  })

  it('does not hand the operator a session for another account: the operator is still the operator after asking', async () => {
    const scene = await aBoxToSweep()
    await scene.act('post', `/api/site/accounts/${JEAN}/password-reset`)

    const me = await scene.operator.agent.get('/api/auth/me')

    expect(me.body.user).toMatchObject({ userId: ID.operator, email: ADDRESS.operator })
  })
})
