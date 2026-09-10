# Architecture — EventSlide 2.0

Layers, the request pipeline, the ports, the domain model, the schema, the realtime
design. Companions: [CLAUDE.md](../CLAUDE.md) and [AGENTS.md](../AGENTS.md) (rules),
[docs/API.md](API.md) (the HTTP contract), `.claude/skills/` (recipes).

> **Status.** The 2.0 design on branch `deuxpointzero`. The 1.0 implementation
> (`src/index.ts`, `src/database.ts`, `src/routes/`, `src/frontend/`) was removed in
> `fa6e9bd` and remains on `main`. The toolchain that enforces this architecture —
> `eslint.config.js`, the tsconfig projects, `vitest.config.ts`,
> `playwright.config.ts` — is in place; the `src/**` tree it governs is being built out
> module by module. Mechanisms not yet landed are marked **[planned]**.

---

## 1. Purpose and the three surfaces

A **self-hosted live photo wall**. Guests photograph an event from their own phones, a
host approves each photo, approved photos reach a projector within seconds. One
deployment, one box, one venue.

Not one application with three skins — three surfaces with conflicting constraints, and
most decisions here are trade-offs between them.

|               | Guest phone                                   | Host laptop                               | Projected room                         |
| ------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Route         | `/join/:code`, `/e/:slug/upload`              | `/admin/**`                               | `/e/:slug/display`                     |
| Viewport      | 360–430 px, one thumb                         | 1280–1920 px, mouse + keyboard            | 1080p–4K, read at 3–10 m               |
| Network       | congested venue Wi-Fi / 4G, drops mid-upload  | wired or good Wi-Fi                       | must survive a drop unattended         |
| Session       | 40 seconds                                    | minutes at a time, repeatedly             | 8 hours, nobody touching it            |
| Identity      | anonymous HMAC device token, no account       | `express-session`, bcrypt, per-event role | none — public read of published photos |
| Worst failure | a lost upload the guest cannot retry          | approving the wrong photo                 | a blank screen, a jump, a memory leak  |
| Optimise for  | fewest taps, forgiving retries, 44 px targets | density, keyboard, undo                   | beauty, legibility, zero jank          |

- **The guest surface owns the latency budget.** Re-encoding is bounded and the upload
  response never waits on the projector.
- **The host surface owns the truth.** The wall never queries `pending` photos — it
  cannot, because authorization on the read path forbids it.
- **The room surface owns endurance.** No unbounded arrays, no growing DOM, no interval
  outliving its component. Eight unattended hours is a requirement, not a stress test.

A change that slows the guest flow for an admin convenience is a regression. Every
change states which surface it serves.

---

## 2. Layers, the dependency rule, and how it is enforced

```
web/src ──HTTP──► src/interface/http ──► src/application ──► src/domain
                                              ▲                  ▲
                        src/infrastructure ────┘──────────────────┘
                        src/main ──► all of the above (composition only)
```

| Layer                | May import                                        | May **not** import                                                                         |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/domain`         | `src/domain` only                                 | everything else, `zod` and `node:crypto` included                                          |
| `src/application`    | `src/domain`, `src/application`                   | `express`, `better-sqlite3`, `fs`, `sharp`, `react`, `src/infrastructure`, `src/interface` |
| `src/infrastructure` | `src/domain`, `src/application/ports`, npm        | `src/interface`, `src/main`, `src/application/usecases`                                    |
| `src/interface/http` | `src/domain`, `src/application`, `express`, `zod` | `src/infrastructure` — it receives adapters as `deps`                                      |
| `src/main`           | everything                                        | —                                                                                          |
| `web/src`            | `web/src`                                         | any `src/**` module; the wire types are duplicated as DTOs on purpose                      |

### Enforcement 1 — eslint, one block per layer

Review does not catch import drift; a build failure does. `eslint.config.js` carries one
`files` block per layer listing what that layer may not reach for, using the built-in
`no-restricted-imports` rather than an import-graph plugin — the patterns are readable in
the error message and the boundary needs no extra dependency.

```js
// eslint.config.js — abridged; the file is the source of truth
const DOMAIN_FORBIDDEN = [
  { group: ['**/application/**', '**/infrastructure/**', '**/interface/**', '**/main/**', '**/web/**'],
    message: 'src/domain is pure and may not depend on an outer layer. Model the need as a port.' },
  { group: ['express*', 'better-sqlite3', 'sharp', 'multer', 'archiver', 'helmet', 'bcrypt',
            'pino*', 'zod', 'react', 'react-*', 'fs', 'path', 'crypto', 'node:*'],
    message: 'src/domain must have no I/O and no framework dependency.' },
]
{ files: ['src/domain/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: DOMAIN_FORBIDDEN }] } },
// …one further block each for application, infrastructure, interface and web/**
```

Three further bans in the same file, each closing a defect class rather than a style
preference:

| Ban                                         | Where                                                                                | Why                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `new Date()`, `Date.now()`, `Math.random()` | `src/domain`, `src/application`                                                      | ambient time and randomness make a test flaky by construction — take a `Date` parameter or inject the `Clock` / `IdGenerator` port |
| `process.env` (via `no-restricted-syntax`)  | everywhere except `src/infrastructure/config/env.ts`, where the rule is switched off | configuration is parsed once and passed as a value                                                                                 |
| `page.waitForTimeout()`                     | `tests/e2e`                                                                          | the single largest source of flake in an SSE-driven app                                                                            |

Never suppressed with `eslint-disable`. If domain code appears to need I/O the model is
wrong: declare a port in `src/application/ports/`, implement it in `src/infrastructure/`.

### Enforcement 2 — separate tsconfig projects

Lint catches deliberate imports. The type projects make whole categories of code
_unwritable_, because the ambient types are not there to compile against.

| Project                | Includes                                               | `lib` / `types`                | What becomes impossible                                                   |
| ---------------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| `tsconfig.base.json`   | —                                                      | shared strictness only         | — (extended by all below)                                                 |
| `tsconfig.domain.json` | `src/domain`                                           | `lib: ["ES2023"]`, `types: []` | `process`, `Buffer`, `document`, `require` — no Node or DOM globals exist |
| `tsconfig.server.json` | `src/**` incl. colocated tests                         | `types: ["node"]`, no DOM      | any DOM reference; `document` in a use case fails to compile              |
| `tsconfig.web.json`    | `web/**`                                               | `lib: [… "DOM"]`               | Node globals; `verbatimModuleSyntax` also forbids CJS interop shortcuts   |
| `tsconfig.tools.json`  | `tests/**`, `scripts/**`, `vitest`/`playwright` config | DOM + `types: ["node"]`        | build and e2e config leaking into shipped code                            |
| `tsconfig.build.json`  | `src/**` minus tests and doubles                       | emits to `dist/server`         | shipping a fake or a test harness in the build output                     |

`npm run typecheck` runs domain, server, web and tools. `types: []` on the domain project
is the strongest guard in the repo: `Date.now()` still compiles (it is ECMAScript, and
lint bans it separately) but `process.env`, Node's `crypto.randomUUID()` and `fs` do not
exist at all — there is nothing to import. The base config also carries
`noUncheckedIndexedAccess` (a SQLite `rows[0]` is `T | undefined`, and so is a playlist
lookup), `exactOptionalPropertyTypes` (on a partial update, "absent" and "cleared" are
different intents), `noImplicitReturns` and `noPropertyAccessFromIndexSignature`.

**Why the ceremony pays.** `src/domain/photos/photo.ts` decides whether a photo may be
published. In 1.0 that decision lived inside `changePicsStatus` in
`src/routes/pictures.ts`, which read `req.user`, ran SQL against a module-level `db`, and
emitted on an `EventEmitter` — so testing "a moderator of another event cannot publish
this photo" required a live server, a SQLite file, a session cookie, and a real JPEG. It
is now a function call.

---

## 3. One request end to end: a guest uploads a photo

`POST /api/events/mariage/photos` — `multipart/form-data`, 1–10 images, optional caption,
guest device-token cookie. The request the product exists for, so every file it touches
is named.

| #   | File                                                                                  | What happens here                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `web/src/features/guest-upload/hooks/useUploadQueue.ts`                               | View-state only: queue rows, per-file progress, retry. No rule about what is uploadable.                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | `web/src/lib/api/photos.ts`                                                           | Typed `uploadPhotos(slug, files, caption)`; builds `FormData`. The only place this endpoint's shape is written in the web app.                                                                                                                                                                                                                                                                                                                                |
| 3   | `web/src/lib/http.ts`                                                                 | `credentials: 'same-origin'`, CSRF header, maps `error.code` → French copy from `web/src/lib/i18n/`. The only place `fetch` appears.                                                                                                                                                                                                                                                                                                                          |
| 4   | `src/main/index.ts`                                                                   | The listening process; built the app once at boot via `buildServer(deps)` and takes no part in the request.                                                                                                                                                                                                                                                                                                                                                   |
| 5   | `src/interface/http/server.ts`                                                        | Middleware order is load-bearing: `helmet` → `requestId` → `pino-http` → `cookieParser` → `session` → body parsers → rate limiters → routers → `errorHandler`.                                                                                                                                                                                                                                                                                                |
| 6   | `src/interface/http/middleware/requestId.ts`                                          | Sets `req.id`. Every log line and every 5xx carries it; the response never carries the underlying error.                                                                                                                                                                                                                                                                                                                                                      |
| 7   | `src/interface/http/middleware/rateLimit.ts`                                          | `express-rate-limit`, two limiters here — per-IP and per-`eventSlug`. Either exceeded returns `429 request.rateLimited` **before** a byte of body is read.                                                                                                                                                                                                                                                                                                    |
| 8   | `src/interface/http/routes/photoRoutes.ts`                                            | `router.post('/events/:eventSlug/photos', uploadLimiter, requireGuest(), tempUpload.array('photos', config.maxUploadFiles), asyncHandler(handler))`. `asyncHandler` is mandatory: a bare `async` handler turns a rejection into an unhandled rejection and kills the process.                                                                                                                                                                                 |
| 9   | `src/interface/http/middleware/guestToken.ts`                                         | Reads the `HttpOnly; SameSite=Lax` cookie, verifies the HMAC through the `TokenService` port, sets `req.guest = { guestId, eventId, issuedAt }`. Bad signature → `401`.                                                                                                                                                                                                                                                                                       |
| 10  | `src/interface/http/middleware/authz.ts`                                              | `requireGuest()` resolves `:eventSlug` → `eventId` and compares it to the **token's** `eventId`. Mismatch → `403`. That one comparison is why a token from event A cannot upload to event B.                                                                                                                                                                                                                                                                  |
| 11  | `src/interface/http/upload/tempUpload.ts`                                             | `multer.diskStorage` into `config.uploadTempDir`; `limits: { fileSize, files }`; filename from `IdGenerator`. **No `fileFilter` on MIME type** — the client's `Content-Type` is not evidence and is never consulted.                                                                                                                                                                                                                                          |
| 12  | `src/interface/http/schemas/photoSchemas.ts`                                          | `uploadPhotoParams.parse(req.params)` (slug regex), `uploadPhotoBody.parse(req.body)` (caption ≤ 140). Shape only; "the event must accept uploads" is a domain rule, never a `z.refine`.                                                                                                                                                                                                                                                                      |
| 13  | `src/application/usecases/photos/uploadPhotos.ts`                                     | The orchestrator: `{ eventId, guestId, files, caption }` plus ports → `Result`. Owns no I/O and no rule.                                                                                                                                                                                                                                                                                                                                                      |
| 14  | `application/ports/eventRepository.ts` → `infrastructure/db/sqliteEventRepository.ts` | `findById(eventId)` → `Event`; missing → `event.notFound`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| 15  | `src/domain/events/event.ts`                                                          | `event.acceptsUploads(now)` — status `live`, inside the upload window, uploads not paused in settings. Refusals: `event.notLive`, `event.uploadsClosed`.                                                                                                                                                                                                                                                                                                      |
| 16  | `src/domain/events/quota.ts` + `photos.countBytes(eventId)`                           | Remaining bytes vs. the sum of this event's `byte_size`. Over → `event.quotaExceeded` → `413`. The event stops accepting uploads instead of filling the disk.                                                                                                                                                                                                                                                                                                 |
| 17  | `src/domain/photos/caption.ts`                                                        | `Caption.create(raw)` — trim, strip C0/C1 control characters, bound length. Returns `Result`, never throws.                                                                                                                                                                                                                                                                                                                                                   |
| 18  | `application/ports/imageProcessor.ts` → `infrastructure/media/sharpImageProcessor.ts` | `probe(tempPath)`: reads the first 32 bytes and calls `sniff()` from `infrastructure/media/magicBytes.ts` (hand-rolled, zero dependencies — JPEG `FF D8 FF`, PNG, WebP `RIFF…WEBP`, HEIF `ftyp`). Unrecognised → `400 photo.unsupportedFormat`. Then `sharp(path).metadata()` — header only — rejects a pixel bomb on `width * height > config.maxImagePixels` **before any full decode**. Sniff precedes decode so a hostile file never reaches the decoder. |
| 19  | same adapter                                                                          | `transcode`: `sharp(path).rotate().resize({ fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer()`. Bare `.rotate()` bakes EXIF orientation into pixels; _not_ calling `withMetadata()` is what drops EXIF — GPS, device serial, timestamps. Order is rotate → strip → resize: resizing first resizes the wrong axis. Out: `full` and `thumb` buffers plus the SHA-256 of each.                                              |
| 20  | `application/ports/photoRepository.ts`                                                | `findByContentHash(eventId, hash)`. A hit returns the existing photo and the upload is a **no-op success** — the double-tapped "Envoyer" that produced two identical slides in 1.0.                                                                                                                                                                                                                                                                           |
| 21  | `application/ports/mediaStore.ts` → `infrastructure/media/filesystemMediaStore.ts`    | `put({ eventId, contentHash, variant, bytes })` → `<mediaRoot>/<eventId>/<hash[0:2]>/<hash[2:4]>/<hash>-<variant>.jpg`. Writes `<name>.part` then `fs.rename` — same filesystem, so the rename is atomic and a reader never sees a half-written file. Never accepts a client-supplied name, never joins user input into a path.                                                                                                                               |
| 22  | `src/domain/photos/photo.ts`                                                          | `Photo.create({ eventId, guestId, contentHash, width, height, byteSize, caption }, id, now)` → status `pending`. The entity, not the handler, decides the initial status.                                                                                                                                                                                                                                                                                     |
| 23  | `infrastructure/db/sqlitePhotoRepository.ts`                                          | `save(photo)` inside a `better-sqlite3` `db.transaction(...)` — synchronous, so no `await` sits between the check and the insert. `INSERT … ON CONFLICT(event_id, content_hash) DO NOTHING` backstops step 20 at the database level.                                                                                                                                                                                                                          |
| 24  | `application/ports/eventBus.ts` → `infrastructure/realtime/inProcessEventBus.ts`      | `bus.publish({ type: 'photo.submitted', eventId, photoId })`. Side effects come **after** persistence: a subscriber must never learn about an uncommitted row.                                                                                                                                                                                                                                                                                                |
| 25  | `infrastructure/realtime/sseHub.ts`                                                   | Subscribed to the bus at container wiring. Maps the domain event to a frame on this event's **`moderation`** topic — not `wall`, because the wall must not learn that a pending photo exists.                                                                                                                                                                                                                                                                 |
| 26  | `interface/http/presenters/photoPresenter.ts`                                         | `toPhotoDto(photo, event)` → `201 { photos: PhotoDto[] }`. Absent from the DTO: storage key, absolute path, uploader IP, raw EXIF.                                                                                                                                                                                                                                                                                                                            |
| 27  | `web/src/features/guest-upload/components/UploadQueue.tsx`                            | Row flips to `data-state="done"`. Total for the guest: one request.                                                                                                                                                                                                                                                                                                                                                                                           |
| 28  | `web/src/lib/realtime/useEventStream.ts` (host)                                       | Receives `event: invalidate`, `data: {"topic":"moderation"}` and invalidates the queue key. Carries no photo data.                                                                                                                                                                                                                                                                                                                                            |
| 29  | `web/src/features/moderation/hooks/useModerationQueue.ts`                             | Refetches `GET /api/events/mariage/photos?status=pending` — an authorized read, so the host sees exactly what the role permits.                                                                                                                                                                                                                                                                                                                               |
| 30  | `interface/http/routes/mediaRoutes.ts`                                                | The card's thumbnail: a **controller**, never `express.static`, so the photo is looked up scoped by `eventId` and a `pending` photo 404s for anyone who is not a moderator of that event. `ETag` is the content hash; `Cache-Control: private, max-age=31536000, immutable` is safe because the name is the hash.                                                                                                                                             |
| 31  | `application/usecases/photos/publishPhoto.ts`                                         | The host clicks _Publier_: `photo.publish(clock.now())` → `bus.publish({ type: 'photo.published' })` → hub → the **`wall`** topic.                                                                                                                                                                                                                                                                                                                            |
| 32  | `web/src/features/display-wall/hooks/useWallPlaylist.ts`                              | Invalidation → refetch `?status=published` → `src/domain/slideshow/playlist.ts` (pure) recomputes the playlist → the photo is on the projector.                                                                                                                                                                                                                                                                                                               |

### Failure unwinding

Ingest order is **write file → verify → insert**, and every exit path cleans up. In 1.0
the insert happened first, so a `sharp` failure left a row pointing at no file and broke
the slideshow for the rest of the evening.

| Fails at                    | Already done             | Unwound how                                                                                      |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| 11 multer limit             | temp file partly written | multer removes it; `413 upload.tooLarge`                                                         |
| 18 magic bytes / pixel bomb | temp file on disk        | `finally` unlinks it; nothing else touched                                                       |
| 19 `sharp` throws           | temp file on disk        | unlinked; no media written, no row                                                               |
| 21 second `put` fails       | `full` variant stored    | both variant keys deleted from the store; no row                                                 |
| 23 insert fails             | both variants stored     | `media.delete` per key, then the error is returned                                               |
| 24 bus throws               | row committed            | logged and swallowed — a lost notification is a 15 s stale UI; a rolled-back row is a lost photo |

`src/main/container.ts` sweeps the temp directory at boot, so a `SIGKILL` mid-upload
leaks one file until the next restart rather than forever.

---

## 4. Ports catalogue

A port is an interface in `src/application/ports/`, expressed in domain types, with one
production adapter and one in-memory fake. Both are verified against the **same** contract
suite in `src/application/testing/contracts/` — that is what keeps the fakes honest.
Adding a port method means adding a contract case.

| Port                 | Responsibility                                                            | Production adapter                         | Test fake                                                                                     |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `EventRepository`    | Events by id / slug / join code; slug and join-code uniqueness            | `db/sqliteEventRepository.ts`              | `FakeEventRepository` (enforces the same uniqueness)                                          |
| `PhotoRepository`    | Event-scoped CRUD, status filters, `countBytes`, `findByContentHash`      | `db/sqlitePhotoRepository.ts`              | `FakePhotoRepository` (keyed `${eventId}:${photoId}`, so a cross-event read genuinely misses) |
| `GuestRepository`    | Event-scoped device identity and display name                             | `db/sqliteGuestRepository.ts`              | `FakeGuestRepository`                                                                         |
| `UserRepository`     | Host/moderator accounts and per-event role membership                     | `db/sqliteUserRepository.ts`               | `FakeUserRepository`                                                                          |
| `ReactionRepository` | Event-scoped reactions, one per guest per photo                           | `db/sqliteReactionRepository.ts`           | `FakeReactionRepository`                                                                      |
| `MediaStore`         | `put`/`get`/`delete`/`stat` of content-addressed bytes                    | `media/filesystemMediaStore.ts`            | `InMemoryMediaStore` (byte buffers, reports sizes)                                            |
| `ImageProcessor`     | `probe` (magic bytes + dimensions), `transcode` (rotate → strip → resize) | `media/sharpImageProcessor.ts`             | `FakeImageProcessor` (deterministic metadata, simulates rotation and failure)                 |
| `PasswordHasher`     | Hash and verify host credentials                                          | `crypto/bcryptPasswordHasher.ts`, cost 12  | `FakePasswordHasher` (`hash:<password>` — no bcrypt cost in tests)                            |
| `TokenService`       | Sign and verify event-scoped guest device tokens                          | `crypto/hmacTokenService.ts`, HMAC-SHA-256 | `FakeTokenService` (`token:<eventId>:<guestId>`)                                              |
| `IdGenerator`        | Opaque, non-enumerable application ids                                    | `crypto/cryptoIdGenerator.ts`              | `SequentialIdGenerator` (`id-1`, `id-2` — readable assertions)                                |
| `Clock`              | `now(): Date`                                                             | `time/systemClock.ts`                      | `FakeClock` (`advance(ms)`)                                                                   |
| `EventBus`           | Publish/subscribe domain events in-process                                | `realtime/inProcessEventBus.ts`            | `RecordingEventBus` (`published: DomainEvent[]`)                                              |
| `Logger`             | Structured logging with `requestId`                                       | `logging/pinoLogger.ts`                    | `CapturingLogger` (assert a warning was emitted, never a message string)                      |
| `ArchiveBuilder`     | Stream an event's album as a zip                                          | `archive/archiverAlbumArchiver.ts`         | `FakeArchiveBuilder` (records the entries requested)                                          |

Port design rules: **no storage vocabulary** — no `WHERE`, no row types, no `Statement`;
an interface that mentions SQLite is not a port. **`eventId` comes first** on every
event-scoped method, so the unsafe call `findById(photoId)` does not exist rather than
being discouraged. **Domain objects out, not rows** — `snake_case` → camelCase mapping
happens in the adapter and nowhere else. **Narrow** — a fourteen-method port is several
ports.

Deliberately not ports: the `express-session` store (a transport concern, wired in
`server.ts` from `db/sqliteSessionStore.ts`) and the migrator (a boot concern owned by
`container.ts`). Neither is reachable from a use case. The fakes named in
`.claude/skills/eventslide-testing/SKILL.md` are the naming authority; the remaining four
follow the same convention and land with their ports.

---

## 5. Domain model

`src/domain` is pure TypeScript: no `express`, `better-sqlite3`, `fs`, `sharp`, `react`,
`zod`, or `node:crypto`. Every constructor is private and every factory returns
`Result<T, DomainError>` rather than throwing, so error paths cannot go untested by
accident. Error codes (`photo.notFound`, `event.quotaExceeded`) are stable machine
strings; the French wording is chosen in `web/src/lib/i18n/`, which is also why tests
assert on codes and never on messages.

| Kind   | Type                         | Lives in                               | Invariant it owns                                                                                  |
| ------ | ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Entity | `Event`                      | `events/event.ts`                      | Lifecycle transitions, `acceptsUploads(now)`, settings coherence                                   |
| Entity | `Photo`                      | `photos/photo.ts`                      | Status transitions, ownership, immutable dimensions                                                |
| Entity | `Guest`                      | `guests/guest.ts`                      | Belongs to exactly one event; display-name rules                                                   |
| Entity | `User` + `Membership`        | `users/`                               | A role is always _per event_; there is no global admin                                             |
| Entity | `Reaction`                   | `reactions/reaction.ts`                | One reaction per guest per photo; emoji from a closed set                                          |
| VO     | `EventSlug`                  | `events/eventSlug.ts`                  | `^[a-z0-9][a-z0-9-]{1,62}$`, stored already-lowercased                                             |
| VO     | `JoinCode`                   | `events/joinCode.ts`                   | Fixed length, uppercase, alphabet excludes `0/O` and `1/I` — it is read aloud and typed on a phone |
| VO     | `Caption`                    | `photos/caption.ts`                    | Trimmed, ≤ 140 chars, C0/C1 control characters stripped                                            |
| VO     | `DisplayName`                | `guests/displayName.ts`                | 1–40 chars, trimmed, no control characters                                                         |
| VO     | `ContentHash`                | `photos/contentHash.ts`                | 64 lowercase hex characters                                                                        |
| VO     | `ImageDimensions`            | `photos/imageDimensions.ts`            | Both edges positive, `width * height` under the pixel ceiling                                      |
| VO     | `QuotaBytes` + `remaining()` | `events/quota.ts`                      | Non-negative; a quota decision is arithmetic, not a query                                          |
| VO     | `EventSettings`              | `events/eventSettings.ts`              | Slide interval, layout, moderation mode, reactions on/off                                          |
| Type   | `Result`, `DomainError`      | `shared/result.ts`, `shared/errors.ts` | Error **kind** (→ HTTP status) and stable machine `code`                                           |
| Type   | Branded ids                  | `shared/ids.ts`                        | `EventId`, `PhotoId`, `GuestId`, `UserId` are not interchangeable at compile time                  |

### Photo status machine

`src/domain/photos/photoStatus.ts` holds the transition table; `Photo`'s intent-named
methods are the only way through it, and each returns a **new** `Photo`.

| From        | To          | Method        | Meaning                                                      |
| ----------- | ----------- | ------------- | ------------------------------------------------------------ |
| `pending`   | `published` | `publish(at)` | Moderator approved; it goes to the wall                      |
| `pending`   | `rejected`  | `reject(at)`  | Not appropriate; the guest is not told which                 |
| `published` | `hidden`    | `hide(at)`    | Temporarily off the wall, still in the album                 |
| `published` | `rejected`  | `reject(at)`  | Approved by mistake                                          |
| `rejected`  | `published` | `publish(at)` | Rejection reversed                                           |
| `hidden`    | `published` | `publish(at)` | Back on the wall                                             |
| any         | itself      | —             | Idempotent no-op; a double-clicked _Publier_ is not an error |

Everything absent from that table is refused with `photo.invalidTransition`. There is no
route back to `pending`: a decision, once made, is a fact. Deletion is a separate
operation, not a status.

| Enforced in                                    | Mechanism                                               | Why also here                                                                              |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `domain/photos/photoStatus.ts`                 | `canTransition(from, to)` table                         | The rule itself, 100% branch-covered                                                       |
| `application/usecases/photos/moderatePhoto.ts` | delegates to `photo.publish(...)`, never re-implements  | Orchestration plus the `eventId`-scoped read that makes cross-tenant moderation impossible |
| `photos.status` `CHECK` constraint             | `status IN ('pending','published','rejected','hidden')` | Defence in depth against a hand-written migration or a `sqlite3` shell session             |

### Event lifecycle

```
draft ──publish()──► live ──close()──► closed ──archive()──► archived
  └──────────────────────── archive() ──────────────────────────┘
```

| Status     | Guest uploads | Wall reads | Host edits | Notes                                                       |
| ---------- | ------------- | ---------- | ---------- | ----------------------------------------------------------- |
| `draft`    | no            | no         | yes        | Join code exists but resolves to "not started"              |
| `live`     | yes           | yes        | yes        | The only status in which `acceptsUploads(now)` can be true  |
| `closed`   | no            | yes        | yes        | The evening is over; the album still projects and downloads |
| `archived` | no            | no         | read-only  | Media may be tiered off; terminal                           |

`archived` is terminal because reopening an event whose media may have moved would be a
promise the storage layer cannot keep. `Event.acceptsUploads(now)` is the single
predicate the upload use case calls, so "why was my upload refused" has one place to read.

---

## 6. Data model

SQLite via `better-sqlite3` — synchronous (so a transaction has no `await` inside it and
cannot interleave), WAL, `:memory:` in tests. Pragmas are set once in
`src/infrastructure/db/connection.ts`; migrations in `src/infrastructure/db/migrations/`
are **append-only**, registered in an explicit ordered array (never a glob), each recorded
by number and by a checksum of its SQL.

Conventions: `snake_case` plural tables; primary keys are application-generated opaque
`TEXT`, never `AUTOINCREMENT` (ids appear in URLs and must not enumerate an album);
timestamps are ISO-8601 UTC `TEXT` (sorts lexicographically, readable in a dump, no
timezone ambiguity); booleans `INTEGER 0/1`; closed enums get a `CHECK`.

| Table               | Primary key            | Key columns                                                                                                                         | Indexes                                                                                                          |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `events`            | `id TEXT`              | `slug`, `name`, `join_code`, `status`, `settings` (JSON `TEXT`), `quota_bytes INTEGER`, `created_at`, `updated_at`                  | `UNIQUE(slug)`, `UNIQUE(join_code)`, `(status, created_at DESC)`                                                 |
| `users`             | `id TEXT`              | `email` (normalised lowercase), `password_hash`, `created_at`                                                                       | `UNIQUE(email)`                                                                                                  |
| `event_members`     | `(event_id, user_id)`  | `role TEXT CHECK (role IN ('host','moderator'))`, `created_at`                                                                      | `(event_id, role)`, `(user_id)`                                                                                  |
| `guests`            | `id TEXT`              | `event_id`, `display_name`, `token_hash`, `created_at`, `last_seen_at`                                                              | `(event_id, created_at DESC)`, `UNIQUE(event_id, token_hash)`                                                    |
| `photos`            | `id TEXT`              | `event_id`, `guest_id`, `status CHECK (…)`, `content_hash`, `caption`, `width`, `height`, `byte_size`, `created_at`, `moderated_at` | `(event_id, status, created_at DESC)`, `UNIQUE(event_id, content_hash)`, `(event_id, guest_id, created_at DESC)` |
| `reactions`         | `(photo_id, guest_id)` | `event_id`, `emoji CHECK (…)`, `created_at`                                                                                         | `(event_id, photo_id)`                                                                                           |
| `sessions`          | `sid TEXT`             | `expires_at`, `data TEXT`                                                                                                           | `(expires_at)` for the sweeper                                                                                   |
| `schema_migrations` | `id INTEGER`           | `name`, `checksum`, `applied_at`                                                                                                    | —                                                                                                                |

Two rules explain most of that index list. **Every event-scoped table carries**
`event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE`. **Every event-scoped
index leads with `event_id`**, because every query filters on it — so
`(event_id, status, created_at DESC)` serves the moderation queue, the wall playlist and
the album export from one B-tree. `UNIQUE(event_id, content_hash)` does real work: it
makes a re-tapped upload a no-op at the database level instead of a duplicate slide.

### The cascade story: "purge this event" is one statement

```ts
// src/infrastructure/db/sqliteEventRepository.ts
purge = this.db.transaction((eventId: string) => {
  // FKs are ON for this connection (connection.ts). Photos, guests, reactions and
  // memberships all cascade from this single row.
  this.deleteEvent.run(eventId)
})
```

1. **`PRAGMA foreign_keys = ON` is per-connection**, set in `connection.ts`. Without it
   SQLite silently ignores foreign keys — including these cascades. A connection test
   asserts the pragma for exactly that reason.
2. `better-sqlite3` is synchronous, so the transaction is one uninterrupted unit: there is
   no `await` in the middle for a concurrent reader to observe a half-purged event.
3. **Database first, filesystem second.** The delete commits, _then_
   `<mediaRoot>/<eventId>/` is removed. If the process dies between the two, the album is
   correctly gone and some bytes are recoverable garbage, swept at boot. The reverse order
   risks a row pointing at a deleted file — a broken album on a projector.
4. `sessions` deliberately has **no** `event_id` and no cascade: host sessions span
   events, and purging one must not log a host out of the others.

---

## 7. Realtime design

One long-lived SSE stream per open page: `GET /api/events/:slug/stream`, served by
`src/interface/http/routes/streamRoutes.ts` over `src/infrastructure/realtime/sseHub.ts`.
WebSockets would buy bidirectionality this product does not need — every write is already
an authorized HTTP request — at the cost of a second protocol, a second auth path, and
proxy configuration at every venue.

The hub keys subscribers by `eventId` **and topic**, and never broadcasts across events.
1.0 used one process-wide `EventEmitter` consulted with a partyId defaulted from a query
string, so a stranger could subscribe to another party's updates.

| Topic        | Frames                                                                | Who may subscribe                                  |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------- |
| `moderation` | `photo.submitted`, `photo.deleted`, queue counts                      | `requireRole('moderator')` on that event           |
| `wall`       | `photo.published`, `photo.hidden`, `photo.rejected`, settings changes | public read of that event while `live` or `closed` |
| `guest`      | the guest's own photo changing status                                 | `requireGuest()` for that event                    |

Subscribing to `moderation` without the role is `403`. That is why a `photo.submitted`
signal never reaches the projector: the wall is not merely uninterested, it is not
permitted.

```
id: 1042
event: invalidate
data: {"topic":"wall","eventId":"evt_7f3a2c"}

: heartbeat

```

- **`id:` on every frame.** The browser stores the last one and replays it as
  `Last-Event-ID` on reconnect for free.
- **Heartbeat comment frame every 15 s.** Without it, proxies and phone radios close an
  idle stream and neither end notices — the 1.0 wall simply stopped updating with no
  visible error. `EventSource` ignores a comment frame and it costs 12 bytes.
- **`flushHeaders()` immediately** plus `X-Accel-Buffering: no`, or nginx buffers the
  stream and the first frame arrives minutes late.
- **`req.on('close')` removes the listener and clears the heartbeat timer.** A leak here
  is fatal on the projector surface, which holds one connection for eight hours, and it is
  also what lets `server.close()` resolve at shutdown.
- **Resume.** The hub keeps a bounded ring buffer of recent frame ids per event and
  replays from `Last-Event-ID + 1`. If that id has already fallen out of the buffer it
  sends one `event: resync` frame and the client does a full refetch — bounded memory, and
  a client asleep for an hour is never silently stale.

### Why the payload is a signal, not the data

`data` carries a topic, never a photo.

| Reason            | Consequence of pushing payloads instead                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorization** | One frame would need three shapes — moderator, guest, wall. A pending photo's caption pushed to the wall channel is a leak; a signal carries nothing to leak.                   |
| **Consistency**   | A dropped, duplicated or out-of-order frame cannot corrupt client state, because state always comes from an authorized `GET`. Refetch is idempotent; patch application is not.  |
| **One contract**  | The DTO presenters in `src/interface/http/presenters/` remain the only wire format. Pushed payloads would be a second serialisation to keep in sync — and the one nobody tests. |
| **Bandwidth**     | A burst of 40 uploads during a first dance collapses into one refetch, not 40 pushed rows. `useEventStream.ts` debounces invalidations per topic.                               |

The trade-off is accepted: a refetch costs one extra round trip. On a venue network a
wrong wall is expensive and 80 ms is not.

---

## 8. Composition root

`src/main/container.ts` is the only file in the repository allowed to construct an
adapter. It reads configuration once, opens infrastructure, wires use cases, and returns
the dependency object plus a shutdown function.

```ts
export const buildContainer = async (env: NodeJS.ProcessEnv): Promise<Container> => {
  const config = loadConfig(env) // zod, once, fails fast
  const logger = createPinoLogger(config)
  const db = openDatabase(config.databasePath) // WAL + foreign_keys ON
  runMigrations(db, migrations, logger) // refuses on checksum drift

  const clock = new SystemClock(),
    ids = new CryptoIdGenerator()
  const bus = new InProcessEventBus()
  const hub = new SseHub({ bus, clock, logger }) // subscribes to the bus here
  const media = new FilesystemMediaStore(config.mediaRoot)
  const images = new SharpImageProcessor(config)
  const tokens = new HmacTokenService(config.guestTokenSecret)
  const events = new SqliteEventRepository(db),
    photos = new SqlitePhotoRepository(db)
  // …guests, users, reactions, hasher, archiver

  await sweepTempDir(config.uploadTempDir, logger) // leftovers from a hard kill

  const usecases = {
    uploadPhoto: makeUploadPhoto({ events, photos, media, images, ids, clock, bus }),
    moderatePhoto: makeModeratePhoto({ photos, bus, clock }),
    // …one entry per use case, dependencies explicit at the call site
  }

  return {
    config,
    logger,
    hub,
    usecases,
    tokens,
    sessionStore: new SqliteSessionStore(db),
    shutdown: makeShutdown({ db, hub, logger }),
  }
}
```

- **Substitutability is the whole point.** A use case that constructs
  `new SqlitePhotoRepository()` cannot be given a fake, so ring 2 disappears and every
  rule test needs a database. 1.0's module-level mutable `db` in `src/database.ts` was
  exactly this failure, and it is why 1.0 shipped zero tests.
- **The object graph is readable in one file.** "What does uploading a photo actually
  depend on" is answered by twenty lines, not by grepping for `import`.
- **One boot order:** config → logger → database → migrations → adapters → use cases.
  Constructing an adapter lazily inside a handler means the first request pays for
  migrations, and a migration failure surfaces as a 500 instead of a refusal to start.
- **The lint blocks make it enforceable.** `src/main` is the only layer permitted to
  import `src/infrastructure` alongside `src/application`.

`src/interface/http/server.ts` exports `buildServer(deps)` and **never calls `listen()`** —
that is what makes the entire HTTP surface testable with supertest and zero open ports.
`src/main/index.ts` is the only file that listens.

### Graceful shutdown

```
SIGTERM / SIGINT
  1. flip a `shuttingDown` flag; a second signal → process.exit(1)  (a wedged shutdown
     must not become an unkillable process)
  2. /healthz answers 503 so a load balancer drains first
  3. server.close()   — stop accepting new connections
  4. hub.closeAll()   — end every SSE response, clear every heartbeat interval. Without
     this, step 3's callback NEVER fires: SSE responses are by design never finished.
  5. wait for in-flight requests, max config.shutdownTimeoutMs, then destroy sockets
  6. bus.removeAllListeners(); await logger.flush(); db.close() — which checkpoints the
     WAL, so the next boot does not replay it
  7. process.exit(0)
```

Step 4 is the one always forgotten and always fatal: a projector holding an eight-hour
stream keeps a "graceful" shutdown hanging forever.

---

## 9. Configuration

`src/infrastructure/config/env.ts` is the **only** module in the repository that reads
`process.env` — enforced by the `no-restricted-syntax` ban in `eslint.config.js`, which is
switched off for this one file. It exports
`loadConfig(source: Record<string, string | undefined>)`, taking the environment as an
argument so tests pass a plain object and never mutate global state.

```ts
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  DATABASE_PATH: z.string().min(1).default('data/eventslide.sqlite'),
  MEDIA_ROOT: z.string().min(1).default('data/media'),
  UPLOAD_TEMP_DIR: z.string().min(1).default('data/tmp'),
  SESSION_SECRET: z.string().min(32), // no default, ever
  GUEST_TOKEN_SECRET: z.string().min(32), // no default, ever
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(true),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15_000_000),
  MAX_UPLOAD_FILES: z.coerce.number().int().min(1).max(50).default(10),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  TRUST_PROXY: z.coerce.boolean().default(false),
  // …DEFAULT_EVENT_QUOTA_BYTES, GUEST_DELETE_GRACE_SECONDS, LOG_LEVEL,
  //   PUBLIC_BASE_URL, SHUTDOWN_TIMEOUT_MS
})
```

- **Fail fast, and report everything.** On a `safeParse` failure the flattened issue list
  prints every missing or malformed variable at once, then exits non-zero. Discovering the
  second missing secret after fixing the first, at a venue, is not acceptable.
- **No secret defaults.** `SESSION_SECRET` and `GUEST_TOKEN_SECRET` have no fallback and a
  32-character floor. 1.0 shipped `secret: sessionSecret ?? 'dev-session-secret'`, so a
  forgotten variable silently signed real sessions.
- **`TRUST_PROXY` is explicit** because `express-rate-limit` keys on the client IP.
  Trusting `X-Forwarded-For` when nothing sets it lets a client forge its own rate-limit
  bucket; not trusting it behind a reverse proxy rate-limits the whole venue as one IP.
  There is no safe default, so there is no guess.
- **`Config` is a value, passed down.** Adapters receive the fields they need through their
  constructor; nothing imports a config singleton.

---

## 10. Deliberate non-goals

| Not doing                                    | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No S3 or object storage by default**       | The deployment target is one machine in a building whose uplink is the least reliable component present; local disk keeps the wall projecting when the venue's internet dies mid-reception. `MediaStore` is a port precisely so an S3 adapter is a contained addition (`put`/`get`/`delete`/`stat`, verified by the existing contract suite) for the operator who wants it — but as a _default_ it adds credentials, egress cost, and an integration test that requires the network, for zero benefit to the common case. |
| **No user-facing multi-tenant SaaS billing** | Events are already isolated by `event_id` with cascading deletes, so the _technical_ multi-tenancy exists. Billing is a different product: plans, proration, invoices, dunning, tax, PCI scope, support burden. The deployment unit is one organisation's own server, and `quota_bytes` exists to stop a disk filling up, not to meter a customer.                                                                                                                                                                        |
| **No native mobile app**                     | A guest will not install an app for a three-hour wedding, and requiring it would lose most of the photos. Upload must work from a QR code opened in whatever browser a stranger's phone defaults to; `<input type="file" accept="image/*" capture>` covers the whole requirement, two app-store review cycles per release do not.                                                                                                                                                                                         |
| **No external identity provider**            | Hosts are two to five people per event, and guests are _deliberately_ anonymous — there is no identity to federate. A mandatory OIDC round trip to an internet IdP puts a login on the critical path at a venue with bad Wi-Fi. `express-session` + bcrypt cost 12 + a SQLite store is auditable in one file; if an operator needs SSO later, an OIDC adapter lands behind the existing authentication seam rather than replacing it.                                                                                     |
| **No `down` migrations**                     | Rolling a schema change back on a live album is a data-loss operation dressed as a safety feature. A forward fix migration is honest; restore from backup if you truly need to go back.                                                                                                                                                                                                                                                                                                                                   |
| **No CDN, no remote asset**                  | The CSP forbids it and the venue may have no working uplink. Fonts and CSS are bundled.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 11. How 1.0 differed

Every row is a real defect in the 1.0 code (now on `main`), paired with the structural
change that makes it unrepresentable rather than merely fixed.

| 1.0 defect                                                                                        | Where                                                              | 2.0 structural change                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR page emitted `?partyname=`, upload page read `?party` — every guest uploaded to `myParty`      | `frontend/pages/QRCodePage.tsx` vs `frontend/pages/UploadPage.tsx` | The join link is a **path** (`/join/:code`) resolved server-side to an `EventId`; no client-side default exists to fall back to, and it has a ring-4 and a ring-6 test                                                |
| Zero tests, CI green via `jest --passWithNoTests`                                                 | `package.json`, `.github/workflows/`                               | Six rings; `src/domain` and `src/application` gated at 100% branches; `npm run verify` = lint + typecheck + coverage + build                                                                                          |
| Module-level mutable `export let db` made everything untestable                                   | `src/database.ts`                                                  | Repositories are ports; the connection is constructed once in `src/main/container.ts` and injected. Nothing imports a database                                                                                        |
| `express-session` MemoryStore — leaks, loses every session on restart                             | `src/index.ts`                                                     | `SqliteSessionStore` on the same database, with an `expires_at` sweeper                                                                                                                                               |
| No EXIF rotation — mobile photos displayed sideways                                               | `routes/pictures.ts`                                               | `sharp(...).rotate()` before `.resize()` in `sharpImageProcessor.ts`; orientation asserted from **pixel dimensions** in a ring-6 test                                                                                 |
| No EXIF stripping — GPS of a private venue stored                                                 | `routes/pictures.ts`                                               | Re-encode without `withMetadata()`; a named test asserts GPS and device tags are absent from stored output                                                                                                            |
| `fileFilter` trusted the client MIME type                                                         | `pictureStorage.ts`                                                | `magicBytes.ts` sniffs the header before any decode; MIME and filename are never consulted, and multer has no `fileFilter` at all                                                                                     |
| Client filename normalised and joined into the storage path                                       | `pictureStorage.ts`                                                | Content-addressed, server-generated paths in `filesystemMediaStore.ts`; the original filename is metadata, never a path segment                                                                                       |
| `/api/upload` public with arbitrary `partyname`, `mkdirSync` per request, no rate limit, no quota | `pictureStorage.ts`, `routes/pictures.ts`                          | `requireGuest()` HMAC token scoped to one event; per-IP **and** per-event `express-rate-limit`; `quota_bytes` checked in `src/domain/events/quota.ts`; the media root is sharded by content hash, never by user input |
| `sharp` failing **after** the DB insert left rows with no file                                    | `routes/pictures.ts`                                               | Write → verify → insert in one synchronous `better-sqlite3` transaction, with an unwind on every exit path (§3)                                                                                                       |
| Default credentials `admin`/`password` recreated on every boot                                    | `src/database.ts`                                                  | No seeded account; first-run host creation is an explicit provisioning step, bcrypt cost 12                                                                                                                           |
| Twelve duplicated legacy HTML routes alongside `/api`                                             | `src/index.ts`                                                     | One JSON API under `/api`, mounted once in `buildServer(deps)`; the React app is the only client                                                                                                                      |
| Bootstrap from a CDN plus 186 lines of hardcoded hex CSS                                          | `index.html`, `public/app.css`                                     | CSS Modules over `web/src/design-system/tokens.css`; `helmet` CSP forbids a remote `<script>`/`<link>`                                                                                                                |
| Slideshow index in `sessionStorage` — two projectors disagreed                                    | `frontend/hooks/useSessionIndex.ts`                                | Playlist position is derived from the playlist in `src/domain/slideshow/`, so any number of projectors agree                                                                                                          |
| Ken Burns `20s` against a `10000` ms default interval — images visibly snapped                    | `public/app.css:135`, `features/useSlideshowController.ts:9`       | Both durations derive from one value in `src/domain/slideshow/`; `prefers-reduced-motion` disables the effect entirely                                                                                                |
| Photos served by `express.static` and by `sendFile` with `req.user.partyId` interpolated          | `src/index.ts`, `routes/pictures.ts`                               | `mediaRoutes.ts` looks the photo up scoped by `eventId`, checks status against the viewer's role, and streams under an explicit root — never `express.static`                                                         |
| Process-wide `EventEmitter`, partyId defaulted from a query string, no heartbeat, no `id:`        | `src/index.ts`                                                     | Per-event, per-topic channels in `sseHub.ts` with role-checked subscription, a 15 s heartbeat, `id:` on every frame, and `Last-Event-ID` resume                                                                       |
| No `helmet`, no CSP, no CSRF protection, no rate limiting                                         | `src/index.ts`                                                     | `helmet` with a strict CSP, CSRF token on state-changing requests, `express-rate-limit` on every public write, session regeneration on login                                                                          |
| `catch (err: any)`, `req.user as any` throughout                                                  | everywhere                                                         | `no-explicit-any` at error level, tests included; `unknown` and narrowing; branded ids so an `EventId` cannot be passed as a `PhotoId`                                                                                |
