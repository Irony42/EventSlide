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

```ts
// src/interface/http/schemas/photoSchemas.ts
import { z } from 'zod'

export const moderatePhotoParams = z.object({
  eventSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  photoId: z.string().uuid(),
})

export const moderatePhotoBody = z.object({
  status: z.enum(['published', 'rejected', 'hidden']),
})

export const listPhotosQuery = z.object({
  status: z.enum(['pending', 'published', 'rejected', 'hidden']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  cursor: z.string().optional(),
})
```

- Every route parses `params`, `query`, and `body` it reads. Anything unparsed is
  untrusted input reaching a use case.
- `.strict()` on bodies where extra keys would be a client bug worth surfacing.
- `z.coerce` for query numbers — they arrive as strings.
- Schemas define **shape**, never business rules. "The event must not be archived" is
  a domain rule, not `z.refine`.

## 2. Controller — thin, and it is allowed to be boring

```ts
// src/interface/http/routes/moderationRoutes.ts
import { Router } from 'express'
import { moderatePhotoBody, moderatePhotoParams } from '../schemas/photoSchemas'
import { requireRole } from '../middleware/authz'
import { asyncHandler } from '../middleware/asyncHandler'
import { sendResult, sendNoContent } from '../presenters/send'
import type { HttpDeps } from '../types'

export const moderationRoutes = ({ usecases }: HttpDeps): Router => {
  const router = Router()

  router.patch(
    '/events/:eventSlug/photos/:photoId/status',
    requireRole('moderator'),
    asyncHandler(async (req, res) => {
      const params = moderatePhotoParams.parse(req.params)
      const body = moderatePhotoBody.parse(req.body)

      const result = await usecases.moderatePhoto({
        eventSlug: params.eventSlug,
        photoId: params.photoId,
        actor: req.actor,          // set by authn middleware, typed in types.ts
        status: body.status,
      })

      return sendResult(res, result, sendNoContent)
    }),
  )

  return router
}
```

- `asyncHandler` forwards rejections to the error middleware. Never write a bare
  `async` Express handler — an unhandled rejection crashes the process.
- `requireRole` handles authorization **before** the body is even read.
- `sendResult` maps `Result` to a status code in one place (see step 4).
- The controller never touches a repository, `fs`, or `sharp`.

## 3. Authorization — declare it, per route

| Middleware | Grants |
| --- | --- |
| `requireRole('owner')` | event owner only |
| `requireRole('moderator')` | owner or moderator of **that** event |
| `requireGuest()` | a valid HMAC device token scoped to **that** event |
| `requireGuestOwnsPhoto()` | guest token + photo authored by that token, inside the grace window |
| *(none)* | genuinely public — join lookup, health |

There is no ambient "logged in means allowed". `requireRole` resolves the event from
`:eventSlug` and checks membership **of that event**. A route with no explicit
authorization decision is a review blocker.

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
// src/interface/http/presenters/photoPresenter.ts
export interface PhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly caption: string | null
  readonly authorName: string | null
  readonly width: number
  readonly height: number
  readonly createdAt: string
  readonly thumbnailUrl: string
  readonly fullUrl: string
}

export const toPhotoDto = (photo: Photo, event: Event): PhotoDto => ({ /* … */ })
```

The wire format is a **contract**. Returning the entity means every internal field
rename becomes a breaking API change, and every internal field becomes a leak. Note
what is absent: storage keys, absolute paths, uploader IP, raw EXIF.

## 6. Register and document

- Mount in `src/interface/http/server.ts` under `/api`.
- Add the route to [docs/API.md](../../../docs/API.md) — method, path, auth, request,
  response, error codes. Kept by hand; an undocumented endpoint is an incomplete one.
- If the frontend calls it, add the typed function in `web/src/lib/api/`.

## 7. Contract test — supertest, real server, fake adapters

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildTestServer, loginAs, joinAsGuest } from '../testing/httpHarness'

describe('PATCH /api/events/:slug/photos/:id/status', () => {
  let harness: Awaited<ReturnType<typeof buildTestServer>>

  beforeEach(async () => {
    harness = await buildTestServer()
  })

  it('publishes a pending photo for a moderator of the event', async () => {
    const agent = await loginAs(harness, 'moderator@wedding')

    const response = await agent
      .patch('/api/events/wedding/photos/photo-1/status')
      .send({ status: 'published' })

    expect(response.status).toBe(204)
    expect(harness.bus.published).toContainEqual(
      expect.objectContaining({ type: 'photo.published' }),
    )
  })

  it('answers 401 without a session', async () => {
    const response = await request(harness.app)
      .patch('/api/events/wedding/photos/photo-1/status')
      .send({ status: 'published' })

    expect(response.status).toBe(401)
  })

  it('answers 403 for a moderator of a different event', async () => {
    const agent = await loginAs(harness, 'moderator@birthday')
    const response = await agent
      .patch('/api/events/wedding/photos/photo-1/status')
      .send({ status: 'published' })

    expect(response.status).toBe(403)
  })

  it('answers 403 for a guest token, which may never moderate', async () => {
    const agent = await joinAsGuest(harness, 'wedding')
    const response = await agent
      .patch('/api/events/wedding/photos/photo-1/status')
      .send({ status: 'published' })

    expect(response.status).toBe(403)
  })

  it('answers 400 for a status outside the enum', async () => {
    const agent = await loginAs(harness, 'moderator@wedding')
    const response = await agent
      .patch('/api/events/wedding/photos/photo-1/status')
      .send({ status: 'deleted-forever' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})
```

**Every** mutating route ships with these five: happy, unauthenticated,
wrong-tenant, wrong-role, invalid-payload. The wrong-tenant case is the one that
catches real incidents.

## Special cases

**Uploads** — `multer` writes to a temp dir with a byte limit; the use case then
validates magic bytes, re-encodes with `sharp` (rotate → strip metadata → resize),
verifies the result, and only then inserts. On any failure the temp file is removed.
Never move a client-named file into the media root.

**Media delivery** — served by a controller, never `express.static`, so event scoping
and authorization apply to every byte. Use `ETag` + `Cache-Control: private,
max-age=31536000, immutable` (content-addressed names make that safe) and stream with
`res.sendFile` under an explicit root.

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
