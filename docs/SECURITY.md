# Security — EventSlide 2.0

Threat model and control design for the self-hosted live photo wall. Read this before
touching auth, uploads, media delivery, SSE, or anything that renders guest-supplied
content. Architecture context: [../CLAUDE.md](../CLAUDE.md) §2 and §8. Route mechanics:
[../.claude/skills/eventslide-http-endpoint/SKILL.md](../.claude/skills/eventslide-http-endpoint/SKILL.md).

## Status of this document

This specifies the **target 2.0 posture**. The 2.0 tree is under construction; `src/` on
this branch still holds the 1.0 code being replaced. Controls decided and specified here
but not yet merged are marked **(planned)**; everything else is the contract, and code
that contradicts a rule below is wrong. 1.0 is not a baseline — it shipped a public
upload endpoint, a hardcoded `admin`/`password` account, `MemoryStore` sessions, no CSP,
no rate limiting, no EXIF stripping, and zero tests behind `jest --passWithNoTests`. It
is unsupported and must not be deployed.

## 1. Threat model

The adversary at an event is almost never a professional. It is a guest with a phone,
ten minutes, and no accountability. The model is built around that, plus one anonymous
internet scanner.

| #   | Adversary / event                                                                | Asset at risk                                           | Control                                                                                                                                                                                                                                  | Where                                                                                              |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| T1  | Bored guest with the QR code, poking at URLs                                     | other events' photos, moderation actions, host accounts | guest token grants **upload + own-photo delete on one event** and nothing else; every admin route behind `requireRole`; ids are opaque, non-enumerable `TEXT`                                                                            | `src/interface/http/middleware/authz.ts`, `src/infrastructure/db/migrations/001_initial_schema.ts` |
| T2  | Screenshot of the join link shared outside the venue (WhatsApp, X)               | uninvited uploads, quota burn, junk on the wall         | join code is rotatable (`POST /api/events/:slug/join-code/rotate`), event has `status` the host can set to closed, per-event rate limit and byte quota, moderation is on by default                                                      | `src/domain/events/`, `src/application/usecases/events/rotateJoinCode.ts`                          |
| T3  | Guest uploading something offensive, in front of 200 people                      | the room, the host's reputation                         | **nothing reaches the projector unpublished.** `photos.status` starts `pending`; the wall renders only `published`; the host can flip a live photo to `hidden` and the SSE invalidation drops it from every projector within one refetch | `src/domain/photos/photoStatus.ts`, `src/interface/http/routes/streamRoutes.ts`                    |
| T4  | Scanner finds the upload endpoint and fills the disk                             | availability of the whole box, every other event on it  | upload requires a valid event-scoped token (there is **no** unauthenticated upload path in 2.0), byte limits at multer, per-IP and per-event rate limits, per-event `quota_bytes` that closes uploads instead of filling the disk        | `src/interface/http/middleware/rateLimit.ts`, `src/application/usecases/photos/uploadPhoto.ts`     |
| T5  | Curious guest reading another event's photos                                     | confidentiality across tenants on one host              | **every** repository method takes `eventId`; media served by a controller that resolves the event from the path and 404s across events; named isolation tests at rings 3, 4 and 6                                                        | §3                                                                                                 |
| T6  | Passive privacy exposure: GPS of a private home in EXIF                          | guests' home addresses, device serials, timestamps      | EXIF is stripped on ingest by re-encoding; orientation is baked in first; raw bytes never reach the media root                                                                                                                           | §4                                                                                                 |
| T7  | Attacker on the venue Wi-Fi reading traffic                                      | session cookie, guest token, photos in flight           | HTTPS terminated in front of the app, `Secure` cookies in production, HSTS, `upgrade-insecure-requests`                                                                                                                                  | §11                                                                                                |
| T8  | Malicious file dressed as a photo (renamed `.php`, `.svg`, polyglot, pixel bomb) | RCE via a served payload, CPU/RAM exhaustion in `sharp` | magic bytes decide the type, dimension probe before decode, everything re-encoded to a known format, media never served from a static handler                                                                                            | §4                                                                                                 |

**Explicitly out of scope.** A guest you invited is inside the trust boundary for
uploading; 200 people on one Wi-Fi doing the intended thing is a capacity question, not
a security one; a malicious _host_ on their own instance owns the data anyway.

## 2. Identity and authorization

Two principals, no third, and no ambient "logged in means allowed".

| Principal        | Credential                                    | Lifetime                                                                          | Grants                                                            |
| ---------------- | --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Host / moderator | `express-session` cookie, SQLite-backed store | idle 2 h rolling, absolute 12 h                                                   | per-event role from the membership table                          |
| Guest            | HMAC-signed device token in a cookie          | event's `settings.guestTokenTtlHours` (default 24 h), never past event end + 24 h | upload to **one** event; delete own photo inside the grace window |

### Guest token format

Opaque to the client, verified statelessly, then confirmed against the `guests` row.

```
es.g1.<base64url(payload)>.<base64url(HMAC-SHA256(payload, GUEST_TOKEN_SECRET))>

payload = { "v": 1, "eid": "<event id>", "gid": "<guest id>",
            "iat": "2026-06-20T20:14:03.000Z", "exp": "2026-06-21T20:14:03.000Z" }
```

| Rule                                                           | Reason                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `eid` is inside the signed payload                             | the token is a capability for **one** event; there is no "guest of the server"       |
| Signature compared with `crypto.timingSafeEqual`               | a byte-by-byte early return is a signature oracle                                    |
| `v` prefix on the wire                                         | the format can change without a flag day; unknown versions are rejected, not guessed |
| `gid` resolved against `guests` after the signature check      | a purely stateless token cannot be revoked                                           |
| Timestamps ISO-8601 UTC, compared against the injected `Clock` | matches the DB convention, keeps expiry testable (`FakeClock.advance`)               |
| Secret separate from `SESSION_SECRET`                          | a leaked guest secret must not forge host sessions                                   |

Verification lives in `src/infrastructure/crypto/guestTokenService.ts` behind the
`GuestTokenService` port. `requireGuest()` compares the token's `eid` with the event
resolved from `:eventSlug`: a valid token for another event is **403, not 401**.

### Cookie flags

| Cookie               | Purpose                  | Flags                                                                     |
| -------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `es_sid`             | host/moderator session   | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; host-only, no `Domain` |
| `es_guest_<eventId>` | guest device token       | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; `Max-Age` = token TTL  |
| `es_csrf`            | double-submit CSRF value | **not** `HttpOnly` (the app must read it); `SameSite=Lax; Secure` (prod)  |

`es_sid`, not `connect.sid`: no reason to advertise the stack. One guest cookie **per
event** lets a staff member be a guest at two concurrent events without one token
overwriting the other.

**Self-deletion grace window.** A guest may delete their own photo for
`settings.guestDeleteGraceMinutes` (default 15) after `created_at` — long enough for
"wrong photo, sorry", short enough that a guest cannot retroactively edit someone else's
album. The rule is a pure function on the entity,
`photo.deletableByGuest(now, graceMinutes)` in `src/domain/photos/photo.ts`; the
middleware only proves ownership.

### Middleware table

| Middleware                 | Grants                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| `requireRole('owner')`     | event owner only                                                           |
| `requireRole('moderator')` | owner or moderator of **that** event                                       |
| `requireGuest()`           | a valid HMAC device token scoped to **that** event                         |
| `requireGuestOwnsPhoto()`  | guest token + photo authored by that token, inside the grace window        |
| _(none)_                   | genuinely public — join lookup, health, the display wall of a public event |

`requireRole` resolves the event from `:eventSlug` and checks membership **of that
event**; a moderator of `gala` is 403 on `mariage`. **A route with no explicit
authorization decision is a review blocker** — reject the diff rather than ask what was
intended. Public is a decision too, written as a comment on the route.

## 3. Tenant isolation as an invariant

One box hosts many events. Isolation is not a feature; it is the thing that must not break.

| Layer   | Mechanism                                                                                                                             | Consequence                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ports   | every event-scoped method takes `eventId` **first**: `findById(eventId, photoId)`, never `findById(photoId)`                          | there is no method that _can_ return another event's row, so there is no call site to review       |
| Schema  | `event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE` plus an index leading with `event_id`, on every event-scoped table   | the cascade makes "delete this event and everything in it" atomic                                  |
| Fakes   | `FakePhotoRepository` keys its map on `(eventId, photoId)`                                                                            | a cross-tenant bug fails a ring-2 test instead of passing because a mock returned what it was told |
| Media   | served by a controller that resolves the event from the path, authorizes, then streams from an explicit root — never `express.static` | scoping applies to every byte; a hash guessed from another event is a 404                          |
| Storage | `<MEDIA_ROOT>/<eventId>/<hash[0:2]>/<hash>.jpg`                                                                                       | the only client input in a media URL is an id, and it is looked up, never concatenated into a path |

Tests that hold the line, each with its own name and no happy-path folding:

| Ring | Test                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | shared port contract suite runs the cross-event case against **both** the fake and SQLite (`src/application/testing/contracts/photoRepositoryContract.ts`) |
| 4    | every mutating route ships happy + 401 + wrong-tenant + wrong-role + 400 (supertest)                                                                       |
| 6    | `tests/e2e/security/tenant-isolation.spec.ts`, `guest-token-scope.spec.ts` — real server, real cookie jar                                                  |

## 4. Upload hardening, in order

Order is the control: each step assumes the previous one ran.

| #   | Step                                                                                                                                              | Where                                                    | Failure                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- |
| 1   | Authorize first: `requireGuest()` (or `requireRole('moderator')` for host uploads) before a byte is read                                          | `middleware/authz.ts`                                    | 401 / 403                        |
| 2   | `multer` byte limit `UPLOAD_MAX_BYTES` (default 12 MiB per file) into a **temp dir**, server-generated names                                      | `middleware/upload.ts`                                   | 413 `upload.tooLarge`            |
| 3   | File count limit (`files: 5`), field count and field size limits                                                                                  | same                                                     | 400 `upload.tooManyFiles`        |
| 4   | Magic-byte identification — JPEG, PNG, WebP, HEIC/AVIF brands only                                                                                | `src/infrastructure/media/magicBytes.ts` (no dependency) | 415 `upload.unsupportedType`     |
| 5   | `sharp` **metadata probe** before decode: `width × height ≤ 80 MP`, each side ≤ 20 000 px, `pages === 1`, plus `limitInputPixels` on the pipeline | `src/infrastructure/media/sharpImageProcessor.ts`        | 413 `upload.imageTooLarge`       |
| 6   | Re-encode: `.rotate()` → resize `fit: 'inside'` to 2560 px → encode JPEG q82. Metadata is **not** carried over                                    | same                                                     | 422 `upload.undecodable`         |
| 7   | SHA-256 of the **re-encoded** bytes → `content_hash`                                                                                              | `src/infrastructure/crypto/hashing.ts`                   | —                                |
| 8   | Write the file to the media root → verify its size on disk                                                                                        | `src/infrastructure/media/filesystemMediaStore.ts`       | 500, temp + partial file removed |
| 9   | One transaction: quota check against `countBytes(eventId)`, then insert the row                                                                   | `uploadPhoto.ts`                                         | 413 `event.quotaExceeded`        |
| 10  | `try/finally` unlink of the temp file on **every** path, success included                                                                         | `middleware/upload.ts`                                   | —                                |

Details that are load-bearing:

- **Client MIME type and filename are ignored entirely.** 1.0's `fileFilter` trusted
  `file.mimetype.startsWith('image/')`, which the client chooses. Magic bytes decide;
  the original filename is metadata at most, never a path.
- **`.rotate()` before `.resize()`, and metadata never copied.** Rotating first bakes
  orientation into pixels, so stripping metadata afterwards is safe — one step removes
  both the sideways-photo bug and the GPS leak. Do not add `.withMetadata()`.
- **Hash after re-encode, not before.** The stored bytes are what must be
  content-addressed; hashing the upload would turn two identical photos with different
  EXIF headers into two slides.
- **`UNIQUE (event_id, content_hash)`** makes a double tap a no-op: the insert
  conflicts, the use case returns the existing photo, the response is `200` with the
  same id instead of `201`. Enforced in the database, not only in code, because two
  concurrent requests can both pass an application-level check.
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
| Automatic expiry           | `settings.retentionDays` with a purge job in `src/main/` **(planned)**                                                                    | events age out without the host remembering                                  |

Deletion is real: `DELETE`, not a `deleted_at` column. A soft-delete of a photo someone
asked you to remove is not a deletion.

## 10. Secrets and configuration

`src/infrastructure/config/env.ts` is the **only** file that reads `process.env`: parsed
once with zod at startup, exported as a frozen typed object.

| Variable                       | Required              | Default                                | Effect                                     |
| ------------------------------ | --------------------- | -------------------------------------- | ------------------------------------------ |
| `SESSION_SECRET`               | **yes in production** | none                                   | signs `es_sid`                             |
| `GUEST_TOKEN_SECRET`           | **yes in production** | none                                   | HMAC key for guest tokens                  |
| `NODE_ENV`                     | no                    | `development`                          | gates `Secure` cookies, HSTS, strict CSP   |
| `PUBLIC_URL`                   | yes in production     | none                                   | join links, QR codes, `Origin` check       |
| `DATABASE_PATH` / `MEDIA_ROOT` | no                    | `data/eventslide.sqlite`, `data/media` | see file permissions in §11                |
| `TRUST_PROXY`                  | no                    | `false`                                | see §11 — wrong values break rate limiting |
| `UPLOAD_MAX_BYTES`             | no                    | `12582912`                             | multer limit                               |
| `EVENT_DEFAULT_QUOTA_BYTES`    | no                    | `5368709120`                           | new events' `quota_bytes`                  |
| `PORT` / `LOG_LEVEL`           | no                    | `4300`, `info`                         |                                            |

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
| Backups           | `sqlite3 data/eventslide.sqlite "VACUUM INTO 'backup.sqlite'"` plus an rsync of `MEDIA_ROOT`; test a restore before the event           | copying a live WAL database yields a corrupt backup. A wedding album has no second take                                                                                                           |
| Updates           | pin the version, read the release notes, `npm audit` before a deploy                                                                    | see §12: self-hosted means you own patching                                                                                                                                                       |

**If the join code leaks** (screenshotted, posted, printed on the wrong sign):
`POST /api/events/:slug/join-code/rotate`, then reprint the QR — the old code stops
resolving immediately, and the join link is a server-resolved path (`/join/:code`), so
there is no stale query parameter to mislead anyone the way 1.0's `?partyname=` /
`?party` mismatch did. Know the limit: **rotation stops new joins, it does not revoke
already-issued guest tokens.** To cut off guests who already joined, revoke them (the
`gid` lookup then fails) or close the event, which stops uploads outright. Anything
already uploaded is sitting in the moderation queue; nothing published itself.

## 12. Accepted risks

Stated plainly: a threat model that claims to cover everything covers nothing.

| Risk                                                                | Why it is accepted                                                                                                                                                                                                                                                    | Partial mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A guest with the join code can upload anything                      | that is the product; the alternative is per-guest accounts, which kills the zero-friction requirement                                                                                                                                                                 | moderation before projection, per-guest rate limit, host can revoke a guest                                                                                                             |
| A leaked display URL exposes published photos **and the join code** | the wall doubles as the invitation — the empty state exists to tell the room how to join, and someone arriving at 23:00 has only the screen to read. Withholding the code there would break the product to protect what the QR code on every table already gives away | only `published` photos are ever served; the host can rotate the join code, which invalidates it immediately; display access can require the join code for private events **(planned)** |
| Guest identity is a device cookie, not a person                     | anonymity is a feature; a cleared cookie means a new guest, and a shared phone means a shared identity                                                                                                                                                                | grace-window deletion is deliberately short, so a mis-attributed identity has a narrow blast radius                                                                                     |
| Captions and display names are guest-supplied text on a 3 m screen  | pre-moderating text as well as photos would slow the wall to uselessness                                                                                                                                                                                              | length-bounded, control characters stripped in the domain, rendered as text (React escapes; no `dangerouslySetInnerHTML` anywhere), and the host can hide any photo instantly           |
| Rate-limit state is in-process in the first cut                     | a restart resets buckets                                                                                                                                                                                                                                              | quota is transactional and survives restarts; SQLite-backed limiter store is **(planned)**                                                                                              |
| Self-hosted operators own their own patching, TLS, and backups      | there is no hosted control plane to push a fix from                                                                                                                                                                                                                   | pinned dependencies, published advisories, and boot-time config refusal so a misconfigured instance never starts quietly                                                                |
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
