import type { Express } from 'express'
import { requireCsrfToken } from '../middleware/csrf'
import { galleryHeaders } from '../routes/galleryRoutes'

/**
 * The route table of an assembled app, read off Express's own layer stack.
 *
 * Two suites reason about where a request lands, and both used to carry a walker of their
 * own: `siteOperatorScope.test.ts`, which sweeps every route the server mounts, and
 * `siteAdminMode.test.ts`, which checks the order the routers meet a request in. Two
 * readings of one internal shape are two chances to read it differently, so there is one.
 *
 * Narrowed from `unknown` at every step rather than cast: the stack is Express's internal
 * shape, and a version that changed it should fail loudly instead of silently enumerating
 * nothing — which would leave every assertion built on it vacuously true.
 */

export interface Route {
  readonly method: string
  readonly path: string
  /**
   * Where the router that carries this route is mounted **on the app** — the outermost one,
   * however deeply the route is nested inside it. That is the router a request enters
   * first, and therefore the one whose gate it meets.
   */
  readonly mount: string
}

/**
 * The properties of anything that has them, or `null`.
 *
 * Express's stack holds both plain layer objects and routers, and a router **is a
 * function** carrying a `stack` — so a `typeof === 'object'` guard walks past every
 * mounted router and finds nothing at all.
 */
const propertiesOf = (value: unknown): Record<string, unknown> | null =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? (value as Record<string, unknown>)
    : null

/** The app's own layers, in the order a request meets them, or a loud failure. */
const appLayersOf = (app: Express): readonly Record<string, unknown>[] => {
  const router = propertiesOf((app as unknown as Record<string, unknown>)['_router'])
  const stack = router?.['stack']
  if (!Array.isArray(stack)) throw new Error('the assembled app has no layer stack to read')
  return stack.flatMap((layer: unknown) => {
    const properties = propertiesOf(layer)
    return properties === null ? [] : [properties]
  })
}

/**
 * What Express 4 compiles `app.use('/api/site', …)` into — `^\/api\/site\/?(?=\/|$)` —
 * with the literal path captured. A router mounted at the root compiles to the same shape
 * with nothing captured.
 */
const LITERAL_MOUNT = /^\^((?:\\\/[A-Za-z0-9_-]+)*)\\\/\?\(\?=\\\/\|\$\)$/

/**
 * Where a router is mounted, read back out of the layer Express built for it.
 *
 * Express 4 keeps no mount path on a layer, only the expression it compiled from one, so
 * this is the one place the walk has to read a regular expression's source. Anything that
 * is not a plain literal mount — an array of paths, a parameter in the mount point — is a
 * loud failure rather than a guess: a route requested at the wrong prefix 404s for the
 * wrong reason and passes.
 */
const mountPathOf = (layer: Record<string, unknown>): string => {
  const expression = layer['regexp']
  if (!(expression instanceof RegExp))
    throw new Error('a mounted router carries no path expression')
  const literal = LITERAL_MOUNT.exec(expression.source)
  if (literal === null) {
    throw new Error(
      `this sweep cannot read the mount point ${expression.source}; teach mountPathOf it`,
    )
  }
  return (literal[1] ?? '').replaceAll('\\/', '/')
}

/**
 * The one shape of route path this walk can place: literal segments and `:name`
 * parameters, nothing else.
 *
 * A pattern matches more than it spells. On express 4.22.3, a route written `/(site)/leak`,
 * `/sit?e/leak`, `/[s]ite/leak`, `/s{1}ite/leak` or `/sit\e/leak` on a router mounted at
 * `/api` answers `GET /api//site/leak` with whatever it serves, and not one of those
 * spellings starts with `/site`. A walk that reads the path as text would place each of
 * them outside the operator's namespace; one that tried to evaluate them would be a second
 * implementation of `path-to-regexp`, wrong in the cases nobody thought of. So it does
 * neither, and it does not keep a list of the characters that make a pattern either: it
 * used to, and `{n}` and `\` walked past it, because `path-to-regexp` 0.1 hands every
 * character it does not rewrite to the RegExp raw. What is accepted is the shape every
 * route here is written in; anything else throws. An empty segment is part of that shape:
 * `//site/x` is a literal Express matches as written, and the namespace check is what
 * places it.
 */
const LITERAL_ROUTE = /^(?:\/(?:[A-Za-z0-9._~-]*|:[A-Za-z][A-Za-z0-9]*))+$/

/** Whether a layer is mounted at the root of its router: `router.use(fn)`, with no path. */
const mountedAtRoot = (layer: Record<string, unknown>): boolean => {
  const expression = layer['regexp']
  return expression instanceof RegExp && LITERAL_MOUNT.exec(expression.source)?.[1] === ''
}

/**
 * The middleware that may be mounted **at a path** inside a router, by identity, each with
 * the reason it cannot answer a request itself.
 *
 * A route is something this walk can read; a middleware mounted at a path is not. It runs
 * for every request under that path, and nothing on its layer says whether it sets a header
 * and calls `next()` or answers the request outright: `router.use('/site/leak', h)` on a
 * router mounted at `/api` answers `GET /api//site/leak` with no route anywhere. So the walk
 * throws on one unless it is named here. A middleware at the **root** of a router —
 * `router.use(fn)`, which is how `siteRoutes` mounts `requireOperator` — is not what this
 * list is about: it has no path of its own to reach a namespace by.
 */
const PATH_MOUNTED_MIDDLEWARE: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  [
    galleryHeaders,
    '`galleryRoutes` mounts it at `/gallery` and `/gallery-media` to set the shared ' +
      'gallery’s no-referrer, noindex and no-store headers on everything under them; it ' +
      'answers nothing and always calls `next()`',
  ],
])

/**
 * Whether a layer is another Express **application** rather than a router.
 *
 * `app.use(path, subApp)` wraps the sub-app in a function Express names `mounted_app`, whose
 * routes sit behind a closure no walk can open; handed to `router.use` instead, it is the
 * application function itself, recognisable by an application's own `lazyrouter`. Either
 * way its routes answer under its own settings — case sensitivity, `strict routing` — which
 * the walk does not read, so it refuses the shape instead of guessing at it.
 */
const isSubApp = (layer: Record<string, unknown>): boolean =>
  layer['name'] === 'mounted_app' ||
  typeof propertiesOf(layer['handle'])?.['lazyrouter'] === 'function'

/** What a layer's path expression says, for a refusal to quote. */
const sourceOf = (layer: Record<string, unknown>): string => {
  const expression = layer['regexp']
  return expression instanceof RegExp ? expression.source : String(expression)
}

/**
 * The routes the assembled app actually serves, each with the router mount it sits on.
 *
 * **It refuses to guess.** A shape it cannot place as written throws instead of being
 * skipped or read as text: a route path that is a regular expression, an array or a string
 * carrying a pattern character; a middleware mounted at a path inside a router, unless
 * {@link PATH_MOUNTED_MIDDLEWARE} names it; and a sub-app, wherever it is mounted. Every
 * sweep built on this walk would otherwise lose what that shape serves — or worse, file it
 * under a namespace it does not answer — without a word.
 */
export const mountedRoutes = (app: Express): readonly Route[] => {
  const found: Route[] = []

  /** `mount` is `undefined` on the app's own stack, and fixed by the first router below it. */
  const walk = (stack: unknown, prefix: string, mount: string | undefined): void => {
    if (!Array.isArray(stack)) return
    for (const layer of stack) {
      const properties = propertiesOf(layer)
      if (properties === null) continue

      const route = propertiesOf(properties['route'])
      if (route !== null) {
        // A path that is a regular expression, an array or a pattern is a route this walk
        // cannot place, and skipping it would take it out of every sweep built on this walk
        // — the operator's namespace check included — without a word.
        const path = route['path']
        if (typeof path !== 'string') {
          throw new Error(
            `this sweep cannot read the route path ${String(path)}; teach mountedRoutes it`,
          )
        }
        if (!LITERAL_ROUTE.test(path)) {
          throw new Error(
            `this sweep refuses to guess what the route path ${path} matches: write it as a ` +
              'literal path with :parameters, or teach mountedRoutes to place it',
          )
        }
        const methods = propertiesOf(route['methods'])
        if (methods === null) continue
        for (const [method, enabled] of Object.entries(methods)) {
          if (enabled === true) {
            found.push({ method, path: `${prefix}${path}`, mount: mount ?? prefix })
          }
        }
        continue
      }

      // A mounted router, walked under **its own** mount point. This used to append `/api`
      // to every router on the grounds that `server.ts` mounted nothing anywhere else —
      // true until `SITE_ADMIN=on` mounted the operator's namespace at `/api/site`, where a
      // route written `/clients` would have been requested at `/api/clients`, answered
      // `route.notFound`, and counted as a refusal while nothing was exercised.
      if (isSubApp(properties)) {
        throw new Error(
          `this sweep refuses to guess what a sub-app mounted at ${sourceOf(properties)} ` +
            `under "${prefix}" serves: mount a Router instead, or teach mountedRoutes to read it`,
        )
      }

      const handle = propertiesOf(properties['handle'])
      if (properties['name'] === 'router' && handle !== null) {
        const at = `${prefix}${mountPathOf(properties)}`
        walk(handle['stack'], at, mount ?? at)
        continue
      }

      // Anything else is middleware. On the app's own stack it is the server's plumbing —
      // the body parser, the CSRF gate, `apiNotFound` — and it is `server.ts`'s to answer
      // for. Inside a router and mounted at a path, it is a handler that can answer a request
      // without any route this walk would see.
      if (
        mount !== undefined &&
        !mountedAtRoot(properties) &&
        !PATH_MOUNTED_MIDDLEWARE.has(properties['handle'])
      ) {
        throw new Error(
          `this sweep refuses to guess what the middleware "${String(properties['name'])}" ` +
            `mounted at ${sourceOf(properties)} inside the router at "${prefix}" answers: ` +
            'declare a route instead, or name it in PATH_MOUNTED_MIDDLEWARE with the reason ' +
            'it answers nothing',
        )
      }
    }
  }

  walk(appLayersOf(app), '', undefined)
  return found
}

/**
 * The routers mounted **behind the CSRF gate** that a request for `path` meets, in the
 * order it meets them, as the expressions Express compiled their mount points into.
 *
 * Behind the gate, because the probes' router is mounted ahead of the whole session stack
 * on purpose and answers `/health` and `/ready` only; every router that serves the API
 * proper comes after `requireCsrfToken`.
 */
export const routersMeeting = (app: Express, path: string): RegExp[] => {
  const layers = appLayersOf(app)
  const gate = layers.findIndex((layer) => layer['handle'] === requireCsrfToken)
  if (gate === -1) throw new Error('the CSRF gate is not mounted on the assembled app')

  const found: RegExp[] = []
  for (const layer of layers.slice(gate + 1)) {
    const regexp = layer['regexp']
    if (layer['name'] === 'router' && regexp instanceof RegExp && regexp.test(path)) {
      found.push(regexp)
    }
  }
  return found
}
