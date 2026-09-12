# Security — EventSlide 2.0

Threat model and control design for the self-hosted live photo wall. Read this before
touching auth, uploads, media delivery, SSE, or anything that renders guest-supplied
content. Architecture context: [../CLAUDE.md](../CLAUDE.md) §2 and §8. Route mechanics:
[../.claude/skills/eventslide-http-endpoint/SKILL.md](../.claude/skills/eventslide-http-endpoint/SKILL.md).

## Status of this document

This specifies the **2.0 posture**. The 1.0 implementation was removed from this branch
in `fa6e9bd` and remains on `main`.

Two markers appear below, and the difference between them is the whole reason this
document can be relied on in a review:

- **(planned)** — specified, deliberately not built yet. Do not count it as a control.
- **(defect)** — specified, and the code disagrees with it. The intent stated here is
  the contract; the implementation is wrong. Every such entry also says what the code
  actually does today, so nobody plans around a control that is not there.

Everything unmarked is the contract and has been checked against the source, and code
that contradicts it is wrong. A claim here that the code does not implement is worse
than no claim at all — somebody will rely on it during a review — so an entry that
cannot be traced to a file gets deleted or marked, never left standing.

1.0 is not a baseline — it shipped a public upload endpoint, a hardcoded
`admin`/`password` account, `MemoryStore` sessions, no CSP, no rate limiting, no EXIF
stripping, and zero tests behind `jest --passWithNoTests`. It is unsupported and must
not be deployed.

## 1. Threat model

The adversary at an event is almost never a professional. It is a guest with a phone,
ten minutes, and no accountability. The model is built around that, plus one anonymous
internet scanner.

| #   | Adversary / event                                                                | Asset at risk                                           | Control                                                                                                                                                                                                                                              | Where                                                                                              |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| T1  | Bored guest with the QR code, poking at URLs                                     | other events' photos, moderation actions, host accounts | guest token grants **upload + own-photo delete on one event** and nothing else; every admin route behind `requireRole`; ids are opaque, non-enumerable `TEXT`                                                                                        | `src/interface/http/middleware/authz.ts`, `src/infrastructure/db/migrations/001_initial_schema.ts` |
| T2  | Screenshot of the join link shared outside the venue (WhatsApp, X)               | uninvited uploads, quota burn, junk on the wall         | join code is rotatable (`POST /api/events/:eventSlug/join-code`), event has `status` the host can set to closed, upload limiter keyed by IP **and** event, per-event byte quota, moderation is on by default                                         | `src/domain/events/`, `src/application/usecases/events/rotateJoinCode.ts`                          |
| T3  | Guest uploading something offensive, in front of 200 people                      | the room, the host's reputation                         | **nothing reaches the projector unpublished.** `photos.status` starts `pending`; the wall renders only `published`; the host can flip a live photo to `hidden` and the SSE invalidation drops it from every projector within one refetch             | `src/domain/photos/photoStatus.ts`, `src/interface/http/routes/streamRoutes.ts`                    |
| T4  | Scanner finds the upload endpoint and fills the disk                             | availability of the whole box, every other event on it  | upload requires a valid event-scoped token (there is **no** unauthenticated upload path in 2.0), byte and file-count limits at multer, a limiter keyed by IP **and** event, per-event `quota_bytes` that refuses a file rather than filling the disk | `src/interface/http/middleware/rateLimit.ts`, `src/application/usecases/photos/uploadPhotos.ts`    |
| T5  | Curious guest reading another event's photos                                     | confidentiality across tenants on one host              | **every** repository method takes `eventId`; media served by a controller that resolves the event from the path and 404s across events; named isolation tests at rings 3, 4 and 6                                                                    | §3                                                                                                 |
| T6  | Passive privacy exposure: GPS of a private home in EXIF                          | guests' home addresses, device serials, timestamps      | EXIF is stripped on ingest by re-encoding; orientation is baked in first; raw bytes never reach the media root                                                                                                                                       | §4                                                                                                 |
| T7  | Attacker on the venue Wi-Fi reading traffic                                      | session cookie, guest token, photos in flight           | HTTPS terminated in front of the app, `Secure` cookies in production, HSTS, `upgrade-insecure-requests`                                                                                                                                              | §11                                                                                                |
| T8  | Malicious file dressed as a photo (renamed `.php`, `.svg`, polyglot, pixel bomb) | RCE via a served payload, CPU/RAM exhaustion in `sharp` | magic bytes decide the type, dimension probe before decode, everything re-encoded to a known format, media never served from a static handler                                                                                                        | §4                                                                                                 |

**Explicitly out of scope.** A guest you invited is inside the trust boundary for
uploading; 200 people on one Wi-Fi doing the intended thing is a capacity question, not
a security one; a malicious _host_ on their own instance owns the data anyway.

## 2. Identity and authorization

Two principals, no third, and no ambient "logged in means allowed".

| Principal        | Credential                                    | Lifetime                                             | Grants                                                            |
| ---------------- | --------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Host / moderator | `express-session` cookie, SQLite-backed store | idle 12 h, rolling; absolute cap **(defect)**, below | per-event role from the membership table                          |
| Guest            | HMAC-signed device token in a cookie          | 36 h from issue, enforced at verification            | upload to **one** event; delete own photo inside the grace window |

**(defect)** An absolute session lifetime is the intent — a projector laptop is left
unlocked at a venue, and `rolling: true` alone never expires a session that keeps being
used. No such cap exists in the code: `server.ts` sets `rolling: true` with a 12 h
cookie `maxAge` and nothing checks an issued-at against a ceiling, so an active session
renews indefinitely. See §6.

### Guest token format

Verified statelessly, then confirmed against the `guests` row — which is what makes a
stateless token revocable.

```
v1.<base64url(payload)>.<base64url(HMAC-SHA256("v1." + payload, GUEST_TOKEN_SECRET))>

payload = { "e": "<event id>", "g": "<guest id>", "i": 1781038800000 }
```

Implementation: `src/infrastructure/crypto/hmacGuestTokenService.ts`.

Three details that are load-bearing rather than incidental:

- **The version prefix is inside the MAC**, not merely alongside it. Signing
  `"v1." + payload` means a v1 token cannot be replayed as a future v2 with different
  claim semantics.
- **No expiry claim in the payload.** The lifetime is a verifier-side constant (36 h,
  long enough that a token issued at the aperitif still works at 2 a.m.), so shortening
  it takes effect for every outstanding token immediately. An `exp` inside the payload
  would leave already-issued tokens on the old policy.
- **A negative age is rejected as expired.** The server issued the token, so a token
  claiming to come from the future is not clock skew — it is a token that would outlive
  its window.

| Rule                                                                                                                | Reason                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The event id, claim `e`, is inside the signed payload                                                               | the token is a capability for **one** event; there is no "guest of the server"                                        |
| Signature compared with `crypto.timingSafeEqual`                                                                    | a byte-by-byte early return is a signature oracle                                                                     |
| The MAC is compared **before** the payload is parsed                                                                | an attacker must not reach the JSON parser, or the id lookups behind it, with bytes they forged                       |
| `v1` prefix on the wire                                                                                             | the format can change without a flag day; unknown versions are rejected, not guessed                                  |
| The guest id, claim `g`, resolved against `guests` after the signature check                                        | a purely stateless token cannot be revoked                                                                            |
| Issued-at, claim `i`, is epoch milliseconds compared against a `now` the caller passes in from the injected `Clock` | keeps expiry testable (`FakeClock.advance`) with no `Date.now()` inside the adapter                                   |
| Secret separate from `SESSION_SECRET`, and at least 32 characters                                                   | a leaked guest secret must not forge host sessions, and the adapter throws on a short one rather than signing with it |

The claims are the one-letter `e` / `g` / `i` above, not `eid` / `gid`. The cookie
travels on every request from a phone on venue Wi-Fi, and the payload is base64url of
JSON, so the key names are on the wire every time.

Verification lives in `src/infrastructure/crypto/hmacGuestTokenService.ts` behind the
`GuestTokenService` port (`src/application/ports/guestTokenService.ts`). `requireGuest()`
in `src/interface/http/middleware/authz.ts` compares the token's event id with the event
resolved from `:eventSlug`: a valid token for another event is **403 `guest.wrongEvent`,
not 401**. A revoked guest is **403 `guest.revoked`**; a guest row that is gone entirely
is **401 `guestToken.malformed`**, because the event was purged and recreated and the
phone should re-join rather than be told it is forbidden forever.

### Cookie flags

| Cookie       | Purpose                  | Flags                                                                                     |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| `es_session` | host/moderator session   | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; `Max-Age` 12 h; host-only, no `Domain` |
| `es_guest`   | guest device token       | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; `Max-Age` 36 h = the token's own TTL   |
| `es_csrf`    | double-submit CSRF value | **not** `HttpOnly` (the app must read it); `SameSite=Lax; Secure` (prod); `Path=/`        |

`es_session`, not `connect.sid`: no reason to advertise the stack. The name is a single
exported constant (`SESSION_COOKIE` in `src/interface/http/routes/authRoutes.ts`) because
a browser matches a cookie deletion on name, domain and path, so a logout that cleared a
different spelling would leave the cookie in place and nothing would fail until the next
request.

The cookie's `Max-Age` and the token's own 36 h are two constants that have to agree —
`GUEST_COOKIE_MAX_AGE_MS` in `src/interface/http/routes/publicRoutes.ts` and
`DEFAULT_MAX_AGE_MS` in the adapter — because `src/interface` may not import an adapter.
A cookie outliving the token leaves a phone holding a credential the server rejects, with
nothing on screen to explain why the upload failed at midnight.

**One guest cookie, not one per event.** `es_guest` is a single name, so a device that
joins a second event overwrites the first token. That is a usability limit, not a hole:
the event id is inside the signed payload, so the surviving token is still a capability
for exactly one event and `requireGuest()` refuses it on any other. A staff member
working two concurrent events needs two browsers or two profiles.

**Self-deletion grace window.** A guest may delete their own photo for
`settings.guestSelfDeleteGraceSeconds` (default 900, i.e. 15 minutes) after `created_at`
— long enough for "wrong photo, sorry", short enough that a guest cannot retroactively
edit someone else's album. Three conditions, each owned by the entity that knows it:
`settings.allowGuestSelfDelete` is the host's veto over the whole feature, and
`photo.canBeDeletedBy(actor, now, graceMs)` in `src/domain/photos/photo.ts` requires
their own photo, inside the window, and a status of `pending` or `rejected` — pulling a
photo off the wall mid-slideshow is the host's call, so a `published` photo is refused
here and moderated instead. The middleware proves nothing about ownership; the use case
and the entity do.

### Middleware table

Everything in `src/interface/http/middleware/authz.ts`:

| Middleware                       | Grants                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `attachUser()`                   | nothing. Reads the session into a principal — identity, never permission                                                              |
| `requireUser`                    | any authenticated user, for the two routes that are not event-scoped                                                                  |
| `requireRole('owner', deps)`     | event owner only                                                                                                                      |
| `requireRole('moderator', deps)` | owner or moderator of **that** event                                                                                                  |
| `requireGuest(deps)`             | a valid HMAC device token scoped to **that** event, whose guest row exists and is not revoked                                         |
| `resolvePublicEvent(deps)`       | no principal, but only for an event whose `servesWall()` is true — a draft or archived event is a 404 to everyone                     |
| _(none)_                         | genuinely public — `POST /api/join`, `/api/health`, `/api/ready`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |

There is no `requireGuestOwnsPhoto`. Ownership is not a middleware question: the rule is
their photo, their window, and a status still off the wall, and all three live on the
entity (`photo.canBeDeletedBy`) where the use case can apply them. A middleware that
answered the first part would leave the other two to be restated somewhere.

`requireRole` resolves the event from `:eventSlug` and checks membership **of that
event**. A moderator of `gala` asking about `mariage` is **404, not 403**: a 403 would
confirm the event exists and turn the endpoint into an enumeration oracle for other
people's weddings. 403 `auth.forbidden` is reserved for a caller who _is_ a member of the
event and merely lacks the role — there it is honest and reveals nothing they did not
already know. An unauthenticated caller is 401 before the event is looked up at all, so
an anonymous request cannot be used to discover which slugs are on the box.

**A route with no explicit authorization decision is a review blocker** — reject the diff
rather than ask what was intended. Public is a decision too, written as a comment on the
route, and `eventRoutes.test.ts` asserts that a route mounted without one fails loudly.

## 3. Tenant isolation as an invariant

One box hosts many events. Isolation is not a feature; it is the thing that must not break.

| Layer   | Mechanism                                                                                                                             | Consequence                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ports   | every event-scoped method takes `eventId` **first**: `findById(eventId, photoId)`, never `findById(photoId)`                          | there is no method that _can_ return another event's row, so there is no call site to review       |
| Schema  | `event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE` plus an index leading with `event_id`, on every event-scoped table   | the cascade makes "delete this event and everything in it" atomic                                  |
| Fakes   | `FakePhotoRepository` keys its map on `(eventId, photoId)`                                                                            | a cross-tenant bug fails a ring-2 test instead of passing because a mock returned what it was told |
| Media   | served by a controller that resolves the event from the path, authorizes, then streams from an explicit root — never `express.static` | scoping applies to every byte; a hash guessed from another event is a 404                          |
| Storage | `<MEDIA_ROOT>/<eventId>/<variant>/<hash[0:2]>/<hash>.jpg` (`src/infrastructure/media/fsMediaStore.ts`)                                | the only client input in a media URL is an id, and it is looked up, never concatenated into a path |

Tests that hold the line, each with its own name and no happy-path folding:

| Ring | Test                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | shared port contract suite runs the cross-event case against **both** the fake and SQLite (`src/application/testing/contracts/photoRepositoryContract.ts`) |
| 4    | every mutating route ships happy + 401 + wrong-tenant + wrong-role + 400 (supertest)                                                                       |
| 6    | `tests/e2e/security/tenant-isolation.spec.ts` — real server, real cookie jar. It carries the guest-token scope cases too; there is no second spec file     |

## 4. Upload hardening, in order

Order is the control: each step assumes the previous one ran.

Status codes come from the kind of `DomainError` raised, mapped in one table in
`src/interface/http/presenters/send.ts`: `invalid` → 400, `unauthenticated` → 401,
`forbidden` → 403, `notFound` → 404, `conflict` → 409, `quotaExceeded` → 413,
`rateLimited` → 429, `unexpected` → 500. **There is no 415 and no 422 in the taxonomy**,
so no upload failure can answer with one. Every code below is the literal string the
client receives and maps to French in `web/src/lib/i18n/fr.ts`.

| #   | Step                                                                                                                                                                                                                                                                                                                                               | Where                                                    | Failure                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rate-limit before anything else: a flood is dropped before it costs a token verification and two repository reads                                                                                                                                                                                                                                  | `middleware/rateLimit.ts`                                | 429 `rate.limited`                                                                                                                                                               |
| 2   | Authorize: `requireGuest(deps)`, which runs **before** multer, so no byte of the body is parsed for a caller who has no standing                                                                                                                                                                                                                   | `middleware/authz.ts`                                    | 401 `auth.required`, 403 `guest.wrongEvent` / `guest.revoked`                                                                                                                    |
| 3   | `multer` into **memory**, byte limit `MAX_UPLOAD_BYTES` (default 25 000 000) per file. No `fileFilter`: it could only read `file.mimetype`, which is the client's own string and the exact 1.0 defect                                                                                                                                              | `routes/guestRoutes.ts`                                  | 413 `upload.tooLarge`                                                                                                                                                            |
| 4   | File count limit `MAX_FILES_PER_UPLOAD` (default 20), text-field ceiling `fields: 4`, and one accepted field name (`photos`)                                                                                                                                                                                                                       | same                                                     | 400 `upload.tooManyFiles` / `upload.unexpectedField`; an empty multipart is 400 `upload.noFiles`                                                                                 |
| 5   | Magic-byte identification — JPEG, PNG, GIF, WebP, and HEIC/AVIF `ftyp` brands. An allow-list: an unrecognised signature is rejected, never "probably fine"                                                                                                                                                                                         | `src/infrastructure/media/magicBytes.ts` (no dependency) | 400 `image.unsupportedFormat`, with `identifySuspicious`'s guess (`svg`, `php`, `elf`, …) in `details.detected` for the log                                                      |
| 6   | `sharp` **metadata probe** before decode, with `limitInputPixels: false` on the input so this check is the gate that decides: `width × height ≤ MAX_IMAGE_PIXELS` (default 50 000 000), each side inside `Dimensions`' 1…60 000, `pages ≤ 1`                                                                                                       | `src/infrastructure/media/sharpImageProcessor.ts`        | 413 `image.tooManyPixels`; 400 `dimensions.tooLarge` / `dimensions.tooSmall` / `dimensions.notInteger`; 400 `image.animated`; 400 `image.corrupt` when the header will not parse |
| 7   | Re-encode **three variants**, each `.rotate()` → `.resize({ fit: 'inside', withoutEnlargement: true })` → JPEG: `original` at `Dimensions.maxEdge` q92, `display` 2560 px q82, `thumb` 480 px q72. Metadata is **not** carried over                                                                                                                | same                                                     | 400 `image.renderFailed`, with the first 200 characters of the cause in `details.reason`                                                                                         |
| 8   | SHA-256 of the **re-encoded `display` bytes** → `content_hash`                                                                                                                                                                                                                                                                                     | `src/infrastructure/crypto/sha256ContentHasher.ts`       | 500 `photo.hashFailed`                                                                                                                                                           |
| 9   | Write each variant: a unique temp name in the same directory, then an atomic `rename`                                                                                                                                                                                                                                                              | `src/infrastructure/media/fsMediaStore.ts`               | 500 `photo.mediaWriteFailed`; every hash this request wrote is unlinked                                                                                                          |
| 10  | Per-guest cap `settings.maxPhotosPerGuest`, then the byte quota per file, accumulating across the batch so ten files that each fit cannot collectively overrun it. This is the **cheap** check, taken before decoding so an over-quota batch is refused without doing the work; it is not the one that enforces the limit — see 11                 | `uploadPhotos.ts`                                        | 413 `event.photoLimitReached` / `event.quotaExceeded`                                                                                                                            |
| 11  | `photos.saveManyWithinLimits(...)` — the whole batch in **one** transaction, after every byte is on disk, and the quota is re-read and compared **inside** it. That is what makes the limit hold: step 10 reads usage and then awaits three renders and three media writes per file, so two simultaneous uploads both passed it and both committed | `src/infrastructure/db/sqlitePhotoRepository.ts`         | 500 `photo.saveFailed`; the media this request wrote is unlinked                                                                                                                 |

Steps 5 to 11 run **per file**, and a refusal is recorded against that file's index
rather than failing the request: the response is `201` with one outcome per submitted
file (`stored`, `duplicate`, or `refused` with its code). A guest who picked five photos
and one screenshot of a PDF is told which one was refused and why. 1.0 failed the whole
request, and the guest re-picked six files on venue Wi-Fi.

Two steps that used to be here are gone because the code does not work that way:
multer writes to **memory**, not a temp directory, so there is no temp file to name
safely and none to unlink in a `finally`. `fileSize` is what bounds the memory that
costs, and the pipeline re-encodes every byte it accepts anyway, so a disk-backed upload
would write a file and read it straight back — then need cleanup on every exit path,
which is precisely where 1.0 leaked.

Details that are load-bearing:

- **`limitInputPixels` is deliberately off on the probe, and this is not an oversight to
  correct.** `sharp`'s own default is `0x3FFF ** 2` = 268 402 689 px and `metadata()`
  honours it, throwing `Input image exceeds pixel limit` _instead of returning a header_.
  While it was left at the default, the adapter's `catch` turned that into
  `400 image.corrupt`, so an image between `MAX_IMAGE_PIXELS` and 268 MP was refused
  correctly while anything **larger** — a 20 000 × 20 000 PNG at 400 MP, the
  decompression bomb this gate exists for — was misreported as a broken file: the
  configured budget was bypassed for exactly the inputs it was written to refuse, the
  guest read "abîmée" rather than "trop grande", and raising `MAX_IMAGE_PIXELS` past
  268 MP did nothing at all. Turning `sharp`'s limit off is safe **only because what
  replaces it is stricter and runs earlier**: `metadata()` allocates nothing for a
  header — the bomb's entire payload is a 65-byte `IHDR` — and `Dimensions`' 60 000 px edge cap and the
  `MAX_IMAGE_PIXELS` comparison both act on the declared numbers before any `resize` or
  `toBuffer` exists. Step 7 is a separate `sharp` instance that really does decode, so
  it keeps a ceiling — `MAX_IMAGE_PIXELS` itself rather than `sharp`'s unrelated
  default, which is what stops the same wrong-reason failure reappearing one step later
  as `image.renderFailed`. Ring 3 pins both halves: the bomb must answer
  `image.tooManyPixels`, and a genuinely unparsable header must still answer
  `image.corrupt`.

- **Client MIME type and filename are ignored entirely.** 1.0's `fileFilter` trusted
  `file.mimetype.startsWith('image/')`, which the client chooses. Magic bytes decide;
  the original filename is metadata at most, never a path.
- **`.rotate()` before `.resize()`, and metadata never copied.** Rotating first bakes
  orientation into pixels, so stripping metadata afterwards is safe — one step removes
  both the sideways-photo bug and the GPS leak. Do not add `.withMetadata()`.
- **Hash after re-encode, not before.** The stored bytes are what must be
  content-addressed; hashing the upload would turn two identical photos with different
  EXIF headers into two slides.
- **A double tap is a no-op, in two places.** Within one request a `seen` map catches the
  same bytes submitted twice; across requests `photos.findByContentHash(eventId, hash)`
  finds the earlier row. Either way the file's outcome is `duplicate` carrying the
  existing photo id, inside the same `201` as its siblings — not a `200` for the whole
  request, because the other four files in the batch still have outcomes of their own.
  `CREATE UNIQUE INDEX idx_photos_event_hash ON photos (event_id, content_hash)` is the
  backstop underneath, scoped per event so two events each own their copy of the same
  bytes. It is in the database and not only in code because two concurrent requests can
  both pass an application-level check — though today that genuine race surfaces as
  `500 photo.saveFailed` from the batch insert rather than as a `duplicate` outcome, so
  the duplicate is still never stored twice but the guest is told less than it could be.
- **Write-then-insert, never insert-then-write.** In 1.0 a `sharp` failure after the
  insert left rows pointing at no file. A failed ingest now leaves neither.
- **SVG is rejected, not sanitised.** It is a script container served from our own
  origin; no benefit is worth that.

## 5. Rate limits and quotas

`express-rate-limit`, with a SQLite-backed store so limits survive a restart
**(planned: the store. In the first cut the counters are in-process, which is a real gap
on a restart loop)**.

| Endpoint                                      | Per IP       | Per event      | Per guest token | Window |
| --------------------------------------------- | ------------ | -------------- | --------------- | ------ |
| `POST /api/auth/login`                        | 10           | —              | —               | 15 min |
| `GET /api/join/:code` (code lookup)           | 20           | 60             | —               | 1 min  |
| `POST /api/events/:slug/guests` (join)        | 10           | 60             | —               | 1 min  |
| `POST /api/events/:slug/photos`               | 30           | 240            | 12              | 1 min  |
| `POST /api/events/:slug/photos/:id/reactions` | 120          | 600            | 60              | 1 min  |
| `GET /api/events/:slug/stream` (SSE)          | 5 concurrent | 200 concurrent | —               | —      |

- Limits return **429** with `Retry-After` and the code `request.rateLimited`. A named
  ring-4 test asserts the status; a limiter that silently allows everything is the
  classic dead control.
- The join-code lookup is limited _per code as well as per IP_: an 8-character code is
  guessable and a botnet defeats a per-IP limit alone.
- **The quota is the disk control, not the rate limit.** `events.quota_bytes` is compared
  against `SUM(byte_size)` for the event **inside the insert transaction**, because two
  concurrent uploads can both pass a check made outside it. When it is reached the event
  stops accepting uploads and the host can raise it. Filling the disk takes down every
  other event on the box, so this is the one limit enforced transactionally.
- Each SSE subscriber is a held socket plus a heartbeat timer. The hub caps subscribers
  per event and drops the oldest idle connection rather than refusing the projector, the
  one client that must never be disconnected.

## 6. Session security

| Property                       | Value                                                                                                                                                          | Why                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Store                          | `src/infrastructure/db/sessionStore.ts`, a `Store` over `better-sqlite3`, table `sessions(sid TEXT PRIMARY KEY, expires_at TEXT NOT NULL, data TEXT NOT NULL)` | 1.0's `MemoryStore` leaked memory and logged every moderator out on restart — mid-event             |
| Pruning                        | `DELETE FROM sessions WHERE expires_at < ?` on an interval and on boot                                                                                         | an unpruned session table is both a growth and a replay problem                                     |
| Regeneration                   | `req.session.regenerate()` on **successful login**, before the user id is written                                                                              | defeats session fixation: a pre-set `es_sid` from an attacker is discarded                          |
| Timeouts                       | idle 2 h (`rolling: true`), absolute 12 h from `session.absoluteExpiresAt` checked in middleware                                                               | a projector laptop is left unlocked at a venue, and `rolling` alone never expires an active session |
| `resave` / `saveUninitialized` | `false` / `false`                                                                                                                                              | no row for an anonymous visitor; no write amplification                                             |
| Password hashing               | bcrypt cost 12                                                                                                                                                 | 1.0 used cost 10 and a hardcoded hash                                                               |
| Failed login                   | generic `auth.invalidCredentials`, and a bcrypt compare against a dummy hash when the user does not exist                                                      | otherwise response time enumerates accounts                                                         |
| Logout                         | `req.session.destroy()` **and** `res.clearCookie('es_sid')`                                                                                                    | 1.0 called `req.logout()` and left the session row behind                                           |

Passport is removed. Login is one use case (`authenticateUser`) plus one controller;
`passport.deserializeUser` hit the database on every request through a module-level
`db` singleton, was untestable, and bought nothing here.

## 7. CSRF

`SameSite=Lax` is a useful default and it is **not** sufficient here:

1. Lax still sends cookies on **top-level cross-site GET navigation** — safe only while
   no GET changes state, so every mutation is POST/PATCH/DELETE and there is no "click
   this link to publish".
2. **Same-site is not same-origin.** Operators commonly run other things on the same
   registrable domain; `blog.example.com` is same-site with `events.example.com`, so a
   compromised sibling subdomain can issue cross-origin requests carrying Lax cookies.
3. It is a **browser-side** control. Old browsers and embedded WebViews that ignore the
   attribute give us nothing, and guests arrive on whatever phone they own.

So: **double-submit token**, on top of Lax.

| Element      | Value                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Cookie       | `es_csrf`, 32 random bytes base64url, readable by JS, `SameSite=Lax`, `Secure` in prod                      |
| Header       | `X-EventSlide-CSRF`                                                                                         |
| Issued       | on session creation, on guest join, and by `GET /api/csrf` for a cold page load                             |
| Enforced     | `middleware/csrf.ts` on every request whose method is not GET/HEAD/OPTIONS, **including multipart uploads** |
| Compared     | `crypto.timingSafeEqual` on the raw bytes; mismatch or absence → 403 `request.csrfInvalid`                  |
| Also checked | `Origin` (or `Referer` when absent) against `PUBLIC_URL`, as defence in depth                               |

A cross-site attacker can make the browser _send_ the cookie but cannot _read_ it to set
the header — the same-origin policy governs reading, not sending.

Consequence for the frontend: **no native `<form method="post">` submissions**. Every
mutation goes through `web/src/lib/http.ts`, which attaches the header, so no endpoint
can be reached in a way that skips it. 1.0's form posts are gone with the legacy routes.

## 8. Content Security Policy and headers

`helmet` in `src/interface/http/server.ts`, one configuration object, no per-route
loosening.

| Directive                                 | Value                | Note                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`                             | `'none'`             | deny by default, then allow what the app actually needs                                                                                                                                                  |
| `script-src`                              | `'self'`             | no CDN, no inline, no `eval`                                                                                                                                                                             |
| `style-src`                               | `'self'`             | CSS Modules compile to files; nothing inline is needed                                                                                                                                                   |
| `style-src-attr`                          | `'unsafe-inline'`    | narrowly, because the slideshow sets `--slide-duration` as an inline custom property. This grants style **attributes** only, not `<style>` blocks — a much smaller hole than `style-src 'unsafe-inline'` |
| `img-src`                                 | `'self' blob: data:` | `blob:` is the local preview of the photo a guest just picked; `data:` for tiny inlined placeholders                                                                                                     |
| `font-src`                                | `'self'`             | fonts are bundled, self-hosted                                                                                                                                                                           |
| `connect-src`, `media-src`, `form-action` | `'self'`             | `connect-src` covers the SSE endpoint                                                                                                                                                                    |
| `frame-ancestors`, `object-src`           | `'none'`             | the moderation console must not be framed                                                                                                                                                                |
| `base-uri`                                | `'none'`             | blocks `<base>` injection that would repoint relative URLs                                                                                                                                               |
| `upgrade-insecure-requests`               | on, production only  |                                                                                                                                                                                                          |

Other headers: HSTS 180 days with `includeSubDomains` (production, behind TLS only),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `COOP: same-origin`,
`CORP: same-origin`, `Permissions-Policy: geolocation=(), microphone=(), payment=()`,
and `X-Powered-By` removed.

**The explicit consequences**, also hard constraints in [../AGENTS.md](../AGENTS.md):

- **No CDN, and no remote `<script>` or `<link>` anywhere** — not even "just for the QR
  page". Bootstrap is removed; 1.0 pulled it from a CDN and piled 186 lines of ad-hoc
  CSS with hardcoded hex colours on top. A CDN also fails silently behind venue
  captive-portal Wi-Fi, which is where guests actually are.
- **Fonts are self-hosted** in `web/src/design-system/`. `fonts.googleapis.com` is both
  a CSP hole and a third-party log of every guest's IP.
- Vite's HMR client needs a relaxed CSP in dev, keyed on `NODE_ENV !== 'production'`
  in one place; a test asserts the production policy has no `'unsafe-inline'` in
  `script-src`.
- Media responses carry `nosniff` and the stored content type. Everything is
  re-encoded, so stored bytes are never HTML: the "upload HTML, serve it from our
  origin" chain has no first link.

## 9. Privacy and GDPR-shaped obligations

Guests do not sign up, do not consent to a policy, and often do not know the software
exists. That raises the bar rather than lowering it.

| Data                                                | Why                                     | Retention                                                    |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Re-encoded photo bytes                              | the product                             | until photo delete, event purge, or `settings.retentionDays` |
| `guests.display_name` (a first name, guest-typed)   | attribution on the wall                 | with the event                                               |
| Guest device token (cookie only, `gid` in `guests`) | re-identify a device without an account | token TTL                                                    |
| `photos.caption`                                    | the guest's words                       | with the photo                                               |
| `users.email` + bcrypt hash                         | host/moderator accounts                 | until account delete                                         |
| Session rows                                        | login                                   | ≤ 12 h                                                       |

**Deliberately not stored:** EXIF of any kind (GPS, device serial, capture time), the
original filename as a path, the uploader's IP alongside the photo row, and any
third-party analytics. There is no telemetry and no outbound network call at runtime.

### Logging (`src/infrastructure/logging/`)

| Logged                                                   | Never logged                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `requestId`, method, route **pattern**, status, duration | photo bytes or base64 thumbnails                              |
| `eventId`, `photoId`, actor role                         | session ids or the `es_sid` value                             |
| domain error `code`                                      | guest tokens, CSRF tokens, `Cookie` / `Authorization` headers |
| stack traces (server-side only, with `requestId`)        | passwords or hashes, even truncated                           |
| truncated client IP (`/24`, `/64`) at `info`             | full IP at the default level                                  |

pino uses an explicit `redact` list covering `req.headers.cookie`,
`req.headers.authorization`, `*.password`, `*.token`, `*.csrf`. A full client IP is
recorded only at `debug` and only when the operator sets `LOG_IP_FULL=true`
**(planned)**: someone chasing abuse may need it, and it should be a deliberate act.
Responses never carry a stack trace, SQL fragment, or path; the error middleware logs
those against a `requestId` and returns the code only.

### Data-subject flows a host can actually perform

| Request                    | How                                                                                                                                       | Result                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| "Delete that photo of me"  | moderation console → delete, or the guest self-deletes inside the grace window                                                            | row deleted, file unlinked, SSE invalidation removes it from every projector |
| "Delete everything I sent" | filter the moderation queue by guest, bulk delete                                                                                         | all photos for that `guest_id` in that event                                 |
| "Give me my photos"        | `GET /api/events/:slug/archive` (`archiver`, streamed, owner only)                                                                        | zip of the event's photos                                                    |
| "Forget the whole event"   | delete the event → `ON DELETE CASCADE` clears photos, guests, reactions, memberships; the media sweeper removes `<MEDIA_ROOT>/<eventId>/` | nothing left but the audit line that it happened                             |
| Automatic expiry           | `settings.retentionDays`, swept hourly by `src/main/retentionSweeper.ts` and on demand by `npm run purge` (§11)                           | events age out without the host remembering                                  |

Deletion is real: `DELETE`, not a `deleted_at` column. A soft-delete of a photo someone
asked you to remove is not a deletion.

## 10. Secrets and configuration

`src/infrastructure/config/env.ts` is the **only** file that reads `process.env`: parsed
once with zod at startup, exported as a frozen typed object.

| Variable                           | Required              | Default                                | Effect                                                                 |
| ---------------------------------- | --------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `SESSION_SECRET`                   | **yes in production** | none                                   | signs `es_sid`                                                         |
| `GUEST_TOKEN_SECRET`               | **yes in production** | none                                   | HMAC key for guest tokens                                              |
| `NODE_ENV`                         | no                    | `development`                          | gates `Secure` cookies, HSTS, strict CSP                               |
| `PUBLIC_URL`                       | yes in production     | none                                   | join links, QR codes, `Origin` check                                   |
| `DATABASE_PATH` / `MEDIA_ROOT`     | no                    | `data/eventslide.sqlite`, `data/media` | see file permissions in §11                                            |
| `TRUST_PROXY`                      | no                    | `false`                                | see §11 — wrong values break rate limiting                             |
| `UPLOAD_MAX_BYTES`                 | no                    | `12582912`                             | multer limit                                                           |
| `EVENT_DEFAULT_QUOTA_BYTES`        | no                    | `5368709120`                           | new events' `quota_bytes`                                              |
| `PORT` / `LOG_LEVEL`               | no                    | `4300`, `info`                         |                                                                        |
| `RETENTION_SWEEP_INTERVAL_MINUTES` | no                    | `60`, and `off` under `NODE_ENV=test`  | how often expired events are deleted; see §11                          |
| `SCHEDULE_SWEEP_INTERVAL_MINUTES`  | no                    | `5`, and `off` under `NODE_ENV=test`   | how often scheduled openings and closings are applied; deletes nothing |

Boot refuses, loudly, when in production either secret is missing, is shorter than 32
characters, or matches a known placeholder (`change-me`, `change-me-in-production`,
`dev-session-secret`, `secret`), or when `PUBLIC_URL` is missing. 1.0's `.env.example`
shipped `change-me-in-production` next to a `sessionSecret ?? 'dev-session-secret'`
fallback, so the likely production value was a public constant. The process prints every
failing key at once and exits non-zero; it does not start degraded. Dev secrets come
from a fixed constant, which is safe only because the same code path refuses it in
production.

**There is no default account in 2.0.** 1.0 recreated `admin` / `password` on every
boot, in `initDatabase`, in production, forever. Instead: while the `users` table is
empty the server logs a one-time bootstrap token, and `POST /api/setup/owner` accepts it
once with an email and password to create the first owner. That endpoint returns 404 as
soon as an owner exists. Password rules live in `src/domain/users/`, not the controller.

## 11. Deployment posture

| Concern           | Do this                                                                                                                                 | Because                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TLS               | terminate at nginx/Caddy/Traefik; bind the app to `127.0.0.1`                                                                           | guests are on hostile Wi-Fi; the cookie and the token are bearer credentials                                                                                                                      |
| `trust proxy`     | set `TRUST_PROXY` to the number of proxies (usually `1`) or their CIDRs; never `true` on a public interface                             | `req.ip` feeds the rate limiter and `Secure` detection. With `trust proxy` too permissive, a client spoofs `X-Forwarded-For` and gets a fresh bucket per request — the limiter becomes decorative |
| Headers           | let the app own security headers; do not duplicate CSP at the proxy                                                                     | two CSPs intersect and produce a policy nobody wrote                                                                                                                                              |
| SSE               | disable proxy buffering (`proxy_buffering off`, and the app sends `X-Accel-Buffering: no`); raise read timeout above the 15 s heartbeat | a buffering proxy makes the wall look frozen                                                                                                                                                      |
| Uploads           | proxy body limit ≥ `UPLOAD_MAX_BYTES` + overhead                                                                                        | otherwise the proxy rejects before the app can return a useful error                                                                                                                              |
| File permissions  | run as a dedicated non-root user; DB `0600`, `MEDIA_ROOT` `0700`; both outside the web root                                             | the SQLite file contains session data and every hash                                                                                                                                              |
| Process hardening | systemd: `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ReadWritePaths=` the data dir                                | limits what a `sharp` or Node CVE can reach                                                                                                                                                       |
| Backups           | `npm run backup`, then copy the archive off the machine; rehearse with `npm run restore -- <archive> --dry-run`. Below.                 | copying a live WAL database yields a corrupt backup, and an untested restore is not a backup. A wedding album has no second take                                                                  |
| Updates           | pin the version, read the release notes, `npm audit` before a deploy                                                                    | see §12: self-hosted means you own patching                                                                                                                                                       |

**If the join code leaks** (screenshotted, posted, printed on the wrong sign):
`POST /api/events/:slug/join-code`, then reprint the QR — the old code stops
resolving immediately, and the join link is a server-resolved path (`/join/:code`), so
there is no stale query parameter to mislead anyone the way 1.0's `?partyname=` /
`?party` mismatch did. Know the limit: **rotation stops new joins, it does not revoke
already-issued guest tokens.** To cut off guests who already joined, revoke them or
close the event, which stops uploads outright. Anything already uploaded is sitting in
the moderation queue; nothing published itself.

### Revoking a guest

Revocation is the targeted control, and it holds on its own against the phone in the
room. Two gates, and the second is what makes the first worth pressing:

| Gate                                           | Where                                                                         | Answer                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| The token the guest is holding stops granting  | `requireGuest` (middleware) and `authenticateGuest` (use case), independently | `403 guest.revoked` on upload, delete, caption, reaction         |
| The device cannot re-join for a fresh identity | `joinEvent` (`src/application/usecases/guests/joinEvent.ts`)                  | `404 event.notFound`, no guest row, no cookie, no `guest.joined` |

`joinEvent` reads the device token the phone presents, and a token naming a **revoked
guest of this event** refuses the join instead of falling through to a new row. Without
that second gate the first was decorative: the QR code is printed on every table, so a
revoked guest re-scanned it, was handed a fresh unrevoked identity, and was uploading
again inside a few seconds — exactly what `revokeGuest.ts`'s docstring ("a revocation
that did not actually stop the next upload would be the worst possible outcome for a
host standing in front of a projector") exists to prevent.

**The refusal explains nothing, deliberately.** It is the same `404 event.notFound` an
unknown code gets, byte for byte, and the guest reads the same French line a rotated code
produces. Refusing and explaining are separable, and the person reading this answer is a
guest who has just been ejected, standing in a room full of people: a distinct
`guest.revoked` here would buy a host marginally easier debugging — the moderation
console already shows the revoked row, and the revoked guest's own upload attempts
already answer `guest.revoked` — at the price of confirming, on a screen someone may be
reading over their shoulder, that they were specifically cut off. The check runs before
the display name is parsed, so the refusal does not vary with what was typed alongside
it. Revocation is scoped to the event that issued the token, like every other guest rule
here: being removed from the gala is not a ban from the wedding.

**The residual limit, stated plainly: this stops the re-scan, not the determined
evader.** Revocation is tied to the device token in the cookie, so a guest who clears
cookies, opens a private window, or borrows another phone arrives as a new device and
therefore a new guest with the code still printed on the table. That is inherent to
anonymous, account-free identity and is the accepted risk in §12 ("Guest identity is a
device cookie, not a person"). The host's mental model should be **"revoking stops them
until they work at it"**. Against somebody willing to work at it, pair revocation with a
join-code rotation — revoke, then `POST /api/events/:slug/join-code` and reprint — or
close the event. Rotation denies a new identity to everybody, including the guests who
have not joined yet, which is why revocation and not rotation is the first thing to reach
for.

Covered at ring 2 (`joinEvent.test.ts`, "a phone the host revoked": the refusal, its
indistinguishability from an unknown code, no new row, no announcement, and the ordinary
and cross-event paths still working) and at ring 4 (`publicRoutes.test.ts`: the same 404
with no `Set-Cookie` and no second guest row).

### Automatic retention

An event's `settings.retentionDays` is a promise made to people who never signed up for
anything: the consent notice, the host's own answer to "what happens to these photos",
and the GDPR storage-limitation obligation in §9 all rest on it. Until it had a trigger
it was a lie — `purgeExpiredEvents` was written and tested and nothing called it, so a
host who set "delete after 30 days" was shown a confirmation and their guests' photos
stayed on the disk indefinitely.

Two triggers now, for two kinds of operator:

| Trigger                                              | Owns the schedule       | Use it when                                                                                                          |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| In-process sweep, hourly by default                  | the application         | the ordinary single-box install — `docker compose up` honours retention with nothing else configured                 |
| `npm run purge` (`npm run purge:dry-run` to preview) | cron or a systemd timer | you want the schedule outside the app — then set `RETENTION_SWEEP_INTERVAL_MINUTES=off` — or you need the answer now |

Both run the same use case, so the two can never disagree about what is due.

**Disabling it takes the word `off`.** `RETENTION_SWEEP_INTERVAL_MINUTES=0` and an empty
value are refused at boot, deliberately: every other numeric setting here is coerced with
`Number()`, which reads an empty string as `0`, so a dangling variable in a compose file
or a template that rendered blank would silently switch off a deletion the host promised
— and the only symptom would be that nothing happens. A boot log always says which
arrangement is in force (`retention sweep scheduled`, or `automatic retention sweep is
off`).

What the sweep guarantees, and what it does not:

- **It never runs twice at once.** The deletions are recursive directory removals; two
  sweeps over one event would leave a half-deleted media root and two contradictory
  reports. A tick arriving while the previous sweep is still working is skipped and
  logged — an operator seeing that line should lengthen the interval.
- **It is abandoned at SIGTERM, not awaited**, so shutdown stays inside `docker stop`'s
  ten seconds. This is safe because the sweep is resumable: it deletes media then the
  row, one event at a time, so an interrupted event still has its row and is returned
  again by the next run, and `MediaStore.deleteEvent` is idempotent. The timer is
  `unref`'d for the same reason — an un-`unref`'d hourly interval would keep the process
  alive long past the shutdown backstop.
- **It reports what it did.** Purged ids at `info` — after that line there is nothing
  left to look them up in — and failed ids at `error`, which is the only signal an
  operator gets that a disk is full, read-only or wedged. Nothing is lost when a purge
  fails; the next sweep retries it.
- **It is off by default under `NODE_ENV=test`**, because the end-to-end suite boots this
  same binary and a background deletion mid-journey would be both a flaky test and a
  misleading one.
- **It deletes; it does not export.** Retention and the backup/restore path in this
  section are two halves of one control. Purging on a schedule without a tested restore
  is how a wedding album disappears for good — take the archive first.

Running `npm run purge` while the server is up is safe: the deletions are per-event and
idempotent, so the worst a race with the in-process sweep produces is an event reported
as failed by one of them because the other had already removed it.

### Backup and restore

This section used to tell an operator to run `VACUUM INTO` by hand and rsync
`MEDIA_ROOT`. The reasoning was right and the instructions were the wrong shape: two
manual steps whose agreement with each other nobody checks, and no way to find out
whether the result is intact short of restoring it somewhere.

```bash
npm run backup                          # -> ./backups/eventslide-<timestamp>/
npm run backup -- --to /mnt/usb/mariage
npm run backup:verify -- <archive>      # re-check one later; --quick for sizes only
npm run restore -- <archive> --dry-run  # verify and print the plan, write nothing
npm run restore -- <archive> --force    # required to overwrite anything
```

The server may keep running during a backup. That is the case that matters — a host
takes the backup mid-event, not after — and it is the case a file copy gets wrong:
`VACUUM INTO` writes a consistent snapshot of an **open** database, while
`cp data/eventslide.sqlite` yields a file missing everything still in `-wal`. The
end-to-end proof of the round trip backs up a live server, destroys both halves and boots
a second server on what came back.

**The archive is a directory**, not a zip: the snapshot has to land on a path anyway
(`VACUUM INTO` cannot write to a stream), photos are already compressed so a zip buys
nothing, and a directory can be rsynced, resumed and inspected at 2am.

```
<archive>/manifest.json          counts, SHA-256 checksums, the migration ledger
<archive>/database.sqlite        the snapshot
<archive>/media/<eventId>/<variant>/<ab>/<contentHash>.jpg
```

**The database is captured first, and the skew that leaves is the recoverable one.** The
two halves cannot be captured at the same instant. Database first means a photo uploaded
during the backup has bytes in the archive and no row — dead weight, harmless. Media
first would mean a row with no bytes, which restores as a broken album and which nothing
notices until a guest looks for their photo. The other direction is covered rather than
ignored: every photo row in the snapshot is checked against the media actually copied,
and any gap is listed by photo id in the manifest and printed by the command. A photo
deleted while the backup ran looks exactly like that and is harmless; any other cause is
a gap that already existed on disk.

**What "verifiable" covers.** `backup` re-reads every byte it just wrote before it
reports success, and `restore` verifies the whole archive before it touches anything.
Together that catches a missing or unreadable manifest, a database that is absent, the
wrong length or no longer the one that was backed up, a database that fails
`PRAGMA integrity_check`, any media file that is missing, truncated or altered, an entry
list that has been truncated (the manifest carries a digest of its own entry list), and
an archive whose migration ledger this build would refuse at boot — the case where a
restore otherwise succeeds and the server then will not start.

**What it does not cover, stated plainly**, because a backup check that oversells itself
is worse than none:

- **Tampering with the contents.** The checksums are unkeyed, so anyone who can edit the
  archive can recompute them — the digest over the entry list included. This detects
  damage, not an adversary. The one thing it does refuse is where a manifest _points_:
  an entry path and the database filename are constrained when the manifest is parsed
  (no `..`, no absolute or drive-relative path, no backslash, no control character), so
  an archive cannot name a location outside itself and make the restore write there.
  That is a containment rule, not authentication — see the accepted risk in §12.
- **A faithful copy of already-wrong data.** `integrity_check` proves the B-trees are
  sound, not that the album is the one you remember.
- **Rot after the check.** A verified archive is a statement about one moment; re-verify
  before relying on it, which is why `restore` re-verifies rather than trusting the
  result printed when the archive was written.
- **Everything outside these two paths.** `.env` is not in the archive. Restoring into an
  instance with a different `GUEST_TOKEN_SECRET` invalidates every outstanding guest
  token, and a different `SESSION_SECRET` signs every host out. Back the secrets up
  separately, and somewhere else.

**Restore is built to be hard to use by accident.** It refuses outright if the target
still holds a database or any media, and `--force` prints what it is about to destroy —
paths, file counts, sizes — in the output rather than burying it in `--help`. The
database goes in via a temporary sibling and a rename, so an interrupted restore leaves
the previous one where it was. It warns when a `-wal` or `-shm` is present, which
usually means a server is still running: stop it first, because replacing the file
underneath a live process leaves the wall serving neither database.

**The media half has one window, and it is named rather than hidden.** The media root is
replaced in place — copying several gigabytes twice to buy atomicity is not a price a
self-hosted box can pay — so between the first file and the last, the target holds
neither the old media nor all of the new. Verification runs in full before anything is
destroyed, so that window is only ever entered on an archive already proven complete. If
a copy is cut short anyway — the USB stick goes, the disk fills — the error names the
archive, says the target is now incomplete, and says the thing that is actually
actionable at 2am: **once the cause is fixed, re-running the same restore with `--force`
finishes the job.** The copy is idempotent, so nothing is lost while the archive is still
readable. The caveat is not pedantry: that holds for a transient failure — a disconnected
drive, a momentarily full disk — and not for a deterministic one, such as a target
filesystem that cannot hold a name or a permission the operator does not have. A failure
that repeats is a property of the target, not of the archive.

**Treat the archive as you treat the database.** It contains every password hash, every
session row and every photograph — `chmod 0600` on the files, `0700` on the directory,
and off this machine, since a backup on the same disk survives everything except the
thing most likely to happen to it.

One operational limitation, shared with `npm run db:migrate`: these are `tsx` scripts, so
the pruned production container does not carry them. Run them from a source checkout and
point them at the data with `--database` and `--media` — the commands need no running
server and no configuration beyond those two paths.

## 12. Accepted risks

Stated plainly: a threat model that claims to cover everything covers nothing.

| Risk                                                                | Why it is accepted                                                                                                                                                                                                                                                    | Partial mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A guest with the join code can upload anything                      | that is the product; the alternative is per-guest accounts, which kills the zero-friction requirement                                                                                                                                                                 | moderation before projection, per-guest rate limit, host can revoke a guest — and a revoked device is refused at the join endpoint too, so the code alone no longer undoes it (§11)     |
| A leaked display URL exposes published photos **and the join code** | the wall doubles as the invitation — the empty state exists to tell the room how to join, and someone arriving at 23:00 has only the screen to read. Withholding the code there would break the product to protect what the QR code on every table already gives away | only `published` photos are ever served; the host can rotate the join code, which invalidates it immediately; display access can require the join code for private events **(planned)** |
| Guest identity is a device cookie, not a person                     | anonymity is a feature; a cleared cookie means a new guest, and a shared phone means a shared identity. This is also the ceiling on revocation (§11): it refuses the revoked **device**, so clearing cookies or borrowing a phone is a new guest with the same code   | grace-window deletion is deliberately short, so a mis-attributed identity has a narrow blast radius; revocation stops the re-scan, and a join-code rotation is what stops the evader    |
| Captions and display names are guest-supplied text on a 3 m screen  | pre-moderating text as well as photos would slow the wall to uselessness                                                                                                                                                                                              | length-bounded, control characters stripped in the domain, rendered as text (React escapes; no `dangerouslySetInnerHTML` anywhere), and the host can hide any photo instantly           |
| Rate-limit state is in-process in the first cut                     | a restart resets buckets                                                                                                                                                                                                                                              | quota is transactional and survives restarts; SQLite-backed limiter store is **(planned)**                                                                                              |
| Self-hosted operators own their own patching, TLS, and backups      | there is no hosted control plane to push a fix from                                                                                                                                                                                                                   | pinned dependencies, published advisories, and boot-time config refusal so a misconfigured instance never starts quietly                                                                |
| A backup archive is untrusted input with unauthenticated checksums  | signing needs a key, and a key kept beside the archive signs nothing; a self-hosted operator has nowhere to put one that a machine restoring after a total loss can still reach. An archive stays usable by whoever holds it, which is what an attacker uses          | paths are constrained at the parse, so an archive no longer chooses where the restore writes; contents are another matter, so restore only from a copy you control (§11)                |
| A malicious host can read every photo in their own event            | they organised the event; the data is theirs                                                                                                                                                                                                                          | per-event roles limit _moderators_ to their own events                                                                                                                                  |

## 13. Reporting a vulnerability

|                        |                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Where                  | GitHub Security Advisories on `Irony42/EventSlide` — "Report a vulnerability" (private). Do **not** open a public issue      |
| Include                | commit or tag, environment, reproduction steps, impact, and whether it needs the join code or a session                      |
| Acknowledgement        | best effort within 5 business days; this is a small self-hosted project, not a vendor with an on-call rota                   |
| Fix or mitigation plan | targeted within 30 days of confirmation, published as an advisory with the affected versions                                 |
| Please do not          | test against a live event you do not own, exfiltrate other people's photos to prove a point, or load-test someone's instance |
| Scope                  | this repository. Reports about the operator's reverse proxy, OS, or network belong to that operator                          |
| Supported versions     | `2.0.x` only. `1.x` is unpatched (see Status, above) — upgrade rather than report                                            |
