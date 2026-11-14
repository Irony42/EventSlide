import { describe, expect, it, vi } from 'vitest'
import request from '../testing/request'
import { HeldExport } from '../testing/heldExport'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import { hostExportLimiter } from '../middleware/rateLimit'
import { highlightRoutes } from './highlightRoutes'
import { mediaRoutes } from './mediaRoutes'
import type { HttpUseCases } from '../useCases'
import { AT, anEvent } from '../../../application/testing/builders'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'

/**
 * Ring 4: how many host exports one account, and the box, may have open at once (SEC-04).
 *
 * `album.zip` and `best-of.zip` read the same photographs from the same disk, and the gallery's
 * archive, which does the same for a stranger with a link, has always been bounded. The two
 * routers are mounted here the way `server.ts` mounts them, around **one** limiter, because the
 * allowance being shared is half of what is asserted. The per-route wire contract of
 * `best-of.zip` (headers, `409 highlight.empty`) is in `moderationRoutes.test.ts`.
 */

const WEDDING = 'wedding-id'
const HOST = 'host-id'
const OTHER = 'other-id'

const unused = (): Promise<never> => Promise.reject(new Error('not part of an export'))

const world = (options: {
  readonly album: HeldExport
  readonly bestOf: () => ReturnType<HttpUseCases['exportHighlights']>
}) => {
  const limiter = hostExportLimiter()
  const harness = buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'hote@example.test' }))
      app.post('/sign-in/other', signInAs({ userId: OTHER, email: 'autre@example.test' }))
      app.use(
        mediaRoutes({
          deps,
          hostExportLimiter: limiter,
          usecases: {
            getPhotoMedia: unused,
            identifyMediaViewer: unused,
            getVenuePhotoMedia: unused,
            getEventLogoMedia: unused,
            exportAlbum: options.album.use,
          },
        }),
      )
      app.use(
        '/api',
        highlightRoutes({
          deps,
          hostExportLimiter: limiter,
          usecases: {
            setPhotoHighlight: unused,
            preselectHighlights: unused,
            getHighlights: unused,
            requestReel: unused,
            getReelMedia: unused,
            exportHighlights: options.bestOf,
          },
        }),
      )
    },
  })
  harness.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: HOST, joinCode: 'H7K2QM' }))
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(HOST), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(OTHER), role: 'moderator', grantedAt: AT },
  )
  return harness
}

type Harness = ReturnType<typeof world>

const signedIn = async (harness: Harness, who: 'host' | 'other') => {
  const agent = request.agent(harness.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}
type Agent = Awaited<ReturnType<typeof signedIn>>

const BEST_OF = '/api/events/mariage/best-of.zip'
const ALBUM = '/events/mariage/album.zip'

/** Starts an export and does not wait for it: what is held is the point. */
const start = (agent: Agent, path: string) => {
  const pending = agent.get(path).responseType('blob')
  const settled = pending.then(
    (response) => response.status,
    () => 0,
  )
  return { pending, settled }
}

const held = () => {
  const bestOf = new HeldExport()
  const album = new HeldExport()
  return { bestOf, album, harness: world({ album, bestOf: bestOf.use }) }
}

describe('GET /events/:eventSlug/best-of.zip: how many are open at once', () => {
  it('refuses a concurrent best-of export past the account ceiling', async () => {
    const { bestOf, harness } = held()
    const agent = await signedIn(harness, 'host')
    start(agent, BEST_OF)
    start(agent, BEST_OF)
    await vi.waitFor(() => expect(bestOf.opened).toBe(2))

    const third = await agent.get(BEST_OF)

    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('rate.limited')
    expect(third.headers['retry-after']).toBe('30')
    expect(bestOf.opened).toBe(2)
    bestOf.releaseAll()
  })

  it('does not refuse another account because of the first one exports', async () => {
    const { bestOf, harness } = held()
    const host = await signedIn(harness, 'host')
    const other = await signedIn(harness, 'other')
    start(host, BEST_OF)
    start(host, BEST_OF)
    await vi.waitFor(() => expect(bestOf.opened).toBe(2))
    expect((await host.get(BEST_OF)).status).toBe(429)

    start(other, BEST_OF)
    start(other, BEST_OF)

    await vi.waitFor(() => expect(bestOf.opened).toBe(4))
    bestOf.releaseAll()
  })

  it('gives the slot back when an export finishes', async () => {
    const { bestOf, harness } = held()
    const agent = await signedIn(harness, 'host')
    const first = start(agent, BEST_OF)
    const second = start(agent, BEST_OF)
    await vi.waitFor(() => expect(bestOf.opened).toBe(2))

    bestOf.holding = false
    bestOf.releaseAll()
    await Promise.all([first.settled, second.settled])

    expect((await agent.get(BEST_OF)).status).toBe(200)
  })

  it('gives the slot back when the client abandons an export', async () => {
    const { bestOf, harness } = held()
    const agent = await signedIn(harness, 'host')
    const first = start(agent, BEST_OF)
    start(agent, BEST_OF)
    await vi.waitFor(() => expect(bestOf.opened).toBe(2))
    expect((await agent.get(BEST_OF)).status).toBe(429)

    bestOf.holding = false
    first.pending.abort()

    await vi.waitFor(async () => expect((await agent.get(BEST_OF)).status).toBe(200))
    bestOf.releaseAll()
  })

  it('gives the slot back at once when the use case refuses before a byte is written', async () => {
    const harness = world({
      album: new HeldExport(),
      bestOf: () => Promise.resolve(err(DomainError.conflict('highlight.empty'))),
    })
    const agent = await signedIn(harness, 'host')

    // Past the ceiling of two: a refusal that kept its slot would turn the third into a 429.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await agent.get(BEST_OF)).status).toBe(409)
    }
  })
})

describe('the album and the best-of exports share one allowance', () => {
  it('counts an album and a best-of together against the same account', async () => {
    const { album, bestOf, harness } = held()
    const agent = await signedIn(harness, 'host')
    start(agent, ALBUM)
    start(agent, BEST_OF)
    await vi.waitFor(() => expect(album.opened + bestOf.opened).toBe(2))

    // Two open, one of each: a third of either kind is over the account ceiling.
    expect((await agent.get(ALBUM)).status).toBe(429)
    expect((await agent.get(BEST_OF)).status).toBe(429)
    album.releaseAll()
    bestOf.releaseAll()
  })

  it('counts them together against the box total too', async () => {
    const { album, bestOf, harness } = held()
    const host = await signedIn(harness, 'host')
    const other = await signedIn(harness, 'other')
    start(host, ALBUM)
    start(host, BEST_OF)
    start(other, ALBUM)
    start(other, BEST_OF)
    await vi.waitFor(() => expect(album.opened + bestOf.opened).toBe(4))

    // Four open across the two kinds is the box total: the box answers 503, before the account.
    const refused = await other.get(ALBUM)
    expect(refused.status).toBe(503)
    expect(refused.headers['retry-after']).toBe('30')
    album.releaseAll()
    bestOf.releaseAll()
  })
})

describe('HEAD on the two exports: the preflight a browser link asks before it downloads', () => {
  const PATHS = [ALBUM, BEST_OF] as const

  /** A world whose use cases count how often they are called: a preflight must call neither. */
  const counted = () => {
    const bestOf = new HeldExport()
    const album = new HeldExport()
    const calls = { album: 0, bestOf: 0 }
    const harness = world({
      album: {
        ...album,
        use: () => {
          calls.album += 1
          return album.use()
        },
      } as HeldExport,
      bestOf: () => {
        calls.bestOf += 1
        return bestOf.use()
      },
    })
    return { album, bestOf, calls, harness }
  }

  it.each(PATHS)('answers 204 with no body when the GET would start (%s)', async (path) => {
    const { harness } = counted()
    const agent = await signedIn(harness, 'host')

    const response = await agent.head(path)

    expect(response.status).toBe(204)
    expect(response.headers['content-type'] ?? '').not.toContain('zip')
  })

  it.each(PATHS)(
    'answers 429 exactly when the GET would, same code and Retry-After (%s)',
    async (path) => {
      const { album, bestOf, harness } = counted()
      const agent = await signedIn(harness, 'host')
      start(agent, ALBUM)
      start(agent, BEST_OF)
      await vi.waitFor(() => expect(album.opened + bestOf.opened).toBe(2))

      const preflight = await agent.head(path)
      const real = await agent.get(path)

      expect(preflight.status).toBe(429)
      expect(preflight.status).toBe(real.status)
      expect(preflight.headers['retry-after']).toBe(real.headers['retry-after'])
      album.releaseAll()
      bestOf.releaseAll()
    },
  )

  it.each(PATHS)(
    'answers 503 with Retry-After when the box is full, like the GET (%s)',
    async (path) => {
      const { album, bestOf, harness } = counted()
      const host = await signedIn(harness, 'host')
      const other = await signedIn(harness, 'other')
      start(host, ALBUM)
      start(host, BEST_OF)
      start(other, ALBUM)
      start(other, BEST_OF)
      await vi.waitFor(() => expect(album.opened + bestOf.opened).toBe(4))

      const preflight = await other.head(path)

      expect(preflight.status).toBe(503)
      expect(preflight.headers['retry-after']).toBe('30')
      album.releaseAll()
      bestOf.releaseAll()
    },
  )

  it.each(PATHS)(
    'holds no slot: many HEADs, then two GETs, all pass for one account (%s)',
    async (path) => {
      const { album, bestOf, harness } = counted()
      const agent = await signedIn(harness, 'host')

      for (let i = 0; i < 6; i += 1) expect((await agent.head(path)).status).toBe(204)
      start(agent, path)
      start(agent, path)

      await vi.waitFor(() => expect(album.opened + bestOf.opened).toBe(2))
      album.releaseAll()
      bestOf.releaseAll()
    },
  )

  it.each(PATHS)('runs no export use case (%s)', async (path) => {
    const { calls, harness } = counted()
    const agent = await signedIn(harness, 'host')

    await agent.head(path)

    expect(calls).toEqual({ album: 0, bestOf: 0 })
  })

  it.each(PATHS)('is refused to a signed-out caller like the GET (%s)', async (path) => {
    const { harness } = counted()
    harness.events.seed(
      anEvent({ id: 'gala-id', slug: 'gala', ownerId: 'someone', joinCode: 'B4N9PT' }),
    )

    expect((await request(harness.app).head(path)).status).toBe(401)
  })
})
