import { describe, expect, it } from 'vitest'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { CSRF_HEADER } from '../middleware/csrf'
import { captureAllOutputWhile } from './captureOutput'
import { CANARY, CANARY_VALUES } from './logCanary'
import { ID, aBox } from './siteBox'

/**
 * Ring 4. **Nothing an operator types or reads on `/api/site` reaches a log line** (docs/SECURITY.md
 * R-13, §22).
 *
 * `logCanary.test.ts` sweeps every route the server mounts, but it carries no session, so it stops
 * at the CSRF and authorization gates of the routes that matter most here: the ones that take an
 * address, a client's name and a reason in a body. A `console.log(req.body)` in any `/api/site`
 * handler, or a use case that logs what it was handed, would pass it. So this runs the operator's
 * namespace **as the operator**, with the canary values in the path, the query and every body,
 * against a real logger and an access log that is switched on, and reads every byte written.
 */

const INSTANCE_BINDINGS = {
  service: 'eventslide',
  version: 'sweep-test',
  instance: 'sweep-instance',
}

describe('the log canary, on the operator’s namespace', () => {
  it('writes none of what an operator types, in any body, query or path, into any log line', async () => {
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE_BINDINGS })
    const { site } = await aBox({
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE_BINDINGS } },
    })
    const operator = await site.signInAsOperator()
    const write = (method: 'post' | 'put' | 'patch', path: string, body: object) =>
      operator.agent[method](path).set(CSRF_HEADER, operator.csrf).send(body)

    const statuses: number[] = []
    const output = await captureAllOutputWhile(async () => {
      const opened = await write('post', '/api/site/clients', {
        clientName: CANARY.slug,
        ownerEmail: CANARY.email,
        ceilings: { maxEvents: 2 },
      })
      statuses.push(opened.status)
      const clientPath = `/api/site/clients/${opened.body.clientId as string}`
      statuses.push((await write('patch', clientPath, { name: CANARY.caption })).status)
      statuses.push(
        (
          await write('put', `${clientPath}/ceilings`, {
            ceilings: { maxEvents: 3 },
            reason: CANARY.caption,
          })
        ).status,
      )
      statuses.push(
        (
          await write('post', `${clientPath}/invitations`, {
            email: `second-${CANARY.email}`,
            role: 'member',
          })
        ).status,
      )
      statuses.push(
        (await write('post', `/api/site/accounts/${ID.member}/password-reset`, {})).status,
      )
      // The refusals too: a reason that is an address, and a body with the canaries as keys.
      statuses.push(
        (
          await write('put', `${clientPath}/ceilings`, {
            ceilings: { maxEvents: 4 },
            reason: CANARY.email,
          })
        ).status,
      )
      statuses.push(
        (await write('post', '/api/site/clients', { [CANARY.password]: CANARY.caption })).status,
      )
      for (const path of [
        `/api/site/clients?after=${CANARY.galleryToken}&limit=${CANARY.joinCode}`,
        `${clientPath}/events?after=${CANARY.slug}`,
        `/api/site/accounts?after=${CANARY.email}`,
        `/api/site/audit?clientId=${CANARY.slug}&before=${CANARY.joinCode}`,
        '/api/site/clients',
        '/api/site/accounts',
        '/api/site/audit',
      ]) {
        statuses.push((await operator.agent.get(path)).status)
      }
    })

    // The sweep reached the handlers, and a box that is silent has proved nothing.
    expect(statuses.filter((status) => status < 300).length).toBeGreaterThanOrEqual(8)
    expect(output.length).toBeGreaterThan(0)
    expect(output).toContain(INSTANCE_BINDINGS.instance)
    for (const value of CANARY_VALUES) {
      expect(output).not.toContain(value)
    }
  })
})
