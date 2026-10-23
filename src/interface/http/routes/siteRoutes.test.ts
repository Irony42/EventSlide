import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { STEP_UP_LIFETIME_MS } from '../../../domain/users/secondFactor'
import { asUserId } from '../../../domain/shared/ids'
import { CSRF_HEADER } from '../middleware/csrf'
import { anonymousCaller, type Caller } from '../testing/signIn'
import { mountedRoutes } from '../testing/routeTable'
import { ADDRESS, ID, NEWCOMER, aBox } from '../testing/siteBox'

/**
 * Ring 4. The operator's namespace through the assembled server (`buildServer`, the real
 * middleware order and a real session store) over real SQLite storage (`siteHarness.ts`): the
 * authorization every route carries, and then what each one does.
 *
 * Every route is held to the same answers, from one table that a case holds equal to the route
 * table, so a route added to `siteRoutes.ts` is a red test until somebody adds it here (and
 * `siteOperatorScope.test.ts` fails until it is listed there): a stranger is `401`, an ordinary account `403`, an operator who
 * has not passed the second factor `403` where the box asks for one, an operator whose step-up
 * lapsed `403` on a write, and an operator who has all of it is answered.
 */

type Method = 'get' | 'post' | 'put' | 'patch'

interface SiteRoute {
  readonly method: Method
  readonly path: string
  /** A valid body, for the routes that take one. */
  readonly body?: object
  /** What an entitled operator is answered. */
  readonly success: number
  /** Whether it changes anything, and so asks for a step-up. */
  readonly write: boolean
}

const ROUTES: readonly SiteRoute[] = [
  { method: 'get', path: '/api/site/client-defaults', success: 200, write: false },
  { method: 'get', path: '/api/site/clients', success: 200, write: false },
  { method: 'get', path: `/api/site/clients/${ID.clientK}/events`, success: 200, write: false },
  { method: 'get', path: '/api/site/accounts', success: 200, write: false },
  { method: 'get', path: '/api/site/audit', success: 200, write: false },
  {
    method: 'post',
    path: '/api/site/clients',
    body: { clientName: 'Nouveau client', ownerEmail: NEWCOMER },
    success: 201,
    write: true,
  },
  {
    method: 'patch',
    path: `/api/site/clients/${ID.clientEmpty}`,
    body: { name: 'Client renommé' },
    success: 204,
    write: true,
  },
  {
    method: 'put',
    path: `/api/site/clients/${ID.clientK}/ceilings`,
    body: { ceilings: { maxEvents: 5 }, reason: 'Forfait mis à jour' },
    success: 200,
    write: true,
  },
  {
    method: 'post',
    path: `/api/site/clients/${ID.clientEmpty}/suspend`,
    success: 204,
    write: true,
  },
  {
    method: 'post',
    path: `/api/site/clients/${ID.clientEmpty}/resume`,
    success: 204,
    write: true,
  },
  {
    method: 'post',
    path: `/api/site/clients/${ID.clientEmpty}/invitations`,
    body: { email: NEWCOMER, role: 'owner' },
    success: 201,
    write: true,
  },
  {
    method: 'post',
    path: `/api/site/accounts/${ID.owner}/password-reset`,
    body: {},
    success: 200,
    write: true,
  },
]

const send = (caller: Caller, route: SiteRoute): request.Test => {
  const body = route.body ?? {}
  switch (route.method) {
    case 'get':
      return caller.agent.get(route.path)
    case 'post':
      return caller.agent.post(route.path).set(CSRF_HEADER, caller.csrf).send(body)
    case 'put':
      return caller.agent.put(route.path).set(CSRF_HEADER, caller.csrf).send(body)
    case 'patch':
      return caller.agent.patch(route.path).set(CSRF_HEADER, caller.csrf).send(body)
  }
}

const codeOf = (response: request.Response): string | undefined =>
  (response.body as { error?: { code?: string } }).error?.code

const named = (route: SiteRoute): string => `${route.method} ${route.path}`

const FIVE_MINUTES_AND_A_MILLISECOND = STEP_UP_LIFETIME_MS + 1

describe('the table below is the route table', () => {
  it('names every route the namespace mounts, and no other, so a route added without a row here is a red test', async () => {
    const { site } = await aBox()

    const mounted = mountedRoutes(site.app)
      .filter((route) => route.path.startsWith('/api/site/'))
      .map((route) => `${route.method} ${route.path}`)
      .sort()
    const listed = ROUTES.map((route) => {
      // `ID.clientK` and the other ids stand for `:clientId` and `:userId` in a path.
      const pattern = route.path
        .replace(/\/clients\/[0-9a-f-]{36}/, '/clients/:clientId')
        .replace(/\/accounts\/[0-9a-f-]{36}/, '/accounts/:userId')
        .replace(/\?.*$/, '')
      return `${route.method} ${pattern}`
    }).sort()

    expect(listed).toEqual(mounted)
  })

  it('marks every route that is not a GET as a write, which is what asks for a step-up', () => {
    expect(ROUTES.filter((route) => route.method !== 'get' && !route.write)).toEqual([])
    expect(ROUTES.filter((route) => route.method === 'get' && route.write)).toEqual([])
  })
})

describe('the operator’s routes: who may call them', () => {
  describe.each(ROUTES.map((route) => [named(route), route] as const))('%s', (_name, route) => {
    it('is not mounted with SITE_ADMIN=off: the same 404 as a path nobody wrote', async () => {
      const { site } = await aBox({ siteAdmin: false })
      const caller = await site.signInAsOperator()

      const response = await send(caller, route)

      expect(response.status).toBe(404)
      expect(codeOf(response)).toBe('route.notFound')
    })

    it('answers 401 to a caller who is not signed in', async () => {
      const { site } = await aBox()
      const stranger = await anonymousCaller(site.app)

      const response = await send(stranger, route)

      expect(response.status).toBe(401)
      expect(codeOf(response)).toBe('auth.required')
    })

    it('answers 403 auth.forbidden to a signed-in account that does not operate the box, owner of a client or not', async () => {
      const { site } = await aBox()

      for (const address of [ADDRESS.owner, ADDRESS.member, ADDRESS.stranger]) {
        const caller = await site.signIn(address)
        const response = await send(caller, route)

        expect(response.status, address).toBe(403)
        expect(response.body.error, address).toMatchObject({
          code: 'auth.forbidden',
          details: { required: 'operator' },
        })
      }
    })

    it('answers 403 auth.forbidden to an operator whose account has been switched off', async () => {
      const { site } = await aBox()
      const caller = await site.signInAsOperator()
      const operator = await site.repos.users.findById(asUserId(ID.operator))
      if (operator === null) throw new Error('fixture rejected')
      await site.repos.users.save(operator.disable(site.clock.now()))

      const response = await send(caller, route)

      expect(response.status).toBe(403)
      expect(codeOf(response)).toBe('auth.forbidden')
    })

    it('answers 403 auth.secondFactorRequired to an operator who has not passed the factor, where the box asks for one', async () => {
      const { site } = await aBox({ secondFactorRequired: true })
      const caller = await site.signIn(ADDRESS.operator)
      // A step-up alone is not the factor: the stamp the gate reads is another one.
      await site.stamp(ID.operator, { stepUpAt: site.clock.now().getTime() })

      const response = await send(caller, route)

      expect(response.status).toBe(403)
      expect(codeOf(response)).toBe('auth.secondFactorRequired')
    })

    it('answers an operator who has passed the factor and confirmed a step-up', async () => {
      const { site } = await aBox({ secondFactorRequired: true })
      const caller = await site.signInAsOperator()

      const response = await send(caller, route)

      expect(response.status, JSON.stringify(response.body)).toBe(route.success)
    })

    if (route.write) {
      it('answers 403 auth.stepUpRequired to an operator who never confirmed, without reading the body', async () => {
        const { site } = await aBox()
        const caller = await site.signIn(ADDRESS.operator)

        // A body this route would refuse as a 400 if it were read: the step-up is asked first.
        const response = await send(caller, { ...route, body: { nothing: 'to see' } })

        expect(response.status).toBe(403)
        expect(codeOf(response)).toBe('auth.stepUpRequired')
      })

      it('answers 403 auth.stepUpRequired once the confirmation is more than five minutes old', async () => {
        const { site } = await aBox()
        const caller = await site.signIn(ADDRESS.operator)
        await site.stamp(ID.operator, {
          stepUpAt: site.clock.now().getTime() - FIVE_MINUTES_AND_A_MILLISECOND,
        })

        const response = await send(caller, route)

        expect(response.status).toBe(403)
        expect(codeOf(response)).toBe('auth.stepUpRequired')
      })

      it('still answers an operator whose confirmation is exactly five minutes old', async () => {
        const { site } = await aBox()
        const caller = await site.signIn(ADDRESS.operator)
        await site.stamp(ID.operator, {
          stepUpAt: site.clock.now().getTime() - STEP_UP_LIFETIME_MS,
        })

        const response = await send(caller, route)

        expect(response.status, JSON.stringify(response.body)).toBe(route.success)
      })
    } else {
      it('asks for no step-up: a read changes nothing and is answered without one', async () => {
        const { site } = await aBox()
        const caller = await site.signIn(ADDRESS.operator)

        const response = await send(caller, route)

        expect(response.status).toBe(route.success)
      })
    }
  })
})
