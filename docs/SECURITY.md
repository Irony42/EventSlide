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

| #   | Adversary / event                                                                                                         | Asset at risk                                                                                             | Control                                                                                                                                                                                                                                                                                                         | Where                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| T1  | Bored guest with the QR code, poking at URLs                                                                              | other events' photos, moderation actions, host accounts                                                   | guest token grants **upload + own-photo delete on one event** and nothing else; every admin route behind `requireRole`; ids are opaque, non-enumerable `TEXT`                                                                                                                                                   | `src/interface/http/middleware/authz.ts`, `src/infrastructure/db/migrations/001_initial_schema.ts` |
| T2  | Screenshot of the join link shared outside the venue (WhatsApp, X)                                                        | uninvited uploads, quota burn, junk on the wall                                                           | join code is rotatable (`POST /api/events/:eventSlug/join-code`), event has `status` the host can set to closed, upload limiter keyed by IP **and** event, per-event byte quota, moderation is on by default                                                                                                    | `src/domain/events/`, `src/application/usecases/events/rotateJoinCode.ts`                          |
| T3  | Guest uploading something offensive, in front of 200 people                                                               | the room, the host's reputation                                                                           | **nothing reaches the projector unpublished.** `photos.status` starts `pending`; the wall renders only `published`; the host can flip a live photo to `hidden` and the SSE invalidation drops it from every projector within one refetch                                                                        | `src/domain/photos/photoStatus.ts`, `src/interface/http/routes/streamRoutes.ts`                    |
| T4  | Scanner finds the upload endpoint and fills the disk                                                                      | availability of the whole box, every other event on it                                                    | upload requires a valid event-scoped token (there is **no** unauthenticated upload path in 2.0), byte and file-count limits at multer, a limiter keyed by IP **and** event, per-event `quota_bytes` that refuses a file rather than filling the disk                                                            | `src/interface/http/middleware/rateLimit.ts`, `src/application/usecases/photos/uploadPhotos.ts`    |
| T5  | Curious guest reading another event's photos                                                                              | confidentiality across tenants on one host                                                                | **every** repository method takes `eventId`; media served by a controller that resolves the event from the path and 404s across events; named isolation tests at rings 3, 4 and 6                                                                                                                               | §3                                                                                                 |
| T6  | Passive privacy exposure: GPS of a private home in EXIF                                                                   | guests' home addresses, device serials, timestamps                                                        | EXIF is stripped on ingest by re-encoding; orientation is baked in first; raw bytes never reach the media root                                                                                                                                                                                                  | §4                                                                                                 |
| T7  | Attacker on the venue Wi-Fi reading traffic                                                                               | session cookie, guest token, photos in flight                                                             | HTTPS terminated in front of the app, `Secure` cookies in production, HSTS, `upgrade-insecure-requests`                                                                                                                                                                                                         | §11                                                                                                |
| T8  | Malicious file dressed as a photo (renamed `.php`, `.svg`, polyglot, pixel bomb)                                          | RCE via a served payload, CPU/RAM exhaustion in `sharp`                                                   | magic bytes decide the type, dimension probe before decode, everything re-encoded to a known format, media never served from a static handler                                                                                                                                                                   | §4                                                                                                 |
| T9  | Malicious **video**: a crafted container that makes the box fetch a URL, a decoder bomb, a clip carrying a second payload | SSRF from a guest upload, a wedged encoder holding a core all evening, a polyglot served back to the room | the signature decides the container before a byte is staged; the demuxer is **pinned** and `-protocol_whitelist file` forbids every other protocol; the encoder runs under a wall-clock **and** a progress-stall bound with SIGKILL escalation; the stored bytes are always the encoder output, never `-c copy` | §4.1                                                                                               |
| T10 | Passive privacy exposure in a clip: per-frame gyroscope and sometimes GPS in an iPhone timed-metadata track               | guests movements and locations, invisible in any player                                                   | `-map 0:v:0 -map 0:a:0? -dn -sn` drops every stream that is not the picture or the sound, rather than merely stripping its metadata; the guest upload is deleted once the transcode succeeds and is never servable                                                                                              | §4.1                                                                                               |

| T11 | A shared gallery link forwarded beyond the host's intent, guessed, crawled, or used after the host took it back | full-resolution photographs of the evening, and the GPS of whoever's home a photograph was taken in | a 256-bit token stored only as its SHA-256; one neutral `404` for every dead link; published photographs only; an optional password with per-client **and** per-link failure limits; media by signed one-hour URLs that re-check the link on every request, so revocation is immediate; originals are the EXIF-stripped re-encode; `noindex` and `no-referrer` on every response | §15 |

**Explicitly out of scope.** A guest you invited is inside the trust boundary for
uploading; 200 people on one Wi-Fi doing the intended thing is a capacity question, not
a security one; a malicious _host_ on their own instance owns the data anyway.

## 2. Identity and authorization

Two principals and one capability, and no ambient "logged in means allowed".

| Principal        | Credential                                    | Lifetime                                              | Grants                                                             |
| ---------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Host / moderator | `express-session` cookie, SQLite-backed store | idle 12 h rolling, **and 7 days absolute** from login | per-event role from the membership table, re-read on every request |
| Guest            | HMAC-signed device token in a cookie          | 36 h from issue, enforced at verification             | upload to **one** event; delete own photo inside the grace window  |
| Link holder      | a shared gallery token in the URL (§15)       | the link's own expiry, 1–90 days; revocable at once   | **read** the published photographs of one event; nothing else      |

The link holder is a **capability**, not an identity: nobody signs in, the token names no
person, and whoever holds it holds exactly what the host published. It is borrowed
authority, too — a link grants only while the account that made it is still an owner of
the event, read on every request (§15) — so it can never outlive the host's own standing.

The account behind the first principal also carries a **site role** — see below — which
is authority over the box and never over an event, so it adds no further kind of caller
and grants nothing any row in this table does not.

### Two clocks and one account read

Three things bound a host session, and they answer different questions.

| Bound                                                   | Where                                                     | What it is for                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle, 12 h**, `rolling: true`                         | `server.ts` cookie `maxAge`, `sqliteSessionStore.touch`   | a laptop nobody comes back to                                                                                                                                        |
| **Absolute, 7 days** from the login that established it | `enforceSessionAge` in `middleware/authz.ts`              | a session that keeps being used. Rolling alone never ends one, so without this the window had no end at all rather than the twelve hours this document used to claim |
| **The account, on every request**                       | `MembershipRepository.roleFor`, `UserRepository.isActive` | the host you switched off five minutes ago. A capability answered from the session is a capability nobody can take back — see "Disabling an account", below          |

The absolute cap is a week and not a day on purpose: the control that acts on the
unlocked laptop is the idle timeout, and a tighter absolute cap would buy little against
it while guaranteeing that a host who signed in for Friday's setup is logged out in the
middle of Saturday evening. A weekend is the longest thing this product is used for. A
session carrying no issued-at — every session written before the cap existed — is treated
as expired rather than as fresh, so an upgrade costs one sign-in and never leaves an
unbounded session behind.

### Disabling an account

`users.disabled_at` is the switch, and what it switches off is **authority, not just the
next login**. Until roadmap §10 ships a console for it, setting the column is the
operation (`UPDATE users SET disabled_at = ...`); this branch built the enforcement, not
the administration of it.

| On the next **request**                             | What answers, and how                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every event-scoped route                            | `roleFor` answers `null`, so `requireRole` gives the **404** a non-member gets. Byte for byte the same body, so the refusal reveals nothing                                        |
| every use case that checks an actor for itself      | the same answer, because the nineteen of them ask the same port method — including `registerModerator`, which is how a disabled owner used to mint a fresh **enabled** account     |
| `GET`/`POST /api/events`, `POST /api/auth/password` | `requireUser` reads `UserRepository.isActive` and answers **401 `auth.required`**, the same as no session at all. These routes name no event, so no role lookup would have noticed |
| the operator's own surface                          | `siteRoleFor` already answered `none`; unchanged                                                                                                                                   |
| the login form                                      | `authenticateUser` refuses with `auth.invalidCredentials`, after the hash comparison so a switched-off account stays unobservable                                                  |
| an SSE stream **already open**                      | nothing — it was authorized when the socket opened and is not asked again. It reads; it decides nothing. See the residual below                                                    |

Two deliberate non-changes. The membership row is **kept**, and `listForEvent` and
`countByRole` still report it: the owner looking at their moderator list needs to see who
is switched off, the last-owner rule is about rows rather than about who happens to be
switched on this evening, and re-enabling an account gives back exactly what it had. And
sessions are **not** hunted down and deleted — `sessions` carries no `user_id` to
invalidate against, and adding one would buy nothing the per-request account read does not
already give, since the very next request that session makes is refused.

**The residual, stated plainly: a connection already open is not a request.** Both SSE
streams are authorized once, when the socket is opened, and then held — the wall's is
public, and the moderation one sits behind `requireRole` on `GET
/api/events/:eventSlug/moderation/stream`. Nothing re-asks while it is open, so a
moderator disabled at 19:00 keeps **reading** the live queue until the socket drops, and a
session that crosses the absolute cap keeps streaming. They can act on nothing: every
decision is its own request and answers 404. This is the case a session-revocation design
would have closed and a per-request read does not, and it is written down rather than
quietly excluded from the sentence above — re-checking on the stream's own heartbeat is the
fix, and it belongs with the stream rather than at the end of this branch.

**`roleFor` is authority; `membershipFor` is the row**, and the split is what keeps the
paragraph above true. Two callers ask about the row rather than about what anybody may do,
and both were bugs the moment `roleFor` started refusing a disabled account:
`registerModerator`'s "is this address already a member" — where a disabled **co-owner**
would have looked like a stranger and been re-granted as a moderator, losing the role that
re-enabling them was meant to restore — and `revokeModerator`'s lookup of the row it is
about to delete, which would otherwise have told an owner `membership.notFound` about
somebody their own moderator list was still showing them. The port says which question each
method answers, and the contract suite runs both against the fake and SQLite.

Named tests at ring 2 (`registerModerator.test.ts`), ring 3 (the shared
`membershipRepositoryContract` and `userRepositoryContract`, run against the fake **and**
SQLite), ring 4 (`authz.test.ts`, `authRoutes.test.ts`) and ring 6
(`tests/e2e/security/tenant-isolation.spec.ts`, which switches the account off in the
running server's own database and then asks).

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

| Cookie       | Purpose                  | Flags                                                                                       |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `es_session` | host/moderator session   | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; `Max-Age` 12 h; host-only, no `Domain`   |
| `es_guest`   | guest device token       | `HttpOnly; SameSite=Lax; Secure` (prod); `Path=/`; `Max-Age` 36 h = the token's own TTL     |
| `es_csrf`    | double-submit CSRF value | **not** `HttpOnly` (the app must read it); `SameSite=Lax; Secure` (prod); `Path=/`          |
| `es_gallery` | a shared gallery unlock  | `HttpOnly; SameSite=Strict; Secure` (prod); `Path=/api/gallery`; ≤ 2 h, never past the link |

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
| `enforceSessionAge(deps)`        | nothing. Ends a session older than the absolute cap, ahead of identity resolution                                                     |
| `attachUser()`                   | nothing. Reads the session into a principal — identity, never permission                                                              |
| `requireUser(deps)`              | any authenticated user **whose account is still enabled**, for the routes that are not event-scoped                                   |
| `requireRole('owner', deps)`     | event owner only, and only while that account is enabled                                                                              |
| `requireRole('moderator', deps)` | owner or moderator of **that** event, same condition                                                                                  |
| `requireOperator(deps)`          | the account that operates the **box** — and nothing inside any event. No route uses it yet; see the site role below                   |
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
route.

The mechanical half of that is `siteOperatorScope.test.ts`, and it is worth knowing
exactly what it does and does not do, because this paragraph previously credited
`eventRoutes.test.ts` with a sweep it has never had. (The two tests there named "a route
mounted without an authorization decision fails loudly" assert
`expect(() => currentUser(bare)).toThrow(/mis-wired/)` — `RequestContext` helpers, which
fire only if a handler _calls_ one. A handler that answers directly, or reads `req.params`
itself, is caught by neither.) What the sweep does: it reads every route off the assembled
server's own layer stack, drives each one as a signed-in account that is a member of no
event, and requires a 4xx. A route mounted with no authorization decision answers that
caller 200 and fails the sweep the day it is mounted. What it does not do: read the
middleware list. A route that carries the _wrong_ decision but still refuses a non-member
looks the same to it, and `requireOperator` mounted alongside `requireRole` on a route that
reaches an event is the shape that would pass — that one is still review's job.

Two lists can take a route out of that sweep, `PUBLIC_ROUTES` and `NOT_EVENT_SCOPED`, and
both are themselves exercised: a public exemption has to answer a caller holding no
credential at all without an authorization refusal, and a not-event-scoped one has to be
unable to answer `event.notFound`. Adding a guarded route to either to quiet a failure
fails in its own named case rather than passing on the strength of its reason string.

### The site role, and what it deliberately does not grant

An account carries one more thing since roadmap §10.1: `users.site_role`, either `none` or
`operator`. It says what the account may do **on the box** — an operator is the person who
runs this instance for other people — and it is answered from a different table, by a
different middleware, from the question of what anybody may do inside an event.

| Rule                                                                    | Why, and where it is held                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A site role grants **nothing** inside an event                          | an operator who could accidentally moderate a client's photographs is worse than one who cannot help at all. Support access is §10.6: time-boxed, announced and logged                                                                                                               |
| `requireRole` never reads it                                            | `authz.test.ts` asserts the refusals **and**, through `CallLog`, that the question is never even asked — including on the path where the membership is missing                                                                                                                       |
| Every event-scoped route refuses an operator who is not a member        | `siteOperatorScope.test.ts` sweeps every route off the assembled server, so a route added later is covered the day it is mounted rather than the day somebody adds it to a list                                                                                                      |
| Media is reached as a member of the public                              | `mediaRoutes` resolves its own viewer, so an operator asking for a photograph is `{kind:'public'}` and a pending photo stays unreadable — asserted at rings 4 and 6                                                                                                                  |
| It is read from storage on every request, never carried in the session  | a capability in a cookie outlives the account being switched off. `siteRoleFor` answers `none` for an unknown **or disabled** account, and **throws** on a value the domain does not know rather than guessing at it                                                                 |
| An operator is created in exactly two places, both on a box's first day | `bootstrapOwner` on a fresh install, and migration `004_site_role` on an upgrade — never both, since `bootstrapOwner` stops on a non-empty `users` table. An invitation creates `none` explicitly (`registerModerator`), and there is no route that changes a site role at all today |

Upgrade path: migration `004_site_role` gives the role to the **first account ever
created** — the one `bootstrapOwner` made for whoever installed the box, since it only ever
runs against an empty table — and to nobody at all if that account has since been
disabled. It never walks to the next-oldest row. That distinction is the point: "the oldest
account that is not disabled" reads like the same rule and stops being the same rule the
moment the installer's login is switched off, at which point it names the first person
somebody _invited_ — a moderator from one wedding, handed the box. A box with no operator
costs nothing today, because `requireOperator` is mounted on no route and §10.4 is both the
first item that needs an operator and the item that ships a way to appoint one; a box with
the wrong one holds a grant nothing can revoke. The two cases the migration cannot
distinguish — a first account **deleted** rather than disabled — is written down in the
migration itself.

So on an upgraded box, do not read `BOOTSTRAP_OWNER_EMAIL` out of the compose file and
assume it names the operator: that variable may have changed since, and nothing in the
product displays a site role. `SELECT email FROM users WHERE site_role = 'operator'` is the
answer.

Ring 6 holds the same line end to end, in
`tests/e2e/security/tenant-isolation.spec.ts`: a client creates their own event on the
operator's box, and the operator — signed in, on the server they run — is answered 404 for
its settings, 404 for its queue, and 404 for a photograph the client has not published,
which the client themselves reads at the same URL. That the account is an operator is
**checked** there rather than assumed: no response carries a site role, so the spec reads
it from the server's own SQLite file, and the fixture refuses to hand back a session whose
account is not one. Without that, every 404 it asserts is a stranger's 404 and the block
would have stayed green with `bootstrapOwner` writing `none`.

## 3. Tenant isolation as an invariant

One box hosts many events. Isolation is not a feature; it is the thing that must not break.

| Layer   | Mechanism                                                                                                                             | Consequence                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Ports   | every event-scoped method takes `eventId` **first**: `findById(eventId, photoId)`, never `findById(photoId)`                          | a method that can name another event's row cannot be written by accident; the three that deliberately span events are listed below      |
| Schema  | `event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE` plus an index leading with `event_id`, on every event-scoped table   | the cascade makes "delete this event and everything in it" atomic                                                                       |
| Fakes   | `FakePhotoRepository` keys its map on `(eventId, photoId)`                                                                            | a cross-tenant bug fails a ring-2 test instead of passing because a mock returned what it was told                                      |
| Media   | served by a controller that resolves the event from the path, authorizes, then streams from an explicit root — never `express.static` | scoping applies to every byte; a hash guessed from another event is a 404                                                               |
| Storage | `<MEDIA_ROOT>/<eventId>/<variant>/<hash[0:2]>/<hash>.<jpg                                                                             | mp4>`— the extension follows the rendition, so a clip is never served labelled`image/jpeg` (`src/infrastructure/media/fsMediaStore.ts`) | the only client input in a media URL is an id, and it is looked up, never concatenated into a path |

### The documented exceptions, and why each is one

Five methods are not scoped by event, and they are the only five. Three belong to
`ClipJobRepository`, because there is **one transcode worker for the whole box** and it
cannot name the event whose guest is about to upload — the same shape as
`EventRepository.listDueForPurge`, and the same reasoning. Two belong to
`ShareLinkRepository` (§15), because the caller holds a link and nothing else.

| Method              | Reached from                                                         | What it can return                                                                           |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `claimNext`         | the worker only, never a route                                       | one job, any event — handed to the worker, not a reply                                       |
| `recoverAbandoned`  | the worker, once, at boot                                            | the jobs a dead process was holding, any event                                               |
| `countActive`       | `POST /clips`, on a guest's request                                  | **a number only**: how many clips are waiting, box-wide                                      |
| `findByTokenDigest` | `/api/gallery/:token`, on a link holder's request                    | the link whose token hashes to this digest — whose `eventId` then scopes every read after it |
| `findById`          | `/api/gallery-media/:linkId/…`, **after** the signature has verified | the same, by the id a signed URL names; an unsigned id never reaches the query               |

`countActive` is the one an outsider can reach, and what it discloses is one integer
about the box's queue depth — which the guest is then told outright in the
`429 clip.queueFull` body, because a `Retry-After` computed from a depth the client may
not know would be a worse answer. It names no event, no guest and no photo.
`HttpUseCases` does not list the use cases that call the other two, so no route can
reach them at all.

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

Two steps that used to be here are gone because the **photo** path does not work that
way: multer writes to **memory**, not a temp directory, so there is no temp file to name
safely and none to unlink in a `finally`. `fileSize` is what bounds the memory that
costs, and the pipeline re-encodes every byte it accepts anyway, so a disk-backed upload
would write a file and read it straight back — then need cleanup on every exit path,
which is precisely where 1.0 leaked.

**A clip is the exception, and it is a separate route with a separate multer** (§4.1). It
does stage to disk, deliberately, and therefore does carry the cleanup obligation that
sentence describes.

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

## 4.1 Clip hardening, in order

A short video clip (docs/ROADMAP.md 1.4) is a second ingest path with a different shape,
and the differences are what this section is for. It is a **separate route with its own
multer, its own byte limit and its own queue**; it stages to disk rather than to the heap;
and the expensive work happens **after** the response, in a worker.

The single sentence that carries most of the security of this path: **the stored bytes
are always the encoder's output.** Never `-c copy`.

| #   | Step                                                                                                                                                                                                                                                                                                                                                | Where                                                    | Failure                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rate-limit, then authorize — the same limiter bucket as photos, because a guest sending both is one guest                                                                                                                                                                                                                                           | `middleware/rateLimit.ts`, `middleware/authz.ts`         | 429 `rate.limited`; 401/403 as §4                                                                                                                  |
| 2   | `multer` to **disk**, under `MEDIA_ROOT/.uploads`, one file, `MAX_CLIP_BYTES` (default 80 000 000). No `fileFilter`: it could only read the client's own `Content-Type`                                                                                                                                                                             | `routes/clipRoutes.ts`                                   | 413 `upload.tooLarge`; 400 `upload.noFiles`                                                                                                        |
| 3   | The host's own switch: `settings.allowClips`, and then whether this box has an encoder at all                                                                                                                                                                                                                                                       | `usecases/clips/uploadClip.ts`                           | 403 `event.clipsNotAllowed`; 500 `clip.transcoderUnavailable`                                                                                      |
| 4   | **Signature identification**, before a byte is written to the media store: `ftyp` at **offset 4** with an mp4/QuickTime/3GP brand, or an EBML header. Starts no process                                                                                                                                                                             | `infrastructure/media/magicBytes.ts`                     | 400 `clip.unsupportedFormat`                                                                                                                       |
| 5   | Backpressure and the byte quota — decided **once**, and at step 7, inside the transaction that reserves the row. There is no advisory pre-check: the row is written before the bytes, so a refusal has nothing to unwind                                                                                                                            | `domain/clips/clipQueue.ts`, `uploadClip.ts`             | **429 `clip.queueFull` with `Retry-After`** — never the quota 413; 413 `event.quotaExceeded`                                                       |
| 6   | The byte quota counts the staged sources already in the queue as well as the album — one `SUM` over `photos` and `clip_jobs`                                                                                                                                                                                                                        | `sqlitePhotoRepository.ts`, `sqliteClipJobRepository.ts` | 413 `event.quotaExceeded`                                                                                                                          |
| 7   | **The row first, then the bytes.** `ClipJobRepository.stage` inserts a `reserved` row — depth, quota and uniqueness in one `.immediate()` transaction — and only then is the source written and the row moved to `queued`. A refusal therefore costs **zero bytes**. The multer temp file is unlinked before the response, and again in a `finally` | `uploadClip.ts`, `clipRoutes.ts`                         | 500 `clip.stageFailed`; 429 `clip.queueFull`; 413 `event.quotaExceeded` — nothing was written                                                      |
| 8   | `202 Accepted`. **No `photos` row exists**, so nothing can reach a moderator or the wall                                                                                                                                                                                                                                                            | `clipRoutes.ts`                                          | —                                                                                                                                                  |
| 9   | The worker probes with `ffprobe`, under a pinned demuxer and `-protocol_whitelist file`, and applies the duration cap **and the pixel budget** to the header before a frame is decoded                                                                                                                                                              | `ffmpegVideoTranscoder.ts`, `transcodeNextClip.ts`       | `clip.corrupt`, `clip.noVideoStream`, `clip.tooLong`, `clip.tooShort`, `clip.pixelBudgetExceeded`, `clip.probeUnreadable`                          |
| 10  | Re-encode to H.264/AAC in an 8-bit 4:2:0 mp4, dropping every stream that is not the picture or the sound, bounded by `-t` and `-fs`, under a wall-clock and a stall timeout                                                                                                                                                                         | same                                                     | `clip.transcodeFailed`, `clip.transcodeTimedOut`, `clip.transcodeCancelled`                                                                        |
| 11  | Poster frame cut from the **output**, then both files hashed and stored, then the `photos` row through `saveManyWithinLimits` — quota counted inside the insert transaction, as for a photo, and crediting back this clip own staged source so it is not charged twice                                                                              | `usecases/clips/transcodeNextClip.ts`                    | `clip.storageFailed`; `event.quotaExceeded`; what this pass wrote is removed **except any digest another row still names** — a poster is shareable |
| 12  | Only now is the job `done` and the guest's upload deleted                                                                                                                                                                                                                                                                                           | same                                                     | —                                                                                                                                                  |

Details that are load-bearing, each closing something a naive implementation gets wrong:

- **`-c copy` is forbidden, and it is the first optimisation anyone proposes.** It is
  roughly fifty times cheaper, and `free`, `skip` and `udta` boxes and the `moov/meta`
  atom all survive a remux — so both a polyglot payload and the GPS of a guest's home
  come through intact. The same rule as a photograph: stored bytes are pipeline output.
- **`-map_metadata -1` does not remove streams.** An iPhone writes a `mebx` timed-metadata
  track carrying per-frame gyroscope data and sometimes location, with a `tmcd` timecode
  track beside it. Neither is visible in a player and both survive a metadata strip. What
  removes them is `-map 0:v:0 -map 0:a:0? -dn -sn`, and a ring-3 test asserts the output
  has no stream that is not `video` or `audio`.
- **`-protocol_whitelist file`, `file:` on both paths, and a pinned input demuxer**
  (`-f mov,mp4,m4a,3gp,3g2,mj2` or `-f matroska,webm`). Without them a crafted Matroska,
  HLS playlist or concat script makes ffmpeg open network URLs on the server's behalf —
  server-side request forgery, from a guest upload. Pinning `-f` also stops content
  sniffing from choosing a demuxer the signature check never authorised.
- **`-pix_fmt yuv420p` _and_ `format=yuv420p` at the end of the filter chain.** A phone in
  High Efficiency records 10-bit HEVC; without both, `libx264` emits High 10, which
  transcodes without error, passes every check this codebase can make, and renders as a
  black rectangle on the projector. Ring 3 pins it against a genuine 10-bit source.
- **The guest's upload is never servable.** It is stored as the `source` variant, which is
  outside `SERVED_VARIANTS` — so the media use case's own parameter type excludes it and
  no route can parse a value that reaches it. Those bytes still carry whatever the phone
  wrote into the container. It is deleted the moment the transcode succeeds, and when the
  clip is given up on **because of its own content** — not a video, an unparseable header,
  past the duration cap or the pixel budget. It is deliberately **kept** in the one other
  case: a job abandoned after three interrupted boots failed because the box kept dying,
  which says nothing about the guest's video, and deleting is the one action that cannot
  be walked back. Those bytes are collected by the reconciliation sweep below, and by the
  retention purge if the event goes first.
- **Two bounds on the encoder, not one.** A wall clock generous enough for a legitimate 4K
  clip is far too generous for a decoder spinning in a demuxer loop, so there is also a
  progress-stall bound fed by `-progress pipe:1`. Both escalate SIGTERM to **SIGKILL**:
  Node's own `timeout` option sends SIGTERM and stops there, which such a decoder ignores.
- **Scratch files, and cleanup on every exit path.** `+faststart` rewrites the `moov` atom
  at the end of the file, so the output must be seekable; an mp4 input commonly has its
  own `moov` at the end, so neither side can be a pipe. They live under **`MEDIA_ROOT`**,
  never `os.tmpdir()`: the container runs `read_only: true` with a small tmpfs charged to
  the same memory cgroup as the heap. Ring 3 asserts the scratch directory is empty after
  a success, a failure and a probe.
- **Reserve, then write. The row exists before the bytes do.** The quota is computed from
  rows — `photos.byte_size` plus the staged sources — so while the bytes went first, every
  refused upload had already written up to `MAX_CLIP_BYTES` that nothing counted, until a
  sweep came round. A table of guests forwarding one video from the group chat could
  therefore fill the disk with every individual check passing, and `ENOSPC` takes photo
  ingest and the wall down with it. `stage` now inserts a `reserved` row — depth, quota
  and uniqueness in one transaction — and only then is the source written and the row
  moved to `queued`. A refusal costs zero bytes; the reservation is charged from the
  instant it exists; and deleting becomes safe again, because the row **is** the proof of
  ownership: the unique index means no other request can hold that digest. A reservation
  whose bytes never arrive is deleted by the **reservation reaper**, on a five-minute
  timer of its own.
- **That timer is not optional, and it is not the boot pass.** A reservation nothing
  reaps charges its event for bytes that do not exist — and the quota spans `photos`, so
  the album's own room shrinks with it — holds one of `MAX_QUEUED_CLIPS` slots so twenty
  of them answer every clip upload on the box with a `429`, and locks its digest so the
  guest's own retry is deduped onto a job that will never move. While the reaper ran only
  inside crash recovery, a box OOM-killed mid-upload came back in seconds, found the
  stranded row ten seconds old, correctly spared it under the five-minute window, and
  never asked again: on a box booted at 18:00 the row lived until 02:00. The window is
  unchanged — it exists for a `--force-recreate` overlapping two containers — but the pass
  repeats, which turns "never" into "five minutes later". It deletes rows only; the bytes
  are `sweepOrphanedMedia`'s business, because the row goes inside a transaction and any
  unlink would follow the commit, where a re-upload that won the digest would lose its own
  source.
- **`sweepOrphanedMedia` is the collector behind all of that**, and it is what makes
  "leak rather than destroy" an honest trade wherever the code still takes it: the source
  `recoverClipJobs` keeps when the _box_ was at fault, a worker whose job was deleted
  under it mid-transcode, and a `.tmp` from an interrupted `put`. It lists an event's
  stored objects and deletes those named by no `photos` row and no live `clip_jobs` row,
  one query per event, bounded per pass, on the retention interval — and on `npm run
purge`, which is the _only_ place it runs when an operator has moved the schedule to
  cron. Two rules keep it safe mid-event: **nothing written in the last fifteen minutes is
  collected**, because every write path here is bytes first and row second, and **a source
  a reserved, queued or running job names is never collected**, however old.
- **The same is true of a transcode that unwinds.** A clip's poster is a deterministic
  JPEG of a frame one second in — not the first frame, which on a phone is usually black
  — and it carries no unique index, so two clips whose opening second looks the same
  share it. The unwind asks `findIdsReferencing` before removing either digest, exactly
  as `deletePhoto` and `uploadPhotos` do.
- **Both scratch directories are emptied at boot.** `MEDIA_ROOT/.uploads` and
  `MEDIA_ROOT/.scratch` hold work in progress and nothing addressable, so the composition
  root deletes and recreates them before the port opens. Every ordinary exit path removes
  its own file; what survives is what a `SIGKILL`, an OOM kill or a power cut left — up
  to `MAX_CLIP_BYTES` per interrupted upload, on the disk the byte quota exists to
  protect, charged to no event. Nothing else would ever collect them: the retention sweep
  deletes an event's media by content hash, and neither of these files has one.
- **A pixel budget on the input, judged from the probed header.** `CLIP_MAX_HEIGHT` is not
  one: it scales the _output_, and `-vf scale` runs after the decoder has already
  allocated the frame. A valid 16000x16000 HEVC is roughly 380 MB a frame, which is an OOM
  kill on a venue box — so `MAX_CLIP_PIXELS` refuses it before a frame exists, exactly as
  `MAX_IMAGE_PIXELS` does for a photograph, and the refusal is permanent.
- **A cancelled encode is not a timed-out one.** A deliberate `kill()` at shutdown and a
  wedged decoder produce different codes (`clip.transcodeCancelled`,
  `clip.transcodeTimedOut`), and both are **transient**: a clip must not be destroyed
  because the operator restarted the container mid-transcode. `MAX_ATTEMPTS` bounds what
  a genuinely pathological file can cost, and the stall bound is what stops it costing
  that slowly.
- **On shutdown the child is killed, not orphaned.** `container.dispose()` calls the
  transcoder's `close()`, which SIGTERMs then SIGKILLs every running ffmpeg. Without it a
  new container starts the same job while the old encoder holds a core all evening.
- **ffprobe's stdout is an untrusted boundary input**, derived from a guest's file. It is
  parsed with zod, like `req.body`.
- **ffprobe is not the cheap header read `sharp.metadata()` is.** It is the same demuxer
  and at its defaults partially decodes, which is why it is bounded with `-probesize` and
  `-analyzeduration` and a timeout — and why it runs in the worker rather than on the
  guest's request. The cheap gate on the request path is the signature, and only that.
- **No encoder on the box is not a failure of the box.** The boot check asks `-encoders`
  for `libx264` and `aac` **by name, never a version string**: a distribution's patched
  build reports its own version, and one compiled without those encoders reports a
  perfectly modern one right up until the first transcode fails. On failure the adapter is
  replaced by a Null Object, clip uploads are refused with `clip.transcoderUnavailable`,
  photo ingest is untouched, and `/api/ready` reports `video: unavailable` **without
  failing**: a photo wall with no video still serves the room.

### The residual, stated plainly

**The clip quota is enforced twice, and both times inside a write transaction.**
`ClipJobRepository.stage` takes the queue depth and the event's byte total — `photos`
plus the sources still staged, in one statement — and inserts the row, all in the same
`.immediate()` transaction; `PhotoRepository.saveManyWithinLimits` does the same for the
transcoded output when it lands. The upload path also reads both numbers before it writes
sixty megabytes to the disk, but that read is **advisory**: it exists so a full queue is
refused before the bytes are written, and two requests in flight can both pass it. Only
one of them can pass `stage`, and the loser's staged source is deleted before the
response goes out.

What remains is bounded and worth stating: the staged source is charged from the moment
it lands and released when the job reaches `done` or `failed`, so an event's usage
includes clips that will never become photographs until the worker says so — up to
`MAX_QUEUED_CLIPS x MAX_CLIP_BYTES` of an event's own quota, held by its own queue. That
is the quota doing its job rather than a hole in it: those bytes are on the disk.

## 5. Rate limits and quotas

`express-rate-limit`, with a SQLite-backed store so limits survive a restart
**(planned: the store. In the first cut the counters are in-process, which is a real gap
on a restart loop)**.

| Endpoint                                      | Per IP       | Per event              | Per guest token | Window |
| --------------------------------------------- | ------------ | ---------------------- | --------------- | ------ |
| `POST /api/auth/login`                        | 10           | —                      | —               | 15 min |
| `GET /api/join/:code` (code lookup)           | 20           | 60                     | —               | 1 min  |
| `POST /api/events/:slug/guests` (join)        | 10           | 60                     | —               | 1 min  |
| `POST /api/events/:slug/photos`               | **(defect)** | **(defect)**           | —               | 1 min  |
| `POST /api/events/:slug/clips`                | **(defect)** | **(defect)**           | —               | 1 min  |
| `POST /api/events/:slug/photos/:id/reactions` | 120          | 600                    | 60              | 1 min  |
| `GET /api/events/:slug/stream` (SSE)          | 5 concurrent | 200 concurrent         | —               | —      |
| `GET /api/gallery/:token`, `…/photos`, unlock | 120          | —                      | —               | 1 min  |
| `GET /api/gallery-media/…`                    | 3000         | —                      | —               | 1 min  |
| `POST /api/gallery/:token/unlock` (failures)  | 10           | 50 per link            | —               | 15 min |
| `GET /api/gallery-media/:linkId/album.zip`    | 2 concurrent | 4 concurrent, box-wide | —               | —      |

**(defect)** The two upload rows describe three independent limits and there is one.
`uploadLimiter` in `middleware/rateLimit.ts` mints a single bucket keyed by
`clientKey:eventSlug` at `UPLOAD_RATE_LIMIT_PER_MINUTE` (default **12** per minute), and
both upload routes share it — deliberately, because a guest sending a photo and a clip is
one guest and two buckets would be twice the allowance. There is no per-guest-token
limiter at all. The numbers above were never implemented; the intent — a limit that a
whole table of guests behind one venue access point does not trip on somebody else's
behalf — is served by the composite key rather than by three tiers.

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
  one client that must never be disconnected. **(defect)** No drop-oldest logic exists:
  the limiter **refuses**, cleanly and before any header is written, at 12 per client,
  200 per event and 500 per process. The whole SSE row of the table above — and the login
  and join-code rows with it — describes numbers and a route that were never built. See
  §14.7.

## 6. Session security

| Property                       | Value                                                                                                                                                          | Why                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Store                          | `src/infrastructure/db/sessionStore.ts`, a `Store` over `better-sqlite3`, table `sessions(sid TEXT PRIMARY KEY, expires_at TEXT NOT NULL, data TEXT NOT NULL)` | 1.0's `MemoryStore` leaked memory and logged every moderator out on restart — mid-event             |
| Pruning                        | `DELETE FROM sessions WHERE expires_at < ?` on an interval and on boot                                                                                         | an unpruned session table is both a growth and a replay problem                                     |
| Regeneration                   | `req.session.regenerate()` on **successful login**, before the user id is written                                                                              | defeats session fixation: a pre-set `es_sid` from an attacker is discarded                          |
| Timeouts                       | idle 12 h (`rolling: true`), **and 7 days absolute** from login — `enforceSessionAge`, ahead of `attachUser`; see §2                                           | a projector laptop is left unlocked at a venue, and `rolling` alone never expires an active session |
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

| Directive                                 | Value                | Note                                                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`                             | `'none'`             | **(defect)** the code ships `'self'` — deny by default was the intent; see §14.7                                                                                                                                                                                |
| `script-src`                              | `'self'`             | no CDN, no inline, no `eval`                                                                                                                                                                                                                                    |
| `style-src`                               | `'self'`             | CSS Modules compile to files; nothing inline is needed                                                                                                                                                                                                          |
| `style-src-attr`                          | `'unsafe-inline'`    | **(defect)** intended narrowly, because the slideshow sets `--slide-duration` as an inline custom property — but no `style-src-attr` is emitted and `style-src` itself carries `'unsafe-inline'`, which is the broader hole this row says it avoided. See §14.7 |
| `img-src`                                 | `'self' blob: data:` | `blob:` is the local preview of the photo a guest just picked; `data:` for tiny inlined placeholders                                                                                                                                                            |
| `font-src`                                | `'self'`             | fonts are bundled, self-hosted                                                                                                                                                                                                                                  |
| `connect-src`, `media-src`, `form-action` | `'self'`             | `connect-src` covers the SSE endpoint                                                                                                                                                                                                                           |
| `frame-ancestors`, `object-src`           | `'none'`             | the moderation console must not be framed                                                                                                                                                                                                                       |
| `base-uri`                                | `'none'`             | **(defect)** the code ships `'self'`; the intent — blocking `<base>` injection that repoints relative URLs — is not met. See §14.7                                                                                                                              |
| `upgrade-insecure-requests`               | on, production only  |                                                                                                                                                                                                                                                                 |

The shared gallery (§15) adds `X-Robots-Tag: noindex, nofollow` and `Cache-Control:
no-store` to every response it gives, refusals and its `/g/*` page shell included, and
sets its own `Referrer-Policy: no-referrer` rather than relying on the global one — the
token is in the page's own URL.

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

**What a guest is told, and when (roadmap §5.1).** Before their first upload the guest
page shows a notice answering four questions — what happens to a photo, who sees it, how
long it is kept, how to have it removed — and offers nothing that picks or sends a new
photo until it has been read. Photos already chosen before a changed notice (the queue's
retry, the offline outbox) keep going: they were chosen under the notice the guest read. Every answer is **derived from the event's own settings** on every read
(`src/domain/privacy/privacyNotice.ts`), never written as prose, so it cannot say
"checked before the screen" on an event that publishes on arrival, promise a self-delete
window the server would refuse, or state a retention period the host has since changed.
Where the configuration has no deletion date, it says so. The only removal path it names
is asking the host, because that is the only one that exists for a guest beyond the grace
window: self-service erasure is roadmap §5.2 and is not built.

It is an information notice with an acknowledgement, not consent as a lawful basis: a
guest who does not press "J'ai compris" is not refused anything but the upload controls,
and can still read the page. The acknowledgement is recorded on the guest's row
(below) so it is shown once per device rather than once per tab, and asked again when a
setting it states changes. The upload routes do not check it: the gate is the upload
screen, and `src/interface/http/routes/privacyNoticeRoutes.ts` says why a refusal on the
upload routes would put the offline queue's photos at risk to stop only a client that
skipped the screen on purpose.

| Data                                                           | Why                                                    | Retention                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-encoded photo bytes                                         | the product                                            | until photo delete, event purge, or `settings.retentionDays`                                                                                                              |
| Transcoded clip bytes and its poster frame                     | the product                                            | as above                                                                                                                                                                  |
| A clip still waiting for the transcoder                        | it is the guest upload, on its way                     | minutes — deleted when the transcode succeeds or the clip itself is refused; kept until the event is purged when the box abandoned the job, and **never servable** (§4.1) |
| `guests.display_name` (a first name, guest-typed)              | attribution on the wall                                | with the event                                                                                                                                                            |
| `guests.notice_revision` + `notice_acknowledged_at`            | which privacy notice this device read, and when (§5.1) | with the event; replaced when the guest reads a newer notice, so only the latest is kept                                                                                  |
| Guest device token (cookie only, `gid` in `guests`)            | re-identify a device without an account                | token TTL                                                                                                                                                                 |
| `photos.caption`                                               | the guest's words                                      | with the photo                                                                                                                                                            |
| `users.email` + bcrypt hash                                    | host/moderator accounts                                | until account delete                                                                                                                                                      |
| Session rows                                                   | login                                                  | ≤ 12 h                                                                                                                                                                    |
| `share_links`: token **digest**, password hash, creator, times | the host's shared gallery (§15)                        | with the event; a revoked link's row is kept, and opens nothing                                                                                                           |

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

| Request                    | How                                                                                                                                       | Result                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "Delete that photo of me"  | moderation console → delete, or the guest self-deletes inside the grace window                                                            | row deleted, file unlinked, SSE invalidation removes it from every projector  |
| "Delete everything I sent" | filter the moderation queue by guest, bulk delete                                                                                         | all photos for that `guest_id` in that event                                  |
| "Give me my photos"        | `GET /api/events/:slug/archive` (`archiver`, streamed, owner only)                                                                        | zip of the event's photos                                                     |
| "Send us the photos"       | a shared gallery link (§15) the owner makes, with an expiry and optionally a password, and can revoke at once                             | the published album, full resolution and EXIF-free, to whoever holds the link |
| "Forget the whole event"   | delete the event → `ON DELETE CASCADE` clears photos, guests, reactions, memberships; the media sweeper removes `<MEDIA_ROOT>/<eventId>/` | nothing left but the audit line that it happened                              |
| Automatic expiry           | `settings.retentionDays`, swept hourly by `src/main/retentionSweeper.ts` and on demand by `npm run purge` (§11)                           | events age out without the host remembering                                   |

Deletion is real: `DELETE`, not a `deleted_at` column. A soft-delete of a photo someone
asked you to remove is not a deletion.

## 10. Secrets and configuration

`src/infrastructure/config/env.ts` is the **only** file that reads `process.env`: parsed
once with zod at startup, exported as a frozen typed object.

| Variable                           | Required              | Default                               | Effect                                                                 |
| ---------------------------------- | --------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `SESSION_SECRET`                   | **yes in production** | none                                  | signs `es_sid`                                                         |
| `GUEST_TOKEN_SECRET`               | **yes in production** | none                                  | HMAC key for guest tokens                                              |
| `NODE_ENV`                         | no                    | **`production`**                      | gates `Secure` cookies, HSTS, strict CSP, and both secrets — see below |
| `PUBLIC_URL`                       | yes in production     | none                                  | join links, QR codes, `Origin` check                                   |
| `DATABASE_PATH` / `MEDIA_ROOT`     | no                    | `./data/eventslide.sqlite`, `./media` | see file permissions in §11                                            |
| `TRUST_PROXY_HOPS`                 | no                    | `0`                                   | see §11 — wrong values break rate limiting                             |
| `MAX_UPLOAD_BYTES`                 | no                    | `25000000`                            | multer's per-photo limit                                               |
| `MAX_FILES_PER_UPLOAD`             | no                    | `20`                                  | photos in one request                                                  |
| `MAX_CLIP_BYTES`                   | no                    | `80000000`                            | multer's per-clip limit; **separate on purpose** — see §4.1            |
| `MAX_CLIP_SECONDS`                 | no                    | `15`                                  | the duration cap, applied at the probe and at the encoder              |
| `MAX_QUEUED_CLIPS`                 | no                    | `20`                                  | queue depth before `429 clip.queueFull`                                |
| `CLIP_MAX_HEIGHT`                  | no                    | `720`                                 | the projected height a clip is encoded at                              |
| `MAX_CLIP_PIXELS`                  | no                    | `33177600`                            | the video decompression bomb bound, from the header — see §4.1         |
| `FFMPEG_PATH` / `FFPROBE_PATH`     | no                    | none                                  | set, and wrong, is a refusal rather than a fallback — see §4.1         |
| `DEFAULT_EVENT_QUOTA_BYTES`        | no                    | `5000000000`                          | new events' `quota_bytes`                                              |
| `PORT` / `LOG_LEVEL`               | no                    | `4300`, `info`                        |                                                                        |
| `RETENTION_SWEEP_INTERVAL_MINUTES` | no                    | `60`, and `off` under `NODE_ENV=test` | how often expired events are deleted; see §11                          |
| `SCHEDULE_SWEEP_INTERVAL_MINUTES`  | no                    | `5`, and `off` under `NODE_ENV=test`  | how often scheduled openings and closings are applied; deletes nothing |

Boot refuses, loudly, when in production either secret is missing, is shorter than 32
characters, or matches a known placeholder (`change-me`, `change-me-in-production`,
`dev-session-secret`, `secret`), or when `PUBLIC_URL` is missing. 1.0's `.env.example`
shipped `change-me-in-production` next to a `sessionSecret ?? 'dev-session-secret'`
fallback, so the likely production value was a public constant. The process prints every
failing key at once and exits non-zero; it does not start degraded.

**Saying nothing means production, and that is the security default of the file.** It used
to mean development, and five controls hang off the answer at once: both secrets fell back
to constants published in this repository, the session cookie lost `Secure`, HSTS and
`upgrade-insecure-requests` were not sent, and `script-src` admitted `'unsafe-inline'`. So
a self-hosted operator who started the built server without setting one variable got a box
whose session cookie any reader of this repository could forge, with nothing in the log to
say so. `docker compose up` was never the case that broke — `compose.yaml` and the
`Dockerfile` both set `NODE_ENV=production` — but `npm start`, a systemd unit, and a
`docker run` that overrides the environment all were. A blank `NODE_ENV=` counts as absent,
for the same reason `RETENTION_SWEEP_INTERVAL_MINUTES=` does: a template that rendered
empty must land on the strict answer.

**Outside production there is no constant to fall back to.** A boot with no configured
secret generates 48 random bytes for each, so a box carrying a secret this repository
publishes is not discouraged, it is unreachable — the values are gone. What it costs is
stated in the boot log: an ephemeral secret dies with the process, so a development restart
signs every host out and invalidates every guest token, and the line names the two
variables that end that. Development declares itself through `scripts/dev.env`, which the
npm scripts that run against a working tree load with node's `--env-file` — and which never
overrides a variable the environment already set, so it cannot relax a real deployment.
One escape hatch survives all of this, and it is named here rather than left to imply it
is closed: `SESSION_COOKIE_SECURE=false` still removes the `Secure` flag under
`NODE_ENV=production`. It exists because getting that flag wrong behind plain HTTP makes
login silently impossible, and it is unchanged. "Absent means production" closes the
default, not the override.

`scripts/verify-image.sh` drives the whole thing end to end: it runs the built image with
`NODE_ENV=` blanked and no secrets and requires exit 78 naming both.

**There is no default account in 2.0.** 1.0 recreated `admin` / `password` on every
boot, in `initDatabase`, in production, forever. Instead: while the `users` table is
empty the server logs a one-time bootstrap token, and `POST /api/setup/owner` accepts it
once with an email and password to create the first owner. That endpoint returns 404 as
soon as an owner exists. Password rules live in `src/domain/users/`, not the controller.

## 11. Deployment posture

| Concern           | Do this                                                                                                                                                                                                                             | Because                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TLS               | terminate at nginx/Caddy/Traefik; bind the app to `127.0.0.1`, which is what `compose.yaml` publishes to by default. The app never terminates TLS itself, and production **refuses** a non-localhost `http://` `PUBLIC_URL` at boot | guests are on hostile Wi-Fi; the cookie and the token are bearer credentials. The refusal is not pedantry: the session cookie is `Secure`, so over plain http a host meets a login form that never logs in — better to fail at boot and say why |
| `trust proxy`     | set `TRUST_PROXY_HOPS` to the number of proxies in front of the app (usually `1`); never a boolean `true` on a public interface                                                                                                     | `req.ip` feeds the rate limiter and `Secure` detection. With `trust proxy` too permissive, a client spoofs `X-Forwarded-For` and gets a fresh bucket per request — the limiter becomes decorative                                               |
| Headers           | let the app own security headers; do not duplicate CSP at the proxy                                                                                                                                                                 | two CSPs intersect and produce a policy nobody wrote                                                                                                                                                                                            |
| SSE               | disable proxy buffering (`proxy_buffering off`, and the app sends `X-Accel-Buffering: no`); raise read timeout above the 15 s heartbeat                                                                                             | a buffering proxy makes the wall look frozen                                                                                                                                                                                                    |
| Uploads           | proxy body limit ≥ `MAX_UPLOAD_BYTES` + overhead                                                                                                                                                                                    | otherwise the proxy rejects before the app can return a useful error                                                                                                                                                                            |
| Video             | leave `ffmpeg` installed (the image does) and raise the proxy read timeout above a clip upload, not above a transcode: a clip is encoded **after** the response, so no request waits on the encoder                                 | a missing encoder is reported by `/api/ready` as a detail and refuses clips by name; it never takes the wall out of service                                                                                                                     |
| File permissions  | run as a dedicated non-root user; DB `0600`, `MEDIA_ROOT` `0700`; both outside the web root                                                                                                                                         | the SQLite file contains session data and every hash                                                                                                                                                                                            |
| Process hardening | systemd: `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ReadWritePaths=` the data dir                                                                                                                            | limits what a `sharp` or Node CVE can reach                                                                                                                                                                                                     |
| Backups           | `npm run backup`, then copy the archive off the machine; rehearse with `npm run restore -- <archive> --dry-run`. Below.                                                                                                             | copying a live WAL database yields a corrupt backup, and an untested restore is not a backup. A wedding album has no second take                                                                                                                |
| Shutdown          | leave `stop_grace_period: 20s` alone, or keep it above the 15 s backstop in `src/main/index.ts`                                                                                                                                     | Docker's own default is 10 s, which `SIGKILL`s the process five seconds _before_ its own backstop runs — the WAL never checkpointed and whatever was mid-upload lost                                                                            |
| The image itself  | `bash scripts/verify-image.sh` builds it and checks every claim on this page that is a property of the container. CI runs the same script on every push                                                                             | an image that quietly lost `ffmpeg`, shipped its devDependencies or went back to running as root is green on all six test rings — none of them runs Docker                                                                                      |
| Updates           | pin the version, read the release notes, `npm audit` before a deploy                                                                                                                                                                | see §12: self-hosted means you own patching                                                                                                                                                                                                     |

**The `0600` on the database is the one row the image does not keep for you.** The
container creates `/data` and `/data/media` as `0700` owned by the unprivileged user, and
`scripts/verify-image.sh` checks it — but the mode of the SQLite file itself is whatever
the process umask makes it, which is `0644` on the stock Node image. Inside a container
with one user that is nobody's read, and on a named volume nothing else is mounted; it
matters when the volume is a **bind mount on a shared host**, where another account can
then read every session row and every password hash. Set the mode on the host directory,
or run the container with a umask, if that is your deployment. This is stated rather than
quietly fixed because forcing `0077` on the process would also make the album unreadable
to a backup running as a different uid, which is the more common arrangement.

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

**Both also run the media reconciliation sweep** (§4.1), and the second one has to: the
switch that moves the schedule to cron is the same switch the container reads to decide
whether to build the collector at all. Without it in the script, the deployment documented
on the row above would be the one deployment where an orphaned clip source is never
collected — the upload path deliberately leaks rather than risking a destructive delete,
and there would be nothing behind it. It runs on every invocation that is not a dry run,
including one that purged nothing: the leaks it collects have nothing to do with
retention.

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

| Risk                                                                     | Why it is accepted                                                                                                                                                                                                                                                                                          | Partial mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A guest with the join code can upload anything                           | that is the product; the alternative is per-guest accounts, which kills the zero-friction requirement                                                                                                                                                                                                       | moderation before projection, per-guest rate limit, host can revoke a guest — and a revoked device is refused at the join endpoint too, so the code alone no longer undoes it (§11)     |
| A leaked display URL exposes published photos **and the join code**      | the wall doubles as the invitation — the empty state exists to tell the room how to join, and someone arriving at 23:00 has only the screen to read. Withholding the code there would break the product to protect what the QR code on every table already gives away                                       | only `published` photos are ever served; the host can rotate the join code, which invalidates it immediately; display access can require the join code for private events **(planned)** |
| Guest identity is a device cookie, not a person                          | anonymity is a feature; a cleared cookie means a new guest, and a shared phone means a shared identity. This is also the ceiling on revocation (§11): it refuses the revoked **device**, so clearing cookies or borrowing a phone is a new guest with the same code                                         | grace-window deletion is deliberately short, so a mis-attributed identity has a narrow blast radius; revocation stops the re-scan, and a join-code rotation is what stops the evader    |
| Captions and display names are guest-supplied text on a 3 m screen       | pre-moderating text as well as photos would slow the wall to uselessness                                                                                                                                                                                                                                    | length-bounded, control characters stripped in the domain, rendered as text (React escapes; no `dangerouslySetInnerHTML` anywhere), and the host can hide any photo instantly           |
| Rate-limit state is in-process in the first cut                          | a restart resets buckets                                                                                                                                                                                                                                                                                    | quota is transactional and survives restarts; SQLite-backed limiter store is **(planned)**                                                                                              |
| An event's byte quota can be held by clips that never become photographs | the staged source is charged from the moment it lands, because it is on the disk the quota protects, and released only when the job reaches `done` or `failed`. Both the depth and the byte total are decided inside `ClipJobRepository.stage`'s own transaction, so two uploads in flight cannot both pass | bounded by the event's own queue at `MAX_QUEUED_CLIPS x MAX_CLIP_BYTES`, and released as each clip finishes or fails (§4.1)                                                             |
| One event can fill the clip queue for every event on the box             | backpressure is process-wide because the worker is: one encoder at concurrency 1 serves the whole machine, and the wait a guest experiences is the global one. A per-event cap would admit a clip and then make it queue behind another event's backlog anyway — the same wait, reported as a success       | the deployment target is one venue with one live event; per-event fairness is carried by the byte quota and by the upload limiter, which is keyed by event                              |
| Self-hosted operators own their own patching, TLS, and backups           | there is no hosted control plane to push a fix from                                                                                                                                                                                                                                                         | pinned dependencies, published advisories, and boot-time config refusal so a misconfigured instance never starts quietly                                                                |
| A backup archive is untrusted input with unauthenticated checksums       | signing needs a key, and a key kept beside the archive signs nothing; a self-hosted operator has nowhere to put one that a machine restoring after a total loss can still reach. An archive stays usable by whoever holds it, which is what an attacker uses                                                | paths are constrained at the parse, so an archive no longer chooses where the restore writes; contents are another matter, so restore only from a copy you control (§11)                |
| A malicious host can read every photo in their own event                 | they organised the event; the data is theirs                                                                                                                                                                                                                                                                | per-event roles limit _moderators_ to their own events                                                                                                                                  |
| Anyone holding a shared gallery link reads the published album           | that is what a link is: the host chose to send it, and a link that also demanded an account would never be opened by the aunt it was sent to                                                                                                                                                                | it expires (≤ 90 days), it can carry a password, it can be revoked at once, and it shows only what the room already saw (§15)                                                           |
| A file already downloading from a revoked link finishes                  | a single HTTP response cannot be recalled once its bytes are flowing, and a thumbnail a browser cached (`private`, ≤ 1 h) stays in that browser                                                                                                                                                             | every **new** request is refused at once; a streaming archive re-checks the link before each entry and aborts (§15)                                                                     |
| Revoking a gallery link does not close the event's wall                  | the archive's name and its entries carry the event's slug, and the slug is the wall's address; it is also derivable from the event name the gallery shows, and the wall is public by the second row of this table. Renaming the files would hide nothing a guest does not already hold on a table card      | the wall serves display renditions, never originals, and only while the event is live or closed: **archiving the event** is what closes it (§15)                                        |
| Whoever holds a link can lock its password out for a quarter hour        | the per-link budget counts failures from anywhere, which is what stops a guess spread over many addresses — so fifty wrong passwords from a holder of the token lock the prompt for everyone else too                                                                                                       | the lockout ends by itself after fifteen minutes, and the host can replace the link, which is a new token and a new budget (§15)                                                        |

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

## 14. Advisory audit, 2026-09-18

GitHub Dependabot was enabled on this repository and produced **34 alerts, 28 of them
open**. This section is the answer to the question a version number does not give: which
of those advisories actually reaches a running EventSlide, through which entry point, and
what an attacker at a wedding would get out of it.

The ranking below is by **what a guest can trigger from the upload form**, not by CVSS. A
dev-only "high" that can only hurt a laptop is ranked beneath anything reachable from a
phone in the room.

**The number, stated first: 2 of the 28 open alerts reach a running EventSlide, and both
are `sharp`.** The other 26 are blocked by an architectural property that predates the
advisory — an allow-list, a build-time-only dependency, a rendering mode this app does not
use, or a code path nothing calls. That is not luck in every case, and §14.3 says which
ones are luck.

### 14.1 What each principal can actually do

The advisory verdicts below are only meaningful against this. Every row was read out of
the routers on `chore/security-audit` at `d8f6c0f`.

| Principal                                  | Credential                                                                                                                                  | Verified at                                                                                                 | What it unlocks                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unauthenticated stranger**               | none                                                                                                                                        | —                                                                                                           | `POST /api/join`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/health`, `GET /api/ready`                                             |
| **Stranger who knows a slug**              | none; the event must pass `servesWall()`                                                                                                    | `middleware/authz.ts:170-187`, refusal at `:180`                                                            | `GET /api/events/:eventSlug/wall` (`routes/publicRoutes.ts:163`), the media bytes (`routes/mediaRoutes.ts:235`), the wall SSE stream (`routes/streamRoutes.ts:312`)    |
| **Guest** (a phone with the QR link)       | HMAC device token in `es_guest`                                                                                                             | `middleware/authz.ts:112-161` — signature `:122`, event match `:140`, row exists `:145`, not revoked `:151` | **upload photos** (`routes/guestRoutes.ts:322`), **upload clips** (`routes/clipRoutes.ts:137`), own-photo list, delete own inside the grace window, caption, reactions |
| **Any authenticated user**, no event scope | `es_session` cookie, **trusted from the session payload with no database read** _(since fixed: `requireUser` reads `isActive` — see §14.7)_ | `middleware/authz.ts:22-34` and `:37-43`                                                                    | `GET /api/events`, `POST /api/events` (`routes/eventRoutes.ts:115`, `:131`), `POST /api/auth/password` (`routes/authRoutes.ts:183`)                                    |
| **Moderator of one event**                 | `es_session` plus an `event_memberships` row                                                                                                | `middleware/authz.ts:75` and `:81` via `canModerate` (`domain/events/eventRole.ts:37`)                      | publish/hide/delete photos, bulk moderate, revoke a guest, download `album.zip`                                                                                        |
| **Owner of one event**                     | as above, role `owner`                                                                                                                      | `middleware/authz.ts:81` via `canManageEvent` (`domain/events/eventRole.ts:40`)                             | everything a moderator has, plus settings, lifecycle, join-code rotation, **event deletion**, and **moderator registration**                                           |
| **Operator** (site role)                   | —                                                                                                                                           | —                                                                                                           | **Does not exist on this branch.** See §14.6                                                                                                                           |

`EVENT_ROLES = ['owner', 'moderator']` at `domain/events/eventRole.ts:14`, and
`eventRole.ts:4` states the intent: a role is always per event, there is no global
administrator. Every deliberately public route carries a comment recording the decision
(`routes/authRoutes.ts:76`, `:132`, `:166`, `routes/publicRoutes.ts:94`,
`routes/healthRoutes.ts:43`, `:51`); the audit found **no route with a missing
authorization decision**.

### 14.2 The advisories, mapped

`reachable` means a guest, a stranger or a host can drive attacker-controlled bytes into
the vulnerable code on a default install. Everything else names the thing that stops it.

| Package (installed)                                                                                                               | Advisory                                                                                                          | Scope       | Verdict                                                                                                                            | The line that decides it                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`sharp` 0.34.5** (libheif 1.20.2)                                                                                               | `GHSA-rgj7-g3m4-5g8c`, CVSSv4 **8.9**                                                                             | runtime     | **REACHABLE — from the guest upload form, unauthenticated**                                                                        | `infrastructure/media/magicBytes.ts:74-77` admits it; `sharpImageProcessor.ts:122` and `:181` execute it. See §14.3                                                                                                                        |
| **`sharp` 0.34.5** (libvips 8.17.3)                                                                                               | `GHSA-f88m-g3jw-g9cj`, CVSSv4 7.0                                                                                 | runtime     | **PARTLY REACHABLE** — the advisory names three loaders; the GIF one is reachable, TIFF and VIPS are **blocked by the allow-list** | `magicBytes.ts:65` returns `'gif'`; `magicBytes.ts:58-79` carries **no TIFF and no VIPS signature**, so both are `null` and refused as `image.unsupportedFormat`                                                                           |
| `qs` 6.15.3                                                                                                                       | `GHSA-x5fp-wj9c-mxmx`                                                                                             | runtime     | **not reachable** — the bug needs `comma: true`, which Express never sets and nothing here overrides                               | no `app.set('query parser', …)` anywhere in `src/`; Express 4 builds its own parser at `node_modules/express/lib/middleware/query.js:27`                                                                                                   |
| `qs` 6.15.3                                                                                                                       | `GHSA-4mjr-xmp4-gh2g`                                                                                             | runtime     | **not reachable** — the sink is `qs.stringify()` on a `qs.parse` product. Express only ever parses                                 | no `qs.stringify` on any request path; no direct `qs` import in `src/` or `web/`                                                                                                                                                           |
| `react-router` 7.14.2                                                                                                             | `GHSA-chx6-hx7r-mcp5` (8.7), `GHSA-8x6r-g9mw-2r78`, `GHSA-84g9-w2xq-vcv6`                                         | runtime     | **not reachable — Framework Mode only.** This app is Declarative Mode                                                              | `web/src/main.tsx:81` mounts `<BrowserRouter>`; no `@react-router/dev`, no `react-router.config.*`, no `entry.server.*` in the tree                                                                                                        |
| `react-router` 7.14.2                                                                                                             | `GHSA-qwww-vcr4-c8h2` (7.1), `GHSA-h8fp-f39c-q6mh`                                                                | runtime     | **not reachable — unstable RSC APIs only**, which this app does not import                                                         | as above; there is no RSC entry point                                                                                                                                                                                                      |
| `react-router` 7.14.2                                                                                                             | `GHSA-337j-9hxr-rhxg`                                                                                             | runtime     | **not reachable — SSR hydration only.** There is no server-side render                                                             | `interface/http/server.ts:182` serves the built bundle; `:203` sends a literal `index.html`                                                                                                                                                |
| `react-router` 7.14.2                                                                                                             | `GHSA-wrjc-x8rr-h8h6` — open redirect via backslash                                                               | runtime     | **reachable in principle, already blocked** — the one advisory of the seven that is not mode-gated                                 | every `<Link to>` / `navigate()` target is a constant or a server-issued slug; the single non-constant one is guarded at `web/src/features/auth/LoginPage.tsx:22-25`, and its input is history state (`app/RequireAuth.tsx:56`), not a URL |
| `minimatch` 5.1.6                                                                                                                 | `GHSA-3ppc-4f35-3m26` (8.7), `GHSA-7r86-cg39-jmmj`, `GHSA-23c5-xmqv-rm74`                                         | runtime     | **not reachable — present in the production tree, never invoked**                                                                  | see §14.4                                                                                                                                                                                                                                  |
| `brace-expansion` 2.0.1                                                                                                           | `GHSA-rgw5-rvv9-x895`, `GHSA-mh99-v99m-4gvg`, `GHSA-3jxr-9vmj-r5cp`, `GHSA-f886-m6hf-6m8v`, `GHSA-v6h2-p8h4-qcjw` | runtime     | **not reachable** — same chain, same reason                                                                                        | see §14.4                                                                                                                                                                                                                                  |
| `vite` 8.0.10, `postcss` 8.5.13, `nanoid` 3.3.11, `@babel/core` 7.29.0, `browserslist` 4.28.2, `baseline-browser-mapping` 2.10.24 | 8 advisories                                                                                                      | development | **not reachable — cannot touch a running instance.** They can hurt a developer's laptop or a CI runner and nothing else            | see §14.5                                                                                                                                                                                                                                  |

### 14.3 `sharp`: a real path from the guest upload form to libheif

**Write it plainly: this is remote code execution reachable from an unauthenticated guest
upload, and it should be upgraded today.** A branch carrying the fix already exists.

The trace, byte by byte, with nothing omitted:

| #   | Step                                                                                                                                | Where                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | A guest with the QR link posts multipart to `POST /api/events/:eventSlug/photos`, field `photos`, up to 20 files                    | `routes/guestRoutes.ts:322`                                                                                 |
| 2   | `uploadLimiter` (12/min per IP and event) and `requireGuest` pass — a guest at the wedding satisfies both by design                 | `middleware/rateLimit.ts:93`, `middleware/authz.ts:112`                                                     |
| 3   | multer buffers the file **in memory**, unmodified. No `fileFilter`, by decision (§4 step 3)                                         | `routes/guestRoutes.ts:302-309`                                                                             |
| 4   | `probe()` calls `detectImageFormat`, which reads `ftyp` at offset 4 and **returns `'heif'` or `'avif'` for the HEIC/AVIF brands**   | `infrastructure/media/magicBytes.ts:74-77`, brand sets at `:44-45`                                          |
| 5   | Those bytes, still unmodified, are handed to `sharp(...).metadata()` — the libvips HEIF loader, that is, **libheif 1.20.2**         | `infrastructure/media/sharpImageProcessor.ts:122`                                                           |
| 6   | If the header survives, `renderVariants` decodes the **same original bytes three more times** for `display`, `thumb` and `original` | `usecases/photos/uploadPhotos.ts:268` to `:132`, `:135`, `:138`, each reaching `sharpImageProcessor.ts:181` |

So libheif executes **four times per HEIC file**, on bytes the attacker fully controls, up
to 20 files per request.

**What narrows it: nothing.** Each candidate control was checked and each one fails to
help.

- **The magic-byte gate does not narrow it — it is what admits it.** The allow-list holds
  six formats and two of them are the vulnerable ones. `heif` and `avif` are in
  `SUPPORTED_INPUT_FORMATS` (`application/ports/imageProcessor.ts:22`) and the brands are
  recognised deliberately, with a comment at `magicBytes.ts:41-42` explaining why: _"These
  are what a modern iPhone and a modern Android actually produce, so getting them wrong
  means rejecting most guests' photos."_ That reasoning is correct and the feature is the
  product. It is also exactly the exposure.
- **The pixel budget does not narrow it.** It is applied at `sharpImageProcessor.ts:135`
  and `:141`, **after** `metadata()` at `:122` has already run libheif's parser. A heap
  overflow in a header parser has already happened by the time the budget is consulted.
- **multer's limits do not narrow it.** `MAX_UPLOAD_BYTES` is 25 000 000
  (`infrastructure/config/env.ts:182`). These are heap overflows in a container parser;
  they do not need a large file.
- **`sharp.block()` is not called anywhere.** The advisory's own workaround,
  `sharp.block({ operation: ['VipsForeignLoadHeif'] })`, appears nowhere in the tree — and
  applying it would refuse every iPhone photo, which is the product.
- **The re-encode does not narrow it.** "Stored bytes are always pipeline output" (§4) is
  a control against _serving_ a payload back. It is not a control over the decoder itself,
  which is where this bug lives.

**Two deployment facts make the glibc-RCE precondition in the advisory the normal case
here rather than an edge case.** The runtime image is `node:24-bookworm-slim`
(`Dockerfile`), which is glibc Debian — the platform the advisory names. And the advisory
asks for a `node` binary built as a Position Independent Executable, noting that the
official Node.js binaries are not; the official `node:` Docker images ship those binaries.
The mitigation the advisory leans on is therefore absent on a default `docker compose up`.

The systemd hardening in §11 (`NoNewPrivileges`, `ProtectSystem=strict`,
`ReadWritePaths=`) and the container's non-root `USER node` bound what a successful
exploit reaches. They do not prevent it. What an attacker gets is code execution as the
user that owns `/data` — which is every photograph, every session row and every password
hash on the box.

The second `sharp` advisory is the instructive contrast, because there the allow-list
**does** do the work. `GHSA-f88m-g3jw-g9cj` names three libvips loaders. `magicBytes.ts`
carries no TIFF signature and no VIPS signature, so both files come back `null` at
`sharpImageProcessor.ts:102` and are refused as `image.unsupportedFormat` before `sharp`
is constructed. Only `VipsForeignLoadNsgif` is reachable, via `magicBytes.ts:65`. One of
three — and that is the strongest available argument for keeping the allow-list narrow.

### 14.4 `minimatch` and `brace-expansion`: in the production tree, and still not reachable

Dependabot labels these `runtime` scope and it is **right** — they are genuinely in the
pruned production image, and the Dockerfile prune step is not what saves us. The single
vulnerable chain is:

```
archiver@7.0.1              a real production dependency
  readdir-glob@1.1.3
    minimatch@5.1.6         vulnerable
      brace-expansion@2.0.1 vulnerable
```

`npm ls --omit=dev` keeps all four. The other copies — `minimatch@10.2.5` and
`brace-expansion@5.0.5` under `eslint` and `typescript-eslint`, and `minimatch@9.0.9` with
`brace-expansion@2.1.4` under `glob` — are either outside the vulnerable range or removed
by `npm prune --omit=dev`, which `scripts/verify-image.sh:122-128` and `:145-149` assert by
refusing an image that still carries a devDependency.

**What makes them unreachable is the call site, not the tree.** Both advisory classes are
denial of service driven by a hostile **glob pattern** — `minimatch` backtracking at
O(4^N) on consecutive `*`, `brace-expansion` building unbounded intermediate arrays. They
need an attacker-supplied pattern.

`readdir-glob` is only ever entered through `Archiver.prototype.glob` and
`Archiver.prototype.directory` (`node_modules/archiver/lib/core.js:9`, used at `:720`).
**EventSlide calls neither.** The only `archiver` usage in the tree appends one
pre-resolved stream per photo, at `infrastructure/media/archiverWriter.ts:57`:

```
archive.append(source, { name: entry.name, date: entry.modifiedAt })
```

No glob pattern is constructed anywhere in `src/`, so none can be attacker-supplied. The
module is loaded and its vulnerable function is never called.

Stated as a rule rather than a coincidence, because this is the part that could change:
**if anyone adds `archive.glob()` or `archive.directory()` to `archiverWriter.ts`, or
introduces any glob whose pattern is derived from a request, these eight advisories become
live.** That is the trigger to reopen this row.

### 14.5 The dev-only ones, and where they stop

`vite`, `postcss`, `nanoid`, `@babel/core`, `browserslist` and `baseline-browser-mapping`
are build- and lint-time only. Every one is **absent from `npm ls --omit=dev`**, which is
the exact tree `npm prune --omit=dev` produces in the `production-deps` stage of the
`Dockerfile` and the only `node_modules` copied into the runtime image.

```
vite@8.0.10 -> postcss@8.5.13 -> nanoid@3.3.11
eslint-plugin-react-hooks@7.1.1 -> @babel/core@7.29.0 -> browserslist@4.28.2 -> baseline-browser-mapping@2.10.24
```

Neither chain is imported by anything under `src/` or shipped in the client bundle —
`nanoid` is postcss's source-map id generator, not an application dependency.
`scripts/verify-image.sh:145-149` fails the build if `typescript`, `vitest`,
`@playwright/test`, `eslint`, `prettier` or `tsx` reach the image, and `:137` fails it if a
compiler does.

**They can hurt a developer or a CI runner and nothing else.** The two `vite` advisories
are dev-server issues and there is no dev server in production. Patch them on the ordinary
dependency cadence; none of them is an event-night problem. That is the whole finding, and
padding it further would only dilute §14.3.

### 14.6 The operator role is not here yet

Roadmap 10.1's `site_role` column and `requireOperator` middleware are **not on `main`
(`d8f6c0f`) and not on this branch** — `grep -rn 'site_role\|requireOperator' src/ docs/`
is empty. They exist only on an unmerged sibling branch. The principal table in §14.1 is
therefore complete as shipped.

One property of that branch is worth recording now, because it bears directly on §14.7:
its `requireOperator` re-reads the role from the database on every request, and the query
is `SELECT site_role FROM users WHERE id = ? AND disabled_at IS NULL`, so a disabled
operator is refused. That was precisely the behaviour `requireRole` did **not** have when
this was written; `roleFor` now carries the same `disabled_at IS NULL` clause, which is
where that observation led. See §2 and §14.7.

### 14.7 Confirmations, corrections, and what the alerts cannot see

#### `disabled_at` is enforced at exactly one line — CONFIRMED, and since **FIXED**

> **Fixed.** Every claim below was true when this audit was written and none of them is
> true now; §2 "Disabling an account" is the current contract and this entry is kept as the
> record of what was found. What changed: the two authorization reads answer it — `roleFor`
> returns `null` for a disabled account exactly as `siteRoleFor` returns `none`, which
> closes `requireRole` **and** the nineteen use cases that ask an actor's role for
> themselves, `registerModerator` among them; `requireUser` reads
> `UserRepository.isActive` for the routes that name no event; and `enforceSessionAge`
> gives the session an absolute 7-day cap, so the window is bounded even where nothing
> else looks. Point 1 still stands in one respect and deliberately so: there is still no
> disable **use case**, because a route or console to switch an account off is roadmap §10
> and this branch built the enforcement rather than the administration of it.

`user.canSignIn()` (`domain/users/user.ts:102`) has **one** production caller:
`usecases/auth/authenticateUser.ts:101`. `middleware/authz.ts` never reads the `users`
table at all — `attachUser` (`:22-34`) trusts the session payload with no I/O, and
`requireRole` loads the event (`:69`) and the membership row (`:75`) and nothing else.

The asymmetry is the finding: **the anonymous guest is revocable in real time
(`authz.ts:145`, `:151`) and the authenticated host is not.** The weaker principal has the
stronger revocation story.

Three facts make this worse than "their session keeps working for 12 h":

1. **There is no disable use case at all.** `src/application/usecases/` has no `users/`
   directory, and `User.disable()` (`user.ts:135`) has no production caller. The only way
   to disable an account today is a manual `UPDATE` against SQLite — and nothing correlates
   a `sessions` row to a `user_id`, so there is nothing to invalidate even by hand.
2. **The window is not 12 hours, it is unbounded.** `server.ts:95` sets `rolling: true` and
   `:101` a 12 h `maxAge`; `sqliteSessionStore.ts:113-116` pushes `expires_at` forward on
   every request. A disabled host with a tab open never expires.
3. **A disabled owner can mint a fresh enabled account.** `POST /api/events/:eventSlug/moderators`
   (`routes/eventRoutes.ts:387`) reaches `usecases/auth/registerModerator.ts:112`, which
   calls `User.create` — and `user.ts:56` sets `disabledAt: null` — then saves it at `:126`
   with a password the caller learns. That converts a bounded window into indefinite
   access. `POST /api/auth/password` (`routes/authRoutes.ts:183` to `changePassword.ts:38`)
   likewise never consults `canSignIn()`.

**§2's `(defect)` marker on the absolute session cap is correct. §6's claim that one exists
is wrong** — `absoluteExpiresAt` appears nowhere in `src/` or `web/`, only in this
document's own §6 row. _(Both entries are now obsolete: the cap exists, in a third shape —
`issuedAt` written at login, compared by `enforceSessionAge` against a 7-day ceiling.)_

#### `requireGuestOwnsPhoto` — the skill is wrong, this document is right

`.claude/skills/eventslide-http-endpoint/SKILL.md:93` lists `requireGuestOwnsPhoto()` as
the **fourth row of the normative middleware table** under "Authorization — declare it,
per route", sitting between two middlewares that do exist. It exists nowhere in `src/`. §2
of this document is correct and the skill is not. An agent told to pick a row for every
route would reach for a middleware that does not compile.

#### Secrets: the check is real, the default is not safe — since **FIXED**

> **Fixed.** The paragraph below was true when this audit was written. `NODE_ENV` now
> defaults to `production`, a blank one counts as absent, and the two repository-public
> constants are **deleted** — a boot outside production generates 48 random bytes per
> secret instead, so the five controls this entry lists are on unless somebody explicitly
> asked for development, and there is no published constant left for any configuration to
> select. The boot log names the arrangement; `/api/ready` deliberately still does not, as
> it answers an unauthenticated caller. `scripts/verify-image.sh` drives the refusal
> against the built image with `NODE_ENV=` blanked. The two smaller divergences in the last
> paragraph — the secrets not being required to differ, and the missing `Origin`/`Referer`
> check — are **unchanged and still true**. See §10.

`SESSION_SECRET` and `GUEST_TOKEN_SECRET` are held to 32 characters and a placeholder
blocklist by `config/env.ts:36-42`, environment-independently, and
`crypto/hmacGuestTokenService.ts:56-58` throws rather than sign with a short key — §2's
claim is CONFIRMED. Production boot refuses when either is absent (`env.ts:306-316`).

**The gap is that `NODE_ENV` defaults to `development` (`env.ts:165`), and non-production
substitutes two hardcoded, repository-public constants (`env.ts:493-494`).** A self-hosted
operator who runs the built server without setting `NODE_ENV` gets, in one step and with no
warning: both secrets as public constants, `secure` cookies off (`env.ts:500`), no HSTS
(`middleware/securityHeaders.ts:65`), no `upgrade-insecure-requests` (`:48`), and
`script-src 'self' 'unsafe-inline'` (`:23`). Nothing in the boot log or `/api/ready` says
which arrangement is in force.

Two smaller divergences. The two secrets are **not** required to differ — §2 says
"separate from `SESSION_SECRET`" and no code compares them. And the `Origin`/`Referer`
check that §7 lists as "also checked" and §10 credits to `PUBLIC_URL` **does not exist**:
`middleware/csrf.ts:147-165` reads a cookie and a header and nothing else. The
double-submit token itself is correctly built — `timingSafeEqual` at `csrf.ts:138-145`,
mounted globally at `server.ts:116` **ahead of both multer instances** (`:133`, `:137`), so
multipart uploads are genuinely covered, as §7 claims.

#### Shell and path traversal: both clean

- **Nothing user-controlled reaches a shell, because there is no shell.**
  `infrastructure/media/runProcess.ts:230-234` is the only `child_process` use in `src/`;
  it is `spawn` with an **argv array**, and `shell` is never set anywhere in the tree. Every
  ffmpeg and ffprobe argv element is a server constant, a closed-union demuxer name
  (`ffmpegVideoTranscoder.ts:113-116`), or an integer from `Dimensions`. Paths are `mkdtemp`
  directories plus the literals `in.bin`, `out.mp4` and `poster.jpg`, each `file:`-prefixed.
  §4.1's claims about `-protocol_whitelist file`, the pinned `-f` demuxer, the absence of
  `-c copy`, `-map 0:v:0 -map 0:a:0? -dn -sn` and the double `yuv420p` are all CONFIRMED at
  `ffmpegVideoTranscoder.ts:311`, `:313`, `:464-467`, `:483-491`, `:497` and `:510`.
- **No guest string reaches a path segment.** `fsMediaStore.ts:99-115` builds paths from a
  `randomUUID` event id, a closed-union variant and a `/^[0-9a-f]{64}$/` digest, each
  re-validated at the store boundary, with an explicit `startsWith(absoluteRoot + sep)`
  containment check at `:111-113`. `originalname` is carried as `declaredName` metadata
  (`routes/guestRoutes.ts:347`, `routes/clipRoutes.ts:186`) and is deliberately kept out of
  the response body (`presenters/presenters.ts:443-456`). `express.static` serves only the
  built web bundle (`server.ts:182`), never `MEDIA_ROOT`.

One hardening note rather than a hole: `runProcess.ts:230-234` passes neither `env` nor
`cwd`, so ffmpeg children inherit the server's full environment, including both secrets. No
guest input reaches it; an explicit minimal `env` would be defence in depth.

#### Availability: what a guest can still do to the box

| Question                 | Answer                                                                                                                                                                                                                                                           | The line                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fill the disk?           | **Yes, eventually.** The quota is per event and there is **no global ceiling and no free-space check** anywhere: 5 GB default per event (`env.ts:186`) times unbounded events, and `maxPhotosPerGuest` defaults to `null` (`domain/events/eventSettings.ts:105`) | no `statfs` or `checkDiskSpace` in `src/`                                                              |
| Exhaust the clip queue?  | **Yes, box-wide, in about two minutes.** The depth query has **no `WHERE event_id`**                                                                                                                                                                             | `sqliteClipJobRepository.ts:210-212`                                                                   |
| Exhaust the heap?        | **Plausibly.** The limiter bounds requests per minute, not concurrency: 12 in flight against the 150 MB per-request cap (`routes/guestRoutes.ts:122`) versus `memory: 1g` (`compose.yaml:136`)                                                                   | `compose.yaml:127-132` concedes this in writing                                                        |
| Take the SSE wall down?  | **No.** 12 per client, 200 per event, 500 per process, all refusing cleanly before headers are written                                                                                                                                                           | `middleware/rateLimit.ts:109`, `:119`, `realtime/inMemoryEventBus.ts:42`, `routes/streamRoutes.ts:295` |
| Spoof `X-Forwarded-For`? | **No at either default.** `trust proxy` is an explicit hop count, never a boolean                                                                                                                                                                                | `server.ts:59`, `env.ts:177`                                                                           |

The quota itself is correctly built and §5's claim about it holds: an `.immediate()`
transaction with the `SUM` inside it, spanning `photos` and staged clip sources
(`sqlitePhotoRepository.ts:661`, `:679`; `sqliteClipJobRepository.ts:316`, `:328`).

#### Corrections to earlier sections of this document

Recorded rather than silently edited, because "Status of this document" says a claim that
cannot be traced to a file must be marked, never left standing.

| Section     | Claim                                                                            | What the code says                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6 Timeouts | "idle 2 h, absolute 12 h from `session.absoluteExpiresAt` checked in middleware" | **Both halves were wrong** when this was written: idle was 12 h and no absolute cap existed. Both are now true in a different shape — idle 12 h, absolute **7 days**, held by `enforceSessionAge` against a `issuedAt` the login writes. See §2 |
| §6, §9, §10 | the cookie `es_sid`                                                              | It is `es_session` (`server.ts:88`, `routes/authRoutes.ts:32`). §2's table has it right                                                                                                                                                         |
| §8          | `default-src 'none'`                                                             | `defaultSrc: ["'self'"]` — `middleware/securityHeaders.ts:20`                                                                                                                                                                                   |
| §8          | `style-src 'self'` plus a narrow `style-src-attr 'unsafe-inline'`                | `styleSrc: ["'self'", "'unsafe-inline'"]` and **no `styleSrcAttr` directive at all** — `securityHeaders.ts:28`. The code ships the broader hole the doc says it avoided                                                                         |
| §8          | `base-uri 'none'`                                                                | `baseUri: ["'self'"]` — `securityHeaders.ts:43`                                                                                                                                                                                                 |
| §8          | helmet lives in `server.ts`                                                      | `middleware/securityHeaders.ts:15-74`, mounted at `server.ts:65`                                                                                                                                                                                |
| §8          | HSTS 180 days                                                                    | 365 days — `securityHeaders.ts:66`. Here the code is stricter than the doc                                                                                                                                                                      |
| §7, §10     | an `Origin` / `Referer` check against `PUBLIC_URL`                               | Does not exist — `middleware/csrf.ts:147-165`                                                                                                                                                                                                   |
| §5          | `GET /api/join/:code` limited per code as well as per IP                         | **That route does not exist.** The code is resolved inside `POST /api/join`, limited per IP only — `routes/publicRoutes.ts:94`                                                                                                                  |
| §5          | the SSE hub "drops the oldest idle connection rather than refusing"              | It **refuses**, cleanly and before headers — `middleware/rateLimit.ts:156-168`, `routes/streamRoutes.ts:295`. The per-IP and per-event numbers in that table are also wrong: the code is 12 per client, 200 per event, 500 per process          |
| §8          | "fonts are bundled, self-hosted"                                                 | No font is shipped; `CLAUDE.md` §8 already corrected this. `font-src 'self'` is right, the note beside it is not                                                                                                                                |

None of these is a reachable vulnerability on its own. They matter because this document is
what the next reviewer audits against, and four of them describe a control that is not
there.

## 15. The shared gallery — the first public read surface

Roadmap §4.1. A link the host makes after the event and sends to the guests: the
published album, full resolution, optionally behind a password, with an expiry. Every
other surface a stranger reaches shows what a projector in a room already shows; this one
hands out the originals, so it was built as a public surface from the first line. The
code is `src/application/usecases/gallery/` (the rule is `galleryAccess.ts`),
`src/interface/http/routes/galleryRoutes.ts` and `shareLinkRoutes.ts`, and the signer is
`src/infrastructure/crypto/hmacGallerySigner.ts`.

| Control                                              | How                                                                                                                                                                                                                                                                                                                               | Held by                                                                                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The token is unguessable and not stored              | 32 random bytes, base64url, in the URL; the row holds its SHA-256, and a `CHECK` refuses anything that is not 64 hex characters. A fast hash is right: the secret is random, not chosen, and the lookup has to be an index seek                                                                                                   | `ShareLink.create`, migration 007, `hmacGallerySigner.test.ts`, the shared repository contract                                                                                                        |
| One answer for every dead link                       | an unknown, malformed, expired or revoked token, a link whose creator is switched off or no longer an owner, and a purged event: `404 gallery.notAvailable`, byte for byte, on every route                                                                                                                                        | `openGallery.test.ts`, `galleryRoutes.test.ts` ("one refusal, byte for byte")                                                                                                                         |
| A link lives only as long as its creator's authority | `roleFor(eventId, createdBy)` must answer `owner`, read on **every** request — the same per-request rule as sessions (§2), so suspending an account or demoting an owner ends their links at once, and re-enabling gives them back                                                                                                | `galleryAccess.eventBehind`; ring 2 and ring 4 cases for a disabled and a demoted creator                                                                                                             |
| Only what the wall shows                             | `published`, read per request; never `pending`, `rejected` or `hidden` — narrower than the host's own ZIP                                                                                                                                                                                                                         | `isInSharedGallery`, and a case per status at rings 2 and 4                                                                                                                                           |
| Every link expires                                   | 1–90 days, a month by default; the host cannot choose "never"                                                                                                                                                                                                                                                                     | `ShareLinkLifetime`                                                                                                                                                                                   |
| One current link per event; replacing it is atomic   | a partial unique index over unrevoked rows; `replaceCurrent` revokes and inserts in one transaction, and a refused insert leaves the old link current                                                                                                                                                                             | migration 007, the shared repository contract (fake **and** SQLite)                                                                                                                                   |
| The password is a second factor, not a URL parameter | posted in a body, hashed by the account hasher under the account policy; after a match, an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/gallery`, holding an expiry and a MAC over the link id — never the password, never the token — for two hours or the link's remaining life                                         | `unlockGallery.ts`, `galleryRoutes.test.ts` (cookie flags)                                                                                                                                            |
| Guessing is bounded                                  | failures only, per client (10) **and** per link (50), per quarter hour; a dead link is refused before any hash is compared, so it costs no bcrypt. Every unlock, right password or not, also spends the client's page budget (120 a minute), so knowing the password does not buy unlimited hash verifications                    | `galleryUnlockLimiters` behind `galleryLimiter`; ring 4 cases for both limits, for successes not counting, for correct passwords being bounded, and for a page-budget refusal not counting as a guess |
| Media by signed URL, never by token                  | HMAC-SHA256 over the link id, photo id, rendition and expiry, one hour, never past the link. Checked in constant time **before** any storage read; then the expiry; then the link, **now** — so revoking kills every URL at once; then the photograph, looked up in the link's own event                                          | `getGalleryMedia.ts`; ring 4 cases for each tampered field and for another link's signature                                                                                                           |
| Domain-separated keys                                | the signing key is HKDF-derived from `SESSION_SECRET` under `eventslide/gallery/v1`, and every signed statement is length-prefixed with its purpose first, so no gallery signature verifies as another kind and nothing `express-session` signs is one                                                                            | `hmacGallerySigner.ts`, the shared signer contract                                                                                                                                                    |
| Originals carry no coordinates                       | the download is the stored `original`, which is the ingest re-encode with EXIF, GPS, XMP and ICC dropped (§4 step 7); a clip's download is its transcode (§4.1)                                                                                                                                                                   | `sharpImageProcessor.test.ts`, and `shared-gallery.spec.ts`, which downloads through a real browser and reads the bytes                                                                               |
| Nobody indexes it, nothing leaks it                  | `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every response and on the `/g/*` shell, plus `<meta name="robots">` in the page; a thumbnail is at most `private` for its grant's remaining life                                                                               | `galleryRoutes.test.ts`, `server.test.ts`, `shared-gallery.spec.ts`                                                                                                                                   |
| A forged page cursor never reaches the repository    | cursors are sealed per link; anything else is `400 gallery.cursorInvalid` rather than the repository's own throw                                                                                                                                                                                                                  | `listGalleryPhotos.test.ts`                                                                                                                                                                           |
| The token stays out of the logs                      | every request is logged under `loggablePath`, which writes `/g/<token>` and `/api/gallery/<token>/…` as `:token`, in any letter case, since Express routes them all the same; the media URLs carry a link id and a signature and are logged as they are                                                                           | `errorHandler.test.ts` ("never carries a gallery token")                                                                                                                                              |
| Guests are told before they upload                   | the §5.1 notice names `sharedGallery` as an audience on **every** event: the host may send the published album through a private link, which can be forwarded, until it expires or is withdrawn. Not conditioned on a live link, because a link is usually made after the guest's last upload and a closed event never asks again | `privacyNotice.test.ts`, `noticeVocabulary.test.ts`, the five `upload.noticeAudiences` tables                                                                                                         |

**A link-preview bot learns nothing.** Messaging apps fetch a pasted URL to draw a preview.
What they get at `/g/<token>` is the SPA shell — the album is loaded by the page's script —
with `noindex` on it, so the preview is the product's generic card and nothing of the
event.

**The residuals**, also in §12: whoever holds a link without a password reads the album,
by design; a single file already downloading when the link is revoked finishes, and a
thumbnail a browser cached stays in that browser for at most its grant's hour; revoking a
link leaves the event's wall where it was — the archive's file names carry the slug, which
is the wall's address — and archiving the event is what closes that; a holder of the token
can spend the link's fifty failed attempts and lock its password prompt for fifteen
minutes, which replacing the link undoes; the rate limits are in-process, like every other
limit here (§5), and every budget is per address, so a household behind one IP shares it.
