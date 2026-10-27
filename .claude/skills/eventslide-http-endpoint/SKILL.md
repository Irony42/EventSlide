---
name: eventslide-http-endpoint
description: Recipe for adding an HTTP endpoint end to end in src/interface/http — zod schema, controller, authorization, error mapping, presenter, route registration, supertest contract test, and docs/API.md update. Use when adding or changing any API route, including uploads, SSE streams, and media delivery.
---

# Adding an HTTP endpoint

The HTTP layer does exactly four things: **parse**, **authorize**, **call one use
case**, **present**. Any `if` that expresses a business rule belongs in
`src/application` or `src/domain`.

`src/interface/http/server.ts` exports `buildServer(deps)` and never calls `listen()`.
That is what makes every route testable with supertest and zero open ports.

## 1. Schema — parse at the boundary

Every schema lives in `src/interface/http/schemas/requestSchemas.ts` (the operator's in
`siteSchemas.ts`, the client space's in `clientSchemas.ts`). The one a decision on a photo
takes:

```ts
// src/interface/http/schemas/requestSchemas.ts
const moderationDecision = z.enum(MODERATION_DECISIONS) // from the domain, not retyped

export const photoParams = z.object({ eventSlug: slug, photoId: uuid })

export const moderationDecisionBody = z.strictObject({
  decision: moderationDecision,
})

export const photoListQuery = z.strictObject({
  status: photoStatusFilter.default('all'),
  limit: pageLimit, // z.coerce.number().int().min(1).max(200).default(60)
  cursor: z.string().max(512).optional(),
})
```

- Every route parses `params`, `query`, and `body` it reads. Anything unparsed is
  untrusted input reaching a use case. A route with no parameter at all still parses the
  empty schema, so that sending one is a `400`.
- `z.strictObject` for every body and query, so an extra key is a `400` and not a field the sender
  believes took effect; a params schema is a plain `z.object`, because the route pattern owns its keys.
  (zod 4 keeps `.strict()` only as a legacy method.)
- A vocabulary the domain owns (reaction kinds, moderation decisions, photo and event
  statuses, served variants) is `z.enum(<DOMAIN_CONSTANT>)`, never a retyped literal array:
  a value the domain gains is then accepted at the boundary or a test says so.
- `z.guid()` for an id, not `z.uuid()`: zod 4's `z.uuid()` demands an RFC 9562 version, which would
  narrow what the API accepts (see the `uuid` constant in `requestSchemas.ts`).
- `z.coerce` for query numbers — they arrive as strings.
- A bound two schemas share (an e-mail, a page size) is one constant at the top of the file.
- Schemas define **shape**, never business rules. "The event must not be archived" is
  a domain rule, not `z.refine`.

## 2. Controller — thin, and it is allowed to be boring

```ts
// src/interface/http/routes/moderationRoutes.ts
export const moderationRoutes = ({ deps, usecases }: RouteDeps): Router => {
  const router = Router()

  router.patch(
    '/events/:eventSlug/photos/:photoId/status',
    requireRole('moderator', deps),
    withModerator(async ({ eventId, actor }, req, res) => {
      const params = photoParams.parse(req.params)
      const body = moderationDecisionBody.parse(req.body)

      const result = await usecases.moderatePhoto({
        eventId,
        photoId: asPhotoId(params.photoId),
        decision: body.decision, // the host's verb (`publish`), never the resulting state
        actor,
      })

      sendResultNoContent(res, result)
    }),
  )

  return router
}
```

- A route module takes `RouteDeps` (`deps`, `usecases`, `presenter`, from `useCases.ts`)
  and returns a `Router`; the use cases are the ones `src/main/usecases.ts` built, so a
  test hands the route a stub for any of them.
- `requireRole` resolves the event from `:eventSlug` and the caller's role in it
  **before** the body is read, and parks both on `req.context`. A handler never repeats
  the lookup and never reads `req.context.event` itself: `withModerator`, `withGuest` and
  `withPublicEvent` hand it the narrowed scope (`withModerator`: `{ eventId, slug, actor }`;
  `withGuest`: `{ event, guest }`; `withPublicEvent`: the `Event`), and `hostScopeOf(req)` / `userOf(req)` do the same for a route that is not
  one of those. A route mounted without its middleware answers one opaque
  `500 server.unexpected`, not a `TypeError` and not a quiet 401.
- The wrappers are `asyncHandler` plus that narrowing. `asyncHandler` forwards a rejection
  to the error middleware; a handler that is not wrapped is a review blocker, because it
  hides which handlers are async.
- `sendResult` / `sendResultNoContent` map a `Result` to a status in one place (step 4).
- The controller never touches a repository, `fs`, or `sharp`.

## 3. Authorization — declare it, per route

| Middleware                       | Grants                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `requireRole('owner', deps)`     | event owner only                                                                 |
| `requireRole('moderator', deps)` | owner or moderator of **that** event                                             |
| `requireUser(deps)`              | any signed-in account that is still switched on, for a route that names no event |
| `requireGuest(deps)`             | a valid HMAC device token scoped to **that** event, and a guest not revoked      |
| `resolvePublicEvent(deps)`       | no identity: the event in the path, if it serves its wall                        |
| `requireOperator(deps)`          | the account that operates the **box** — never anything inside an event           |
| _(none)_                         | genuinely public — join lookup, health                                           |

A guest may only touch their own photo, inside the grace window: that is not a
middleware, it is `Photo.deletionVerdict` in the domain, which `deletePhoto` acts on and
the guest's DTO reads, so there is no `requireGuestOwnsPhoto` to reach for.

There is no ambient "logged in means allowed". `requireRole` resolves the event from
`:eventSlug` and checks membership **of that event**. A route with no explicit
authorization decision is a review blocker.

`requireOperator` is a different axis, not a higher rung. It gates an operator's own
surface (roadmap §10.2 onwards) and grants nothing inside anybody's event: an
event-scoped route is `requireRole`, always, and `siteOperatorScope.test.ts` sweeps every
route the server mounts to prove an operator with no membership is refused. If a route you
are adding seems to need both, you are writing §10.6 (support access), which is time-boxed,
announced and logged — stop and say so.

Your new route is in that sweep whatever it calls its event, because the sweep no longer
filters on `:eventSlug` — so if it is genuinely public, or genuinely reaches no event, say
so in `PUBLIC_ROUTES` or `NOT_EVENT_SCOPED` with a reason. Both lists are checked against
behaviour, not against the reason you wrote, so neither is a way to make a failing case go
away.

**Operator routes are the one exception to "declare it per route".** They live only in
`src/interface/http/routes/siteRoutes.ts`, mounted at `/api/site` when `SITE_ADMIN=on`,
and that router's `router.use(requireOperator(deps))` — first, above every route — is
their authorization decision; do not restate it per route, and never register a route
above it. Each one is listed in `OPERATOR_ROUTES` in `siteOperatorScope.test.ts` with a
reason, which checks per mode that it is mounted only when on, carried by `siteRoutes`
itself (an entry naming a route of any other router excuses nothing), and refused to a
signed-in account that does not operate the box. No other router may declare a path in
the namespace — `/api/site` or `/api/site/*`, however it is spelled (`/site`, `//site/x`,
`/SITE/x`); `/api/sites` is outside it. A structural case in the same file fails if one
does, because a route written `/site/x` elsewhere answers `/api/site/x` with the mount off,
and one written `//site/x` answers `GET /api//site/x`, which never meets the gate. The walk
behind that case refuses to guess, so do not write what it cannot read: a
route path that is anything but literal segments and `:parameters` (`*name`, `{…}`, `\`,
`|` and every other pattern character alike; Express 5 refuses `*`, `?`, `+`, `(…)` and
`[…]` when the route is registered), a middleware
mounted at a path inside a router (`router.use('/x', fn)`; declare a route, or name the
middleware in `PATH_MOUNTED_MIDDLEWARE` in `testing/routeTable.ts` with the reason it
answers nothing), or a sub-app. Each makes it fail loudly, in both modes. Every other
route keeps the per-route rule above.

## 4. Error mapping — one place, exhaustive

```ts
// src/interface/http/presenters/send.ts  (excerpt)
const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  quotaExceeded: 413,
  rateLimited: 429,
  unexpected: 500,
}
```

Response body for a failure is always:

```json
{ "error": { "code": "photo.notFound", "message": "…", "details": {} } }
```

`code` is the stable domain error code; the client picks the French wording. Never put
a stack trace, SQL fragment, or filesystem path in a response — the error middleware
logs those with a `requestId` and returns the code only.

## 5. Presenter — never serialise an entity directly

```ts
// src/interface/http/presenters/presenters.ts  (the shape is declared in presenters/dto.ts)
export interface ModerationPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly displayUrl: string
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly authorName: string | null
  readonly byteSize: number
  readonly createdAt: string
  // …and the media facet a clip adds (`kind`, `videoUrl`, `durationMs`)
}

export const toModerationPhotoDto = ({
  photo,
  slug,
  authorName,
}: ModerationPhotoDtoInput) => ({
  id: photo.id,
  status: photo.status,
  thumbUrl: mediaUrl(slug, photo.id, THUMB_VARIANT[photo.kind]),
  // …
})
```

Every wire shape is declared in `presenters/dto.ts` and mirrored by hand in
`web/src/lib/api/dto.ts`; `presenters/dtoContract.test.ts` fails when the two disagree.
The wire format is a **contract**. Returning the entity means every internal field rename
becomes a breaking API change, and every internal field becomes a leak. Note what is
absent: storage keys, absolute paths, uploader IP, raw EXIF.

## 6. Register and document

- A new use case is a member of `HttpUseCases` (`useCases.ts`), built in `src/main/usecases.ts`,
  and listed in `notWiredUseCases` (`testing/serverHarness.ts`).
- Mount the router in `src/interface/http/server.ts` under `/api`, as the others are
  (`app.use('/api', moderationRoutes(routeDeps))`).
- Add the route to [docs/API.md](../../../docs/API.md) — method, path, auth, request,
  response, error codes. Kept by hand; an undocumented endpoint is an incomplete one.
- If the frontend calls it, add the typed function in `web/src/lib/api/`.

## 7. Contract test — supertest, real routes, fake adapters

Ring 4 sits next to the route (`routes/moderationRoutes.test.ts` is the model to copy).
`testing/middlewareHarness.ts` gives `buildHarness({ routes })`: an Express app with the
body parser, session, request context, the session-age cap and `attachUser` mounted in the
order `server.ts` mounts them, your routes wired where you say, and the error handler
last. It returns the app plus the fakes behind it (`events`, `memberships`, `guests`,
`users`, `bus`, `clock`, `issueGuestToken`, and the rest of the test world). `signInAs` is the
handler a test mounts on a route of its own to sign a session in without a login. It mounts
cookies too, but **not** `requirePasswordCurrent` or the CSRF gate: what depends on those is
the server harness's job. The use cases are the **real** ones, built over the in-memory
fakes: a stub would let every cross-event assertion pass while the product leaked.
`testing/serverHarness.ts` (`buildServerHarness`) drives the real `buildServer()` instead,
for what depends on the mount order.

```ts
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { moderationRoutes } from './moderationRoutes'
import { GUEST_COOKIE } from '../middleware/authz'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { AT, anEvent, aPhoto } from '../../../application/testing/builders'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { makeModeratePhoto } from '../../../application/usecases/moderation/moderatePhoto'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { PresenterContext } from '../presenters/presenters'
import { notWiredUseCases } from '../testing/serverHarness'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

const PRESENTER: PresenterContext = {
  publicUrl: 'http://localhost:4300',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
  clipLimits: { maxBytes: 80_000_000, maxSeconds: 15, supported: true },
}

// The real use case this route calls, over the fakes; every other member is `notWired`.
const usecasesFor = (
  { events, memberships, bus, clock }: HttpDeps,
  photos: FakePhotoRepository,
): HttpUseCases => ({
  ...notWiredUseCases(),
  moderatePhoto: makeModeratePhoto({ events, photos, memberships, bus, clock }),
})

const WEDDING = 'wedding-id'
const MODERATOR = 'moderator-id'
const PHOTO = '22222222-2222-4222-8222-222222222222' // photoParams parses :photoId as an id

let harness: Harness
let photos: FakePhotoRepository

beforeEach(() => {
  photos = new FakePhotoRepository()
  harness = buildHarness({
    routes: (app, deps) => {
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'mod@example.test' }),
      )
      app.post(
        '/sign-in/gala',
        signInAs({ userId: 'gala-owner-id', email: 'gala@example.test' }),
      )
      app.use(
        '/api',
        moderationRoutes({
          deps,
          usecases: usecasesFor(deps, photos),
          presenter: PRESENTER,
        }),
      )
    },
  })
  harness.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: 'owner-id' }))
  harness.memberships.seed({
    eventId: asEventId(WEDDING),
    userId: asUserId(MODERATOR),
    role: 'moderator',
    grantedAt: AT,
  })
  // A second event on the same box, so the wrong-tenant case is a real member of another one.
  harness.events.seed(
    anEvent({ id: 'gala-id', slug: 'gala', ownerId: 'gala-owner-id' }),
  )
  harness.memberships.seed({
    eventId: asEventId('gala-id'),
    userId: asUserId('gala-owner-id'),
    role: 'owner',
    grantedAt: AT,
  })
  photos.seed(aPhoto({ id: PHOTO, eventId: WEDDING, status: 'pending' }))
})

const signedIn = async (who: 'moderator' | 'gala' = 'moderator') => {
  const agent = request.agent(harness.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

describe('PATCH /api/events/:eventSlug/photos/:photoId/status', () => {
  it('publishes a pending photo for a moderator of the event', async () => {
    const response = await (
      await signedIn()
    )
      .patch(`/api/events/mariage/photos/${PHOTO}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(204)
    expect(harness.bus.published).toContainEqual(
      expect.objectContaining({ type: 'photo.moderated', status: 'published' }),
    )
  })

  it('answers 401 without a session', async () => {
    const response = await request(harness.app)
      .patch(`/api/events/mariage/photos/${PHOTO}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404, never 403, for a host of another event', async () => {
    const response = await (
      await signedIn('gala')
    )
      .patch(`/api/events/mariage/photos/${PHOTO}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('refuses a guest device token: what the room sees is the host alone', async () => {
    const response = await request(harness.app)
      .patch(`/api/events/mariage/photos/${PHOTO}/status`)
      .set('Cookie', `${GUEST_COOKIE}=${harness.issueGuestToken(WEDDING, 'guest-1')}`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(401)
  })

  it('answers 400 for the resulting state instead of the verb', async () => {
    const response = await (
      await signedIn()
    )
      .patch(`/api/events/mariage/photos/${PHOTO}/status`)
      .send({ decision: 'published' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})
```

`usecasesFor` and `PRESENTER` are the file's own: `usecasesFor` builds the real use cases
over the fakes and fills every other member of `HttpUseCases` with a `notWired` stub that
answers an error (`testing/serverHarness.ts` has `notWiredUseCases()` for the whole set), and
`PRESENTER` is the `PresenterContext` the DTOs take.

**Every** mutating route ships with these five: happy, unauthenticated,
wrong-tenant, wrong-role, invalid-payload. On this moderator route the wrong-role case is the
guest token (above); the `403 auth.forbidden` case needs an owner-only route
(`eventRoutes.test.ts` has one). The wrong-tenant case is the one that
catches real incidents, and what it expects is a **404**: a member of another event, or of none, is
never told the event exists (`requireRole`). A guest's token on a host route is a 401 (it is not a
session), and a moderator on an owner's route is a `403 auth.forbidden`.

## Special cases

**Uploads** — photos go through `multer` into a bounded in-memory storage
(`boundedMemoryStorage` in `guestRoutes.ts`: a per-request byte ceiling, so the heap a request
may hold is a number somebody calculated); clips go to a temp dir on disk
(`clipRoutes.ts`, `clipUploadTempDir`), and the file is removed on every exit path. The use
case then validates magic bytes, re-encodes with `sharp` (rotate → strip metadata →
resize), verifies the result, and only then inserts. Never move a client-named file into
the media root.

**Media delivery** — served by a controller, never `express.static`, so event scoping
and authorization apply to every byte. Use `ETag` + `Cache-Control: private,
max-age=31536000, immutable` (content-addressed names make that safe) and stream through
`streamOrAbandon` (`pipeline`, never `pipe`) over the `MediaStore` port.

**SSE** — `src/interface/http/routes/streamRoutes.ts`. Requirements: `flushHeaders()`
immediately, `X-Accel-Buffering: no`, a heartbeat comment frame every 15 s, `id:` on
every event with `Last-Event-ID` resume, per-event channels (never broadcast across
events), and listener cleanup on `req.on('close')`. The hub caps concurrent
subscribers per event.

## Checklist

- [ ] zod schema for every part of the request that is read.
- [ ] Explicit authorization middleware, resolved against the event in the path.
- [ ] Controller: parse, authorize, one use case, present. No rules.
- [ ] `asyncHandler` wrapping; no bare async handler.
- [ ] Failure via `Result` → `sendResult`; no `throw` for expected failures.
- [ ] DTO presenter; no entity on the wire; no paths, IPs, or EXIF leaked.
- [ ] Mounted in `server.ts`, documented in `docs/API.md`, typed client in `web/src/lib/api/`.
- [ ] Supertest: happy + 401 + wrong-tenant + wrong-role + 400.
