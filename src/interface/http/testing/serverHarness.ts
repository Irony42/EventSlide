import session from 'express-session'
import type { Store } from 'express-session'
import type { Express } from 'express'
import { buildServer } from '../server'
import { buildTestWorld, type TestWorld } from './middlewareHarness'
import type { HttpConfig } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The real `buildServer()`, driven with fakes.
 *
 * This exists because every other HTTP test builds its own `express()` app through
 * `middlewareHarness`, which means nothing exercised the one thing `server.ts` decides:
 * **middleware order**. Order is where HTTP security lives — CSRF in front of the
 * routers, health outside the CSRF gate, the API 404 before the SPA fallback, the error
 * handler last — and none of it is visible from a test that assembles its own app.
 *
 * `buildServer` never calls `listen()`, so this needs no open port.
 */

/**
 * A use case that a wiring test must not reach.
 *
 * Deliberately loud rather than permissive: the alternative is a bag of stubs that
 * answer `undefined`, under which a route quietly reading the wrong use case would pass.
 * A test that needs one passes it through `usecases`.
 */
const notWired = (name: string) => async (): Promise<never> => {
  throw new Error(
    `${name} was called by a server-wiring test. Those tests exercise middleware order; pass an implementation through the harness if the route under test needs one.`,
  )
}

/**
 * Every member of {@link HttpUseCases}, each throwing.
 *
 * Written out rather than generated, so adding a use case to the interface fails to
 * compile here and the author has to decide what a wiring test should see.
 */
export const notWiredUseCases = (): HttpUseCases => ({
  authenticateUser: notWired('authenticateUser'),
  changePassword: notWired('changePassword'),
  registerModerator: notWired('registerModerator'),

  createEvent: notWired('createEvent'),
  getEventBySlug: notWired('getEventBySlug'),
  listEventsForHost: notWired('listEventsForHost'),
  resolveJoinCode: notWired('resolveJoinCode'),
  updateEventSettings: notWired('updateEventSettings'),
  rotateJoinCode: notWired('rotateJoinCode'),
  changeEventStatus: notWired('changeEventStatus'),
  scheduleEvent: notWired('scheduleEvent'),
  purgeEvent: notWired('purgeEvent'),

  joinEvent: notWired('joinEvent'),
  authenticateGuest: notWired('authenticateGuest'),
  renameGuest: notWired('renameGuest'),
  revokeGuest: notWired('revokeGuest'),
  listGuests: notWired('listGuests'),

  uploadPhotos: notWired('uploadPhotos'),
  listEventPhotos: notWired('listEventPhotos'),
  listGuestPhotos: notWired('listGuestPhotos'),
  deletePhoto: notWired('deletePhoto'),
  setPhotoCaption: notWired('setPhotoCaption'),
  getPhotoMedia: notWired('getPhotoMedia'),
  exportAlbum: notWired('exportAlbum'),

  getModerationQueue: notWired('getModerationQueue'),
  moderatePhoto: notWired('moderatePhoto'),
  moderatePhotosBulk: notWired('moderatePhotosBulk'),

  getWallPlaylist: notWired('getWallPlaylist'),

  reactToPhoto: notWired('reactToPhoto'),
  withdrawReaction: notWired('withdrawReaction'),
  getPhotoReactions: notWired('getPhotoReactions'),
  getTopPhotos: notWired('getTopPhotos'),
})

export interface ServerHarness extends TestWorld {
  readonly app: Express
  /** What `/api/health` and `/api/ready` answer from. Mutable, so a test can break one. */
  readonly health: MutableHealthChecks
}

/**
 * The probe results as a test controls them.
 *
 * `now` reads the injected `FakeClock`, so `uptimeSeconds` is a function of
 * `clock.advance(...)` and never of the machine's clock.
 */
export interface MutableHealthChecks {
  version: string
  startedAt: Date
  now: () => Date
  databaseReady: () => Promise<boolean>
  mediaWritable: () => Promise<boolean>
}

export interface ServerHarnessOptions {
  readonly config?: Partial<HttpConfig>
  readonly usecases?: Partial<HttpUseCases>
  /** Where a built web app lives. Omitted means "API only", as in most tests. */
  readonly clientDir?: string
  /**
   * The session store `buildServer` is handed. Defaults to a real `MemoryStore`.
   *
   * Passing one that fails is how a test asserts what the probe ordering is *for*: a
   * liveness answer that still arrives when the store is unusable.
   */
  readonly sessionStore?: Store
}

/**
 * A session store whose every operation fails, as a corrupt or locked SQLite file does.
 *
 * `express-session` reads the store only when the request carries a session cookie, so a
 * test using this has to send one for the failure to be reachable at all.
 */
export const anUnusableSessionStore = (): Store => {
  const store = new session.MemoryStore()
  const fail = (...args: unknown[]): void => {
    const callback = args.at(-1)
    if (typeof callback === 'function') callback(new Error('SQLITE_CORRUPT: session store'))
  }
  return Object.assign(store, { get: fail, set: fail, touch: fail, destroy: fail })
}

export const buildServerHarness = ({
  config = {},
  usecases = {},
  clientDir,
  sessionStore = new session.MemoryStore(),
}: ServerHarnessOptions = {}): ServerHarness => {
  const world = buildTestWorld(config)
  const { deps } = world

  const health: MutableHealthChecks = {
    version: '2.0.0-test',
    startedAt: world.clock.now(),
    now: () => world.clock.now(),
    databaseReady: async () => true,
    mediaWritable: async () => true,
  }

  const app = buildServer({
    deps,
    usecases: { ...notWiredUseCases(), ...usecases },
    // A real `Store` implementation rather than a fake: session handling is part of
    // what the wiring under test arranges, and MemoryStore's production faults
    // (a leak, and every session lost on restart) cost nothing inside one test.
    sessionStore,
    health,
    presenter: { publicUrl: deps.config.publicUrl, uploadLimits: deps.config.uploads },
    ...(clientDir === undefined ? {} : { clientDir }),
  })

  return { app, health, ...world }
}
