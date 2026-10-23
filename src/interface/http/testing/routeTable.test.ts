import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { mountedRoutes } from './routeTable'
import type * as RouteTable from './routeTable'

/**
 * The route-table reader's own plumbing. What it *finds* in the assembled server is held by
 * `siteOperatorScope.test.ts`, `siteAdminMode.test.ts` and `authz.test.ts`; this is what
 * has to be true for those to be reading anything at all.
 */

const answer: express.RequestHandler = (_req, res) => {
  res.end()
}

describe('routeTable, imported more than once in one process', () => {
  it('reads the same mounts through every instance of the module', async () => {
    // Express 5 keeps no mount path on a layer, so the module records them by wrapping
    // `Router.prototype.use` — a wrapper that lives as long as the process, while the module
    // can be evaluated again (`vi.resetModules()`, a runner that shares one process between
    // files). A second instance that found the wrapper in place and an empty record of its
    // own would answer every app "built before routeTable was imported", for no reason.
    const first = { mountedRoutes }
    vi.resetModules()
    const second = await vi.importActual<typeof RouteTable>('./routeTable')

    const app = express()
    const site = express.Router()
    site.get('/clients', answer)
    app.use('/api/site', site)

    const expected = [{ method: 'get', path: '/api/site/clients', mount: '/api/site' }]
    expect(first.mountedRoutes(app)).toEqual(expected)
    expect(second.mountedRoutes(app)).toEqual(expected)
  })
})
