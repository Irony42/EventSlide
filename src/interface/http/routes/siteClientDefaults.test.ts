import { describe, expect, it } from 'vitest'
import { aUser } from '../../../application/testing/builders'
import type { NewClientDefaults } from '../../../domain/clients/newClientCeilings'
import { CSRF_HEADER } from '../middleware/csrf'
import { TEST_SESSION_SECRET } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import { buildServerHarness } from '../testing/serverHarness'
import {
  A_PATH_NOBODY_WROTE,
  anonymousCaller,
  signedInAs,
  signInByAddress,
} from '../testing/signIn'

/**
 * `GET /api/site/client-defaults` (free plan G2-18), at ring 4: the ceilings a new client
 * starts with, as the operator's console reads them to pre-fill its provisioning form.
 *
 * The route is configuration and nothing else, so what is proved here is the three things a
 * route like that can get wrong: **who may read it** (the operator, through the namespace's
 * own gate, and nobody on a box with the switch off), **what it says** (the configured
 * numbers, exactly, and unlimited on a box that set none), and **what it must not say**
 * (nothing but the seven ceilings: it is the one route in the namespace that reads no
 * storage, and so the one that could most easily end up carrying a neighbour's field).
 */

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const HOST = '22222222-2222-4222-8222-222222222222'
const ACCOUNTS: Readonly<Record<string, string>> = {
  'ops@example.test': OPERATOR,
  'hote@example.test': HOST,
}

const PATH = '/api/site/client-defaults'

const UNLIMITED: NewClientDefaults = {
  maxEvents: null,
  maxEventsPerPeriod: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  maxLiveDays: null,
  clipsAllowed: true,
  booksAllowed: true,
}

const A_TIER: NewClientDefaults = {
  maxEvents: 1,
  maxEventsPerPeriod: 6,
  maxTotalBytes: 20_000_000_000,
  maxEventQuotaBytes: 5_000_000_000,
  maxRetentionDays: 30,
  maxLiveDays: 3,
  clipsAllowed: false,
  booksAllowed: false,
}

const harness = (config: Partial<HttpConfig> = {}) => {
  const subject = buildServerHarness({
    config: { siteAdmin: true, ...config },
    usecases: { authenticateUser: signInByAddress(ACCOUNTS) },
  })
  subject.users.seed(
    aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator' }),
    aUser({ id: HOST, email: 'hote@example.test' }),
  )
  return subject
}

describe('GET /api/site/client-defaults', () => {
  it('answers the operator with the ceilings the box was configured to give a new client', async () => {
    const subject = harness({ newClientCeilings: A_TIER })
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ceilings: A_TIER })
  })

  it('answers no ceiling at all on a box that set none, which is every self-hosted box', async () => {
    const subject = harness({ newClientCeilings: UNLIMITED })
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ceilings: UNLIMITED })
  })

  it('says exactly the seven ceilings NEW_CLIENT_* can set, and nothing the box knows besides', async () => {
    const subject = harness({ newClientCeilings: A_TIER })
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(Object.keys(response.body as object)).toEqual(['ceilings'])
    expect(Object.keys((response.body as { ceilings: object }).ceilings).sort()).toEqual(
      [
        'booksAllowed',
        'clipsAllowed',
        'maxEvents',
        'maxEventsPerPeriod',
        'maxEventQuotaBytes',
        'maxLiveDays',
        'maxRetentionDays',
        'maxTotalBytes',
      ].sort(),
    )
    // The session secret is in the same `config` object the route reads from.
    expect(response.text).not.toContain(TEST_SESSION_SECRET)
  })

  it('is not cacheable, since it describes the instance’s policy to whoever is signed in', async () => {
    const operator = await signedInAs(harness().app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('refuses an operator who must still change a provisional password, as the whole API does', async () => {
    const subject = harness({ newClientCeilings: A_TIER })
    subject.users.seed(
      aUser({
        id: OPERATOR,
        email: 'ops@example.test',
        siteRole: 'operator',
        mustChangePassword: true,
      }),
    )
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({ code: 'auth.passwordChangeRequired' })
    expect(response.text).not.toContain('maxEvents')
  })

  it('refuses a request with no session, with 401', async () => {
    const caller = await anonymousCaller(harness({ newClientCeilings: A_TIER }).app)

    const response = await caller.agent.get(PATH)

    expect(response.status).toBe(401)
    expect(response.text).not.toContain('maxEvents')
  })

  it('refuses a signed-in account that does not operate the box, with the namespace’s 403', async () => {
    const host = await signedInAs(harness({ newClientCeilings: A_TIER }).app, 'hote@example.test')

    const response = await host.agent.get(PATH)

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({
      code: 'auth.forbidden',
      details: { required: 'operator' },
    })
    expect(response.text).not.toContain('maxEvents')
  })

  it('refuses an operator who has not passed the second factor on a box that requires one', async () => {
    const subject = harness({
      newClientCeilings: A_TIER,
      secondFactor: { available: true, requiredForOperators: true },
    })
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const response = await operator.agent.get(PATH)

    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({ code: 'auth.secondFactorRequired' })
    expect(response.text).not.toContain('maxEvents')
  })

  it('does not exist on a box with SITE_ADMIN=off: the same answer as a path nobody wrote', async () => {
    const subject = harness({ siteAdmin: false, newClientCeilings: A_TIER })
    const operator = await signedInAs(subject.app, 'ops@example.test')

    const reference = await operator.agent.get(A_PATH_NOBODY_WROTE)
    const response = await operator.agent.get(PATH)

    expect(response.status).toBe(404)
    expect(response.body).toEqual(reference.body)
    expect(response.text).not.toContain('maxEvents')
  })

  it('is read only: no other method is answered', async () => {
    const operator = await signedInAs(harness().app, 'ops@example.test')

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await operator.agent[method](PATH).set(CSRF_HEADER, operator.csrf)

      expect(response.status, method).toBe(404)
    }
  })
})
