import express, { type Express } from 'express'
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
 *
 * ## What changed with Express 5
 *
 * Express 4 kept the expression it compiled a mount point into (`layer.regexp`), and this
 * walk read the literal path back out of its source. Express 5 (`router` 2.x, with
 * `path-to-regexp` 8) keeps **no** path on a mounted layer at all, only closures —
 * `layer.matchers` — that answer "does this request path match" and cannot be asked what
 * they were built from. A route still carries its own path (`route.path`), so routes read
 * as before; a *mount* does not. So this module **records** the path every `router.use`
 * is handed, in a `WeakMap` keyed by the layer it built, by wrapping `use` on Express's
 * router prototype when it is imported. That is why it has to be imported before the app
 * it reads is built — a layer that was built earlier has no recorded path, and the walk
 * says so rather than guessing one. Every suite that reads a route table imports it at the
 * top, and apps are built inside tests, which is later.
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

/** A router mounted on the app, as a request meets it. */
export interface MountedRouter {
  /** The literal path it was mounted at, `''` for the root. */
  readonly mount: string
  /** What Express's own matcher says of a request path: whether the router is entered. */
  readonly matches: (path: string) => boolean
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

/**
 * Where the router prototype keeps what it has recorded, once wrapped. The record lives on
 * the prototype rather than in this module so that a second evaluation of the module in one
 * process — `vi.resetModules()`, a runner that does not isolate files — finds the wrapper
 * already installed **and** the paths it has collected, instead of wrapping nothing and
 * reading an empty record.
 */
const RECORDING = Symbol.for('eventslide.routeTable.recordsMountPaths')

/**
 * The path a `router.use(...)` call was handed, read exactly as the router reads it: the
 * first argument, unless that is a handler (or an array that starts with one), in which
 * case the layer is mounted at the root.
 */
const pathOfUse = (args: readonly unknown[]): unknown => {
  let first: unknown = args[0]
  if (typeof first === 'function') return '/'
  while (Array.isArray(first) && first.length !== 0) first = first[0] as unknown
  return typeof first === 'function' ? '/' : args[0]
}

/**
 * Wraps `use` on Express's router prototype so that every layer it builds remembers the
 * path it was built for, and returns what it has remembered, by layer. `app.use` goes
 * through the app's router's `use`, so this one hook sees the app's own mounts and every
 * nested router's.
 */
const recordMountPaths = (): WeakMap<object, unknown> => {
  const prototype = propertiesOf(propertiesOf(express.Router)?.['prototype'])
  const original = prototype?.['use']
  if (prototype === null || typeof original !== 'function') {
    throw new Error(
      'Express no longer exposes `Router.prototype.use`, which is how routeTable learns where ' +
        'a router is mounted; teach it the new shape',
    )
  }
  const installed: unknown = Reflect.get(prototype, RECORDING)
  if (installed instanceof WeakMap) return installed as WeakMap<object, unknown>

  const recorded = new WeakMap<object, unknown>()
  Object.defineProperty(prototype, 'use', {
    configurable: true,
    writable: true,
    value: function use(this: unknown, ...args: unknown[]): unknown {
      const stack = propertiesOf(this)?.['stack']
      const before = Array.isArray(stack) ? stack.length : 0
      const result: unknown = Reflect.apply(original, this, args)
      if (Array.isArray(stack)) {
        const path = pathOfUse(args)
        for (const layer of stack.slice(before) as unknown[]) {
          if (typeof layer === 'object' && layer !== null) recorded.set(layer, path)
        }
      }
      return result
    },
  })
  Object.defineProperty(prototype, RECORDING, { value: recorded })
  return recorded
}

/** The path each `router.use` was handed, by the layer it built. See the header. */
const pathsHandedToUse = recordMountPaths()

/** The path a mounted layer was built for, or a loud failure if it was built unrecorded. */
const pathOf = (layer: Record<string, unknown>): unknown => {
  if (!pathsHandedToUse.has(layer)) {
    throw new Error(
      'a mounted layer carries no recorded path: its router was built before routeTable was ' +
        'imported, so import it at the top of the file that builds the app',
    )
  }
  return pathsHandedToUse.get(layer)
}

/** The app's own layers, in the order a request meets them, or a loud failure. */
const appLayersOf = (app: Express): readonly Record<string, unknown>[] => {
  const router = propertiesOf((app as unknown as Record<string, unknown>)['router'])
  const stack = router?.['stack']
  if (!Array.isArray(stack)) throw new Error('the assembled app has no layer stack to read')
  return stack.flatMap((layer: unknown) => {
    const properties = propertiesOf(layer)
    return properties === null ? [] : [properties]
  })
}

/**
 * A mount point this walk can place: literal segments and nothing else, as every router
 * here is mounted. The root is `'/'`, which {@link mountPathOf} turns into `''`.
 */
const LITERAL_MOUNT = /^(?:\/[A-Za-z0-9_-]+)+$/

/** What a layer was built for, for a refusal to quote. */
const sourceOf = (layer: Record<string, unknown>): string => {
  const path = pathOf(layer)
  if (typeof path === 'string') return path
  return Array.isArray(path) ? JSON.stringify(path) : String(path)
}

/**
 * Where a router is mounted, read back out of the path it was mounted with.
 *
 * Anything that is not a plain literal mount — an array of paths, a regular expression, a
 * parameter, a wildcard or an optional group in the mount point — is a loud failure rather
 * than a guess: a route requested at the wrong prefix 404s for the wrong reason and passes.
 */
const mountPathOf = (layer: Record<string, unknown>): string => {
  const path = pathOf(layer)
  if (path === '/') return ''
  if (typeof path !== 'string' || !LITERAL_MOUNT.test(path)) {
    throw new Error(
      `this sweep cannot read the mount point ${sourceOf(layer)}; teach mountPathOf it`,
    )
  }
  return path
}

/**
 * The one shape of route path this walk can place: literal segments and `:name`
 * parameters, nothing else.
 *
 * A pattern matches more than it spells. On `path-to-regexp` 8, which Express 5 routes with,
 * `{…}` makes its content optional, so a route written `/s{1}ite/leak` answers `/site/leak`
 * and `/s1ite/leak`; `\` escapes, so `/sit\e/leak` answers `/site/leak`; `*name` is a
 * wildcard that takes any number of segments, `/{*splat}` takes none or any, and a `:name`
 * may sit inside an optional group. None of those spells the path it answers. A walk that
 * read the path as text would place each of them outside the operator's namespace; one that
 * tried to evaluate them would be a second implementation of `path-to-regexp`, wrong in the
 * cases nobody thought of. So it does neither, and it does not keep a list of the
 * characters that make a pattern either: what is accepted is the shape every route here is
 * written in, and anything else throws. An empty segment is part of that shape: `//site/x`
 * is a literal Express matches as written, and the namespace check is what places it.
 *
 * (Express 4's regular-expression characters — `(site)`, `sit?e`, `[s]ite`, `+` — no longer
 * reach this walk: `path-to-regexp` 8 refuses to compile them, so `router.get` throws when
 * the route is registered. `siteOperatorScope.test.ts` pins that, because the walk's
 * refusal of them is now the library's.)
 */
const LITERAL_ROUTE = /^(?:\/(?:[A-Za-z0-9._~-]*|:[A-Za-z][A-Za-z0-9]*))+$/

/** Whether a layer is mounted at the root of its router: `router.use(fn)`, with no path. */
const mountedAtRoot = (layer: Record<string, unknown>): boolean => pathOf(layer) === '/'

/**
 * The middleware that may be mounted **at a path** inside a router, by identity, each with
 * the reason it cannot answer a request itself.
 *
 * A route is something this walk can read; a middleware mounted at a path is not. It runs
 * for every request under that path, and nothing on its layer says whether it sets a header
 * and calls `next()` or answers the request outright: `router.use('/site/leak', h)` on a
 * router mounted at `/api` answers `GET /api/site/leak` with no route anywhere. So the walk
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
 * application function itself, recognisable the way Express itself recognises one — it has
 * both a `handle` and a `set`, which a router has only the first of. Either way its routes
 * answer under its own settings — case sensitivity, `strict routing` — which the walk does
 * not read, so it refuses the shape instead of guessing at it.
 */
const isSubApp = (layer: Record<string, unknown>): boolean => {
  const handle = propertiesOf(layer['handle'])
  return (
    layer['name'] === 'mounted_app' ||
    (typeof handle?.['handle'] === 'function' && typeof handle['set'] === 'function')
  )
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
 * The matchers Express built a layer's path into, each answering whether a request path
 * enters it. A layer mounted at the root has none that matter: Express short-circuits it.
 */
const matchersOf = (layer: Record<string, unknown>): readonly ((path: string) => unknown)[] => {
  const matchers = layer['matchers']
  if (!Array.isArray(matchers) || matchers.length === 0) {
    throw new Error('a mounted router carries no path matcher to ask')
  }
  return matchers.map((matcher: unknown) => {
    if (typeof matcher !== 'function') throw new Error('a mounted router carries a bad matcher')
    return (path: string): unknown => Reflect.apply(matcher, undefined, [path])
  })
}

/**
 * The routers mounted **behind the CSRF gate** that a request for `path` meets, in the
 * order it meets them.
 *
 * Behind the gate, because the probes' router is mounted ahead of the whole session stack
 * on purpose and answers `/health` and `/ready` only; every router that serves the API
 * proper comes after `requireCsrfToken`.
 *
 * Whether a router "meets" a path is Express's own answer, asked of the matcher it built
 * from the mount point — not this module's reading of the mount's spelling.
 */
export const routersMeeting = (app: Express, path: string): readonly MountedRouter[] => {
  const layers = appLayersOf(app)
  const gate = layers.findIndex((layer) => layer['handle'] === requireCsrfToken)
  if (gate === -1) throw new Error('the CSRF gate is not mounted on the assembled app')

  const found: MountedRouter[] = []
  for (const layer of layers.slice(gate + 1)) {
    if (layer['name'] !== 'router') continue
    const matchers = matchersOf(layer)
    const matches = (candidate: string): boolean =>
      layer['slash'] === true || matchers.some((matcher) => matcher(candidate) !== false)
    if (matches(path)) found.push({ mount: mountPathOf(layer), matches })
  }
  return found
}
