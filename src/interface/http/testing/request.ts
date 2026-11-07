import { Agent, createServer, METHODS, type RequestListener, type Server } from 'node:http'
import supertest from 'supertest'
import { afterAll } from 'vitest'

/**
 * `supertest`, with one listening server per Express app instead of one per request.
 *
 * `supertest(app)` given an Express app (a function) binds a fresh ephemeral listener for every
 * request it sends and closes it afterwards. On Windows every closed socket then sits in
 * TIME_WAIT for two minutes, and a server project that sends tens of thousands of requests
 * exhausts the 16 384-port dynamic range: `listen EADDRINUSE 127.0.0.1:491xx` failed 1 032 tests
 * of one `vitest --coverage` run, and `siteRoutes.escalation` failed on any busy day. Linux CI
 * never noticed, which is why it only ever broke `npm run verify` on the maintainer's machine.
 *
 * Here the first request made against an app starts a server, every later one reuses it, and the
 * test file's `afterAll` closes them. Same API as `supertest` (`request(app)`, `request.agent(app)`,
 * the `Test` / `Response` types), so a test file changes only its import. A target that is not an
 * Express app (an already-listening server, a URL) goes through untouched.
 *
 * Servers close only at the end of the file, so a file that builds a new app in `beforeEach` keeps
 * one listener per test open until then: bounded by the file, not a leak across files.
 *
 * `supertestGuard.test.ts` fails on any test that imports `supertest` for its value instead.
 */

type Target = RequestListener | Server | string

/**
 * One client connection pool for every request of the file. Without it each request opens, and then
 * closes, a socket of its own, which is the other half of the TIME_WAIT pile-up.
 */
const pool = new Agent({ keepAlive: true })

const servers = new WeakMap<object, Server>()
const started = new Set<Server>()

afterAll(() => {
  pool.destroy()
  for (const server of started) {
    server.closeAllConnections()
    server.close()
  }
  started.clear()
})

const listeningOn = (target: Target): Target => {
  if (typeof target !== 'function') return target
  const known = servers.get(target)
  if (known !== undefined) return known

  const server = createServer(target)
  // The client keeps connections open, so the server must not hang up on an idle one first: that
  // race is an ECONNRESET on the request that happens to reuse it. `closeAllConnections()` ends them.
  server.keepAliveTimeout = 0
  // `listen(0)` with no host binds synchronously, so the port is known when `supertest` asks
  // for it; a host would resolve asynchronously and supertest would then try to listen again.
  server.listen(0)
  servers.set(target, server)
  started.add(server)
  return server
}

/** Every HTTP verb of `holder` sends its requests through `pool`. */
const pooled = <T extends object>(holder: T): T => {
  for (const verb of [...METHODS.map((method) => method.toLowerCase()), 'del']) {
    const send: unknown = Reflect.get(holder, verb)
    if (typeof send !== 'function') continue
    Reflect.set(holder, verb, (...args: unknown[]): unknown => {
      const sent: unknown = send.apply(holder, args)
      return sent instanceof supertest.Test ? sent.agent(pool) : sent
    })
  }
  return holder
}

type Options = Parameters<typeof supertest>[1]
type AgentTarget = Target
type AgentOptions = Parameters<typeof supertest.agent>[1]

const request = Object.assign(
  (target: Target, options?: Options) => {
    const sender = supertest(listeningOn(target), options)
    return typeof target === 'function' ? pooled(sender) : sender
  },
  {
    agent: (target?: AgentTarget, options?: AgentOptions) => {
      const sender = supertest.agent(target === undefined ? target : listeningOn(target), options)
      return typeof target === 'function' ? pooled(sender) : sender
    },
    Test: supertest.Test,
    cookies: supertest.cookies,
  },
)

/** The `request.Test`, `request.Response` and `request.Agent` types a test names. */
// eslint-disable-next-line @typescript-eslint/no-namespace -- only so the types of `supertest` stay reachable as `request.X`
declare namespace request {
  type Test = supertest.Test
  type Response = supertest.Response
  type Agent = supertest.Agent
}

export default request
