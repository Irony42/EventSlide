# API — EventSlide 2.0

The HTTP contract. This document is the specification the server implements and the web
client consumes; when they disagree, this file is right and one of them is a bug.

Maintained by hand. An undocumented endpoint is an incomplete one — see
`.claude/skills/eventslide-http-endpoint/SKILL.md`.

> **Status.** Every route below is implemented, merged to `main` (the `deuxpointzero`
> branch it shipped on is gone from `origin`); nothing is marked **(planned)** any more.
> Last audited end to end against `src/interface/http/routes/*.ts`,
> `schemas/requestSchemas.ts` and `presenters/dto.ts`. Where this document and the code
> still disagree, §9 says so by name rather than leaving the reader to find out from a 400.

---

## 1. Conventions

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Base path       | `/api`                                                             |
| Encoding        | JSON, UTF-8. Uploads are `multipart/form-data`.                    |
| Timestamps      | ISO-8601 UTC strings, e.g. `2026-06-20T21:04:11.031Z`              |
| Ids             | Opaque UUIDv4 strings. Never assume order or meaning.              |
| Empty success   | `204 No Content` with no body                                      |
| Path parameter  | Written `:slug` here; the Express router spells it `:eventSlug`    |
| JSON body limit | 64 KB. Over it: `413 request.tooLarge`. Uploads go through multer. |

### Request validation

Every body, query string and path parameter is parsed by zod before it reaches a use
case (`src/interface/http/schemas/requestSchemas.ts`). Two consequences are part of this
contract:

- **Every body and every query schema is `.strict()`.** An unexpected field is a **400**,
  not a silently ignored key. A client that sends `{ "name": …, "colour": … }` to an
  endpoint that knows nothing about `colour` is told so, rather than believing the value
  took effect. This applies to query strings too — including the wall's, which is why a
  projector URL must not carry tracking parameters.
- **A schema failure is always `400 request.invalid`**, never a per-field code.
  `details.fields` names up to ten offending paths, comma-separated, and never echoes
  the values:

  ```json
  {
    "error": {
      "code": "request.invalid",
      "message": "…",
      "details": { "fields": "joinCode" }
    }
  }
  ```

  The per-field codes documented under each endpoint (`joinCode.wrongLength`,
  `caption.tooLong`, `displayName.tooLong`, …) come from the **domain**, one layer
  further in. The two limits are deliberately layered: zod bounds the string loosely so
  an unbounded payload cannot reach the parser, and the value object applies the real
  rule and names it. A 120-character `displayName` is `400 displayName.tooLong`
  (the limit is 40); a 121-character one never reaches the domain and is
  `400 request.invalid`.

### Errors

Every failure has the same body:

```json
{ "error": { "code": "photo.notFound", "message": "…", "details": {} } }
```

`code` is a **stable machine string** and part of this contract; renaming one is a
breaking change. `message` is for logs and developers — the client picks the sentence
from `code` via `web/src/lib/i18n/`, in the language the reader is in, and must never
display `message`. `details`
carries structured context (`{ "max": 140 }`) and never a path, a SQL fragment, or
personal data.

Status codes come from the domain error kind, mapped in one place
(`src/interface/http/presenters/send.ts`):

| Kind              | Status | Meaning here                                           |
| ----------------- | ------ | ------------------------------------------------------ |
| `invalid`         | 400    | The request could not be parsed into valid values      |
| `unauthenticated` | 401    | No principal, or an invalid/expired credential         |
| `forbidden`       | 403    | A principal, but not one allowed to do this            |
| `notFound`        | 404    | Absent, **or** present but outside the caller's scope  |
| `conflict`        | 409    | Collides with existing state, or an illegal transition |
| `quotaExceeded`   | 413    | A deliberate limit stopped the action                  |
| `rateLimited`     | 429    | Too many attempts. `Retry-After` is set                |
| `unexpected`      | 500    | A bug or an unavailable dependency                     |

**404 and 403 are used deliberately.** A photo, guest or reaction belonging to another
event returns **404**, not 403 — a 403 would confirm the resource exists and turn the
endpoint into an enumeration oracle. 403 is only for a principal who is genuinely in
scope but lacks the role.

Concretely, in `middleware/authz.ts`: no session on an event-scoped route is
`401 auth.required` **before** the slug is looked up, so an anonymous request cannot be
used to discover which events exist; a session with no membership of that event is
`404 event.notFound`; and a member whose role is too weak for the route is
`403 auth.forbidden` with `details.required`. The use cases repeat the same three
answers, so the rule holds even when one of them is called from somewhere else.

### `mustChangePassword` — enforced server-side

A signed-in account whose `mustChangePassword` is set gets `403
auth.passwordChangeRequired` on **every** mounted `/api` route except three:

- `GET /api/auth/me` — so the client can still learn the flag is set at all
- `POST /api/auth/password` — the only way to clear it
- `POST /api/auth/logout` — leaving is never refused

`GET /api/health` and `GET /api/ready` are mounted ahead of the whole session stack and
carry no principal to ask about, so this does not apply to them either — not an
exemption, since there is nothing here for it to exempt. Every other route, including
ones that would otherwise be reachable by anyone (the wall, `POST /api/join`), is refused
the moment the caller is signed in with the flag set: the flag is about the account, not
about the route. `middleware/authz.ts`'s `requirePasswordCurrent` is the gate, mounted on
`/api` ahead of every router; `docs/SECURITY.md` §2 has the fuller argument, including why
the flag is read from storage on every request rather than carried in the session cookie.
Today only `web/src/features/auth/MustChangePasswordGate.tsx` — a client-side redirect —
enforced this; the gate above is what makes it authoritative rather than a courtesy to a
cooperating browser.

### Cross-cutting error codes

These are not attached to one endpoint and every client must handle them. Each has copy
in `web/src/lib/i18n/fr.ts` — and, because `errors` is one of the translated sections,
in the other four tables too, which the build enforces. A code with none renders the
generic fallback sentence to a guest, which is why the lists are kept in step.

| Code                          | Status | When                                                                             |
| ----------------------------- | ------ | -------------------------------------------------------------------------------- |
| `request.invalid`             | 400    | Any zod failure: wrong type, out of bounds, unexpected field                     |
| `request.tooLarge`            | 413    | A JSON body over 64 KB                                                           |
| `request.csrfMissing`         | 403    | No `es_csrf` cookie, or no `X-CSRF-Token` header                                 |
| `request.csrfMismatch`        | 403    | The header does not equal the cookie                                             |
| `auth.required`               | 401    | A route needs a principal and there is none                                      |
| `auth.forbidden`              | 403    | In scope for the event, role too weak; or not the site operator                  |
| `auth.passwordChangeRequired` | 403    | Signed in, `mustChangePassword` set, and the route is not one of the three below |
| `auth.invalidToken`           | 400    | A password-reset link that is dead for any reason (see `confirm`)                |
| `auth.secondFactorRequired`   | 403    | An operator's session has not passed the second factor and the box requires it   |
| `auth.stepUpRequired`         | 403    | An irreversible action without a password-and-code confirmation made in 5 min    |
| `auth.invalidSecondFactor`    | 401    | A code or recovery code that is wrong, spent, or of the wrong shape              |
| `auth.secondFactorExpired`    | 401    | The half-finished sign-in is over (see `login/2fa`)                              |
| `feature.unavailable`         | 404    | A feature this box is not configured for (today: reset by mail, with no relay)   |
| `guestToken.expired`          | 401    | The device token is past its 36 hours                                            |
| `guestToken.badSignature`     | 401    | The device token does not verify                                                 |
| `guestToken.malformed`        | 401    | The token is unreadable, or its guest row no longer exists                       |
| `route.notFound`              | 404    | No such `/api` endpoint — answered in the API's own error shape                  |
| `server.unexpected`           | 500    | A bug. `details.requestId` matches the `X-Request-Id` header                     |

### Principals

| Principal            | Credential                                                                        | Established by         |
| -------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| **Host / moderator** | `es_session` cookie, `HttpOnly` `SameSite=Lax`                                    | `POST /api/auth/login` |
| **Guest**            | `es_guest` cookie, `HttpOnly` `SameSite=Lax`, HMAC-signed and scoped to one event | `POST /api/join`       |
| **Link holder**      | a gallery token in the path; for a protected link, an `es_gallery` unlock cookie  | a host, §6 share link  |
| **Public**           | none                                                                              | —                      |

A guest token grants: upload to **that one event** while it is `live`, deletion of
**their own** photo inside the grace window, a caption on their own pending photo, a
reaction, and reading and acknowledging the event's privacy notice for **that device**.
Nothing else. It is checked against the event in the URL on every request,
and the named guest row must not be revoked.

A gallery token grants one thing: reading the **published** photographs of one event, in
full resolution, while the link is open and its creator still owns the event. It is not a
guest token and carries no event in the URL; §2's shared gallery routes resolve everything
from it.

### `/api/site` and `/api/site/*` — reserved for the box's operator

The namespace for running one box for other people (roadmap §10.9): `/api/site` itself and
every path below it, at a segment boundary — `/api/sites` is not in it and answers as any
unknown path does. **No route is mounted in it yet**; the clients, invitations and
ceilings of roadmap §10.2–§10.8 will be, each documented here when it ships.

A state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) without a valid token meets
CSRF (below) first, in both modes — `403 request.csrfMissing` or `request.csrfMismatch` —
before this table applies. What is already contract is how the namespace itself answers
once a request is past that gate:

| `SITE_ADMIN`                      | Caller                                                           | Answer, on `/api/site` or any `/api/site/*` path                                   |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `off` _(default)_                 | anybody, signed in or not, operator or not                       | `404 route.notFound` — status, body and headers exactly as for a path nobody wrote |
| `on`                              | no session                                                       | `401 auth.required`                                                                |
| `on`                              | signed in, not the operator — or an operator now disabled        | `403 auth.forbidden`, `details: { "required": "operator" }`                        |
| `on`, `REQUIRE_OPERATOR_2FA=true` | the operator, whose session has **not** passed the second factor | `403 auth.secondFactorRequired` — see "The second factor" in §5                    |
| `on`                              | the operator, on a path no route claims                          | `404 route.notFound`, as anywhere else under `/api`                                |

Off, the namespace is **not mounted**, rather than mounted and refusing, so a box that never
asked for administration exposes no operator surface at all. That does not hide the mode,
and is not meant to: the table answers an anonymous caller `401` in one mode and `404` in
the other, and `features.siteAdmin` on `GET /api/about` (§2) states it outright. On, `requireOperator` is
applied to the namespace as a whole, so every route that lands under it inherits the check
without restating it. The operator is the account whose site role is `operator`, read from
storage on every request, and the role grants nothing inside any event — docs/SECURITY.md §2.

The web client does not probe this namespace to learn the mode. It will read
`features.siteAdmin` from the public instance-information endpoint, `GET /api/about` (§2),
which is derived from the very setting that decides whether the namespace is mounted, so
the two cannot disagree. (Nothing in the SPA reads it yet: the `/admin/site` screens it
gates do not exist.)

**No client route exists yet.** Clients (roadmap §10.2) have a domain, a port, a SQLite
adapter and five use cases (`createClient`, `renameClient`, `setClientCeilings`,
`listClients`, `deleteEmptyClient`), and nothing in this document is a route for them: the
operator API that calls them is a later item (G2-14) and will be mounted under `/api/site`,
behind `SITE_ADMIN` and `requireOperator`, like everything else in that namespace. Until it
lands the use cases are built and unreachable from the wire.

**No audit route exists yet either.** The append-only audit log (roadmap §10.8) is written by
`setClientCeilings` and pruned by the retention sweep, and nothing reads it over the wire: the
operator's view is G2-14 and the client-readable view is G2-16, both behind their own gates.

### CSRF

Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must echo the readable
`es_csrf` cookie in an `X-CSRF-Token` header. `SameSite=Lax` alone is insufficient: it
still permits a cross-site top-level POST, and the guest surface is reached by scanning
a QR code, so following a link from outside the app is the normal case here.

A missing cookie or header → `403 request.csrfMissing`; a value that does not match →
`403 request.csrfMismatch`. The two are separate codes because the remedies differ in
the client: the first usually means the page has been open long enough to lose the
cookie and needs a reload.

`GET`, `HEAD` and `OPTIONS` are exempt. So are `/api/health` and `/api/ready`, which are
mounted ahead of the whole cookie and session stack — a liveness probe is a machine with
no cookie jar. `GET /api/about` is mounted in the same position and answers with no cookie
at all (§2).

### Rate limits

Per minute, configurable, `429` with `Retry-After` when exceeded — **except event
creation**, which is per **hour** and per **account** (see the row below and the
paragraph beneath the table).

| Endpoint                                                           | Default       | Bucket                     | Code                               |
| ------------------------------------------------------------------ | ------------- | -------------------------- | ---------------------------------- |
| `POST /api/join`                                                   | 20            | client IP                  | `rate.limited`                     |
| `POST /api/auth/login` †                                           | 10            | client IP                  | `rate.limited`                     |
| `POST /api/auth/password-reset/request` †                          | 10            | client IP, own bucket      | `rate.limited`                     |
| `POST /api/auth/password-reset/confirm`                            | 10            | client IP, own bucket      | `rate.limited`                     |
| `POST /api/auth/login/2fa`, `step-up`, `2fa/enroll`, `2fa/confirm` | 10            | client IP, own bucket each | `rate.limited`                     |
| the same four                                                      | 10 / 15 min   | **account**, failures only | `auth.tooManySecondFactorAttempts` |
| `POST /api/events` (create)                                        | 20 / **hour** | account                    | `event.creationRateLimited`        |
| `POST /api/events/:slug/photos`                                    | 12            | client IP **and** event    | `rate.limited`                     |
| `POST /api/events/:slug/clips`                                     | 12            | client IP **and** event    | `rate.limited`                     |
| `POST /api/events/:slug/photos/:id/reactions`                      | 30            | client IP **and** event    | `reaction.rateLimited`             |
| `GET /api/gallery/:token`, `…/photos`, unlock                      | 120           | client IP                  | `rate.limited`                     |
| `GET /api/gallery-media/…`                                         | 3000          | client IP                  | `rate.limited`                     |
| `POST /api/gallery/:token/unlock`                                  | 10 / 50       | IP / link, per 15 min      | `gallery.tooManyAttempts`          |

† **Also throttled per account, with no lockout** (G3-04 / P4-07). The first five wrong
passwords for an address from one network are free; from the sixth the answer is
`429 rate.limited` with a `Retry-After` of 1 second, doubling with each further failure up
to 15 minutes. A `429` is not a failure, so asking again during the wait does not lengthen
it, and the right password signs in once the wait is over (it is refused while the wait runs).
Another network, and another address from the same network, have their own count; a
success, a malformed body and a server failure spend nothing. Beyond a hundred failures in an
hour on one address from everywhere together, an attempt is **held two seconds** and still
answered normally: it is never refused. The answer is the same for an address that is an
account, one that is not, a switched-off account and a malformed one, at every step.
`password-reset/request` counts every request the same way, in a bucket of its own, and is
answered `202` (or `429`, or `404` on a box with no relay) identically for every address; it sits ahead of the cap of three
mails an hour per address and does not replace it. See docs/SECURITY.md §5.

The gallery unlock is the one row counted per **quarter hour** and per **failure**: a
successful unlock spends none of that allowance, so a family opening one album on the
morning after is never locked out, and ten wrong passwords from one address — or fifty
against one link, from anywhere — are. Every unlock, right or wrong, also spends one
request of the page budget above, which is what bounds the hash verifications somebody who
knows the password can ask for; a request that budget refuses is not counted as a guess. The archive (`album.zip` under `gallery-media`) is bounded by
concurrency instead, two per client and four for the box, because one request is minutes
of disk reads.

The two guest write endpoints key on IP **and** event on purpose: a whole table of
guests shares one access point and therefore one public IP, so a per-IP-only limit would
throttle the venue rather than an abuser, and a burst on one event must not close
another event running on the same box. IPv6 addresses are collapsed to their /56 subnet,
because a per-address limit on a /64 residential allocation is no limit at all.

Event creation keys on **account**, the opposite choice, for the opposite reason: an
office or a venue's own guest Wi-Fi is one address shared by several hosts, and one
host's burst of event creation must not spend a colleague's allowance. The window is an
hour, not a minute — creating an event is rare by nature, one per occasion, so the
window matches the behaviour it bounds rather than every other endpoint's minute.

Photos and clips share **one** bucket, not two: a guest sending both is one guest, and
two independent allowances would be twice the limit. Clips are additionally bounded by
the depth of the transcode queue, which answers **429 `clip.queueFull` with a
`Retry-After`** and deliberately never the quota's `413` — the gallery is not full, the
machine is busy for a minute. See §3.

Uploads are additionally bounded per event by a byte quota, which closes uploads rather
than filling the disk.

The two SSE routes are bounded differently, by **how many connections are open at once**
rather than how many are made per minute, because a stream holds its socket for the whole
evening. The numbers and the codes are in §7.

**Uploads carry two more guards, neither a per-minute rate** (G3-06 / P4-10). A
process-wide semaphore, `MAX_CONCURRENT_UPLOAD_REQUESTS` (default 4), bounds how many
upload requests — photos and clips together, the same shared bucket as the rate limit
above — may be buffering at once: past it, **429** `upload.busy` with a short
`Retry-After`, because a slot frees the moment one of the requests ahead of it finishes,
seconds away rather than the clip queue's "about a minute". And below
`MIN_FREE_DISK_BYTES` free — `statfs` on the directory holding `DATABASE_PATH` and on
`MEDIA_ROOT` — a request answers **413** `storage.boxFull` instead, before a single byte
of it is read. Neither is a 503: an upload refused for either reason is a refusal of that
request, not a state of the service, so `GET /api/ready` reports the disk margin without
ever acting on it (§2).

---

## 2. Public

### `GET /api/health`

Liveness. No authentication, no body validation, and it must not touch the database —
a health check that fails when the database is busy causes the restart it was meant to
prevent.

```json
{ "status": "ok", "version": "2.1.0", "uptimeSeconds": 4821 }
```

### `GET /api/ready`

Readiness. Verifies the database answers (one `SELECT 1`) and that the media root is
writable — actually writing and removing a probe file, because `access(W_OK)` reports a
read-only bind mount and a full disk as writable and then fails on the first upload.

**200**

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "media": "ok",
    "video": "ok",
    "disk": { "sufficient": true, "freeBytes": 42949672960 }
  }
}
```

**503** `service.notReady` when the database or the media root fails, with `details`
naming which:

```json
{
  "error": {
    "code": "service.notReady",
    "message": "A dependency is unavailable",
    "details": {
      "database": "ok",
      "media": "unavailable",
      "video": "ok",
      "disk": { "sufficient": true, "freeBytes": 42949672960 }
    }
  }
}
```

503 rather than 500: this is a correct answer about an incorrect state, and an
orchestrator distinguishes the two.

`video` is `"ok"` or `"unavailable"` and is **reported, never acted on**: it appears in
both bodies and takes no part in the ready/not-ready decision. A box with no video
encoder still serves a photo wall, and taking a venue out of service over a missing codec
would be a far worse outage than the one it reports — clip uploads are refused by name
instead (§3). It is decided once at boot, so this route starts no subprocess of its own.

`disk` is the same (G3-06 / P4-10): **reported, never acted on**, for the matching
reason — the free-disk-space guard already refuses the one request that would have
minded (§1), so a tight margin here must never flip this route's own status and take a
whole venue's wall out of service over headroom no request currently needs. `freeBytes`
is the tighter of the two checked paths, or `null` when either could not be read, in
which case `sufficient` is `false`.

**Once a shutdown signal has been received, this always answers 503** —
`{ "database": "unavailable", "media": "unavailable", "video": <as above> }` — whatever
the database and the media root would otherwise say (docs/ARCHITECTURE.md "Graceful
shutdown"). An orchestrator stops sending new traffic the moment this is true, ahead of
the connections it is about to lose. `disk` is left out of that body: it takes an
asynchronous probe, and this answer is given without awaiting anything.

### `GET /api/about`

What this box is, which licence it is under, and **where its source is** — the
machine-readable half of the offer AGPL-3.0 section 13 requires of a network service. No
authentication, no parameters, and **no cookie**: it is mounted beside `/api/health`,
ahead of the body parser, the cookie parser, the session and the CSRF gate, so it is
answered with no cookie jar, sets neither `es_session` nor `es_csrf`, and is served even
when the session store is unusable.

**200**, `Cache-Control: public, max-age=300`

```json
{
  "name": "EventSlide",
  "version": "2.1.0",
  "license": "AGPL-3.0-only",
  "sourceUrl": "https://github.com/Irony42/EventSlide/tree/v2.1.0",
  "links": {},
  "features": { "siteAdmin": false, "forgotPassword": false }
}
```

An instance whose operator set `DONATION_URL` and `BUDGET_URL` answers, for example:

```json
{
  "links": {
    "donate": "https://opencollective.com/eventslide",
    "budget": "https://opencollective.com/eventslide/budget"
  }
}
```

An instance run for other people, whose operator named themselves and set their pages, answers
for example (the other fields are as above):

```json
{
  "operator": {
    "name": "Association Les Photographes",
    "contactEmail": "contact@example.org"
  },
  "links": {
    "terms": "https://example.org/legal/terms",
    "privacy": "https://example.org/legal/privacy",
    "legalNotice": "/legal/notice",
    "support": "/legal/help",
    "report": "/legal/report"
  }
}
```

| Field                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | The product, `EventSlide`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `version`            | The running build, from `package.json` — the same value `GET /api/health` reports and the backup manifest records.                                                                                                                                                                                                                                                                                                                                                                                             |
| `license`            | An SPDX identifier, `AGPL-3.0-only`, held to `package.json`'s `license`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sourceUrl`          | An **https** address of the complete source of this build. Resolved at boot, in order, from `SOURCE_CODE_URL`; from `SOURCE_REF`, as `https://github.com/Irony42/EventSlide/tree/<ref>`; else `…/tree/v<version>`.                                                                                                                                                                                                                                                                                             |
| `operator`           | Who runs the instance (roadmap G2-17 / P3-18): `name` (`OPERATOR_NAME`) and, when set, `contactEmail` (`OPERATOR_CONTACT_EMAIL`). **The key is absent** on a box that named nobody, which is every self-hosted box; the address never appears without a name. Plain text, never markup.                                                                                                                                                                                                                        |
| `links`              | Operator links, each **present only when the operator set it** — a box that set nothing answers `{}`, never a key with `null` or an empty string. `terms` (`LEGAL_TERMS_URL`), `privacy` (`LEGAL_PRIVACY_URL`), `legalNotice` (`LEGAL_NOTICE_URL`), `support` (`SUPPORT_URL`: help for a host) and `report` (`REPORT_URL`: where to report a content), each an **https** address or a **path on this site** (see below); and `donate` (`DONATION_URL`) and `budget` (`BUDGET_URL`), each an **https** address. |
| `features.siteAdmin` | `true` when `SITE_ADMIN=on`, that is, when the operator's namespace `/api/site` is mounted (see above). Derived from the same setting as the mount, so it cannot disagree with it.                                                                                                                                                                                                                                                                                                                             |

| `features.forgotPassword` | `true` when the box can mail (`SMTP_URL` is set), that is, when `POST /api/auth/password-reset/request` is not `404 feature.unavailable`. Derived from the mailer's own `canDeliver`, so it cannot disagree with the route. A client that cannot read it treats it as `false`. |

`features` is **additive**: a client ignores a flag it does not know, and later items add
one per capability a client would otherwise discover by trying.

**The source offer has no switch.** `SOURCE_CODE_URL` changes where the link points and
nothing hides it: every guest and host screen of the web app carries a "Code source
(AGPL-3.0)" link built from this response (the wall, which is projected for a room, does
not), and `/about` shows the version, the licence and the source. The default is the
upstream tag of the running version, which is the source of exactly that build **only when
the build is an unmodified copy of that tagged release.** A deployment of a modified build,
a fork, or a commit no tag names **must** set `SOURCE_CODE_URL` to where its source is
published. `SOURCE_REF` (the image's build argument, `docker build --build-arg
SOURCE_REF=<tag-or-commit>`) is only for an **unmodified upstream** tag or commit: it always
points into the upstream repository, so for anything modified it would offer code that lacks
the modification.

`SOURCE_CODE_URL` accepts an https URL and nothing else: `javascript:`, `data:` and `http:`
addresses, and addresses carrying credentials, stop the boot (exit 78) naming the variable.
It is read by the server at boot, not by the bundle, so a browser shows the upstream tag of
the build's version from its first paint and **replaces it with `sourceUrl` as soon as this
endpoint answers** — and keeps the upstream tag if it never does (an installed app opened
offline).

**The support links, and what they promise.** `DONATION_URL` and `BUDGET_URL` are optional and
**empty by default**, so a self-hosted box says nothing about money. They accept an https URL
and nothing else, exactly as `SOURCE_CODE_URL` does: `javascript:`, `data:` and `http:` addresses,
and addresses carrying credentials, stop the boot (exit 78) naming the variable. Where the web
app shows them, when set: a "Soutenir le projet" link in the footer of the **host** screens
(`/login`, `/admin/**`), a section on `/about`, and **one** card, which the host can close, on
the page of an event after it is closed — closing it is remembered by the browser (`localStorage`,
per event) and nowhere else. They are **never** shown on the projected wall, on the guest screens
(`/join`, `/e/:slug/upload`, `/g/:token`) or in e-mails; `/about`, which anyone may open, is the
one public page that carries them. There is no modal, countdown or repeated prompt. **A donation unlocks nothing:** no tier, badge, priority or other counterpart
exists, nothing in this API says who gave, and the screens that carry the link say it is the same
service for everyone.

**The operator's identity and pages (roadmap G2-17 / P3-18).** `OPERATOR_NAME`,
`OPERATOR_CONTACT_EMAIL`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`,
`SUPPORT_URL` and `REPORT_URL` are optional and **empty by default**: a self-hosted box that sets
none of them answers exactly what it answered before, and its screens and its guests' privacy
notice are unchanged. The name is at most 100 characters with no control character, line break
or bidirectional override; the address is one plain e-mail address and **needs a name beside it**
(the boot refuses an address on its own). Each of the five links accepts an **https URL with no
credentials, or a path on this site** that starts with one `/` (as in `/legal/report`), for pages
the instance's reverse proxy serves itself; `javascript:`, `data:` and `http:` addresses,
protocol-relative addresses (`//host`), backslashes and relative paths stop the boot (exit 78)
naming the variable, and the web app checks the same rule again where an address becomes an
`href`. A path is published as the path, never expanded to an origin. Where the web app shows
them, when set: the terms, the privacy policy and the legal notice in the footer of **every**
screen that has one and on `/about`; `support` in the footer of the host screens (`/login`,
`/admin/**`) and on `/about`; `report` as "Signaler un contenu" in the footer of the **guest**
screens (`/join`, `/e/:slug/upload`, `/g/:token`) — the DSA article 16 entry point. None is shown
on the projected wall or printed with the QR card. The name is also said in the guest's privacy
notice (§3), and `links.privacy` is linked from it.

### `POST /api/join`

The front door. Resolves a join code, creates a guest, and sets the `es_guest` cookie.

```json
{ "joinCode": "H7K2QM", "displayName": "Léa" }
```

`joinCode` is normalised server-side: case, separators, and the confusable characters
`I`/`L` → `1` and `O` → `0`, so a guest reading a printed card in a dark room still
gets in. `displayName` is optional — absent, `null` or blank means an anonymous guest,
which is allowed.

**200**

```json
{
  "guestId": "…",
  "displayName": "Léa",
  "event": {
    "slug": "camille-et-sacha",
    "name": "Camille & Sacha",
    "allowCaptions": true,
    "allowReactions": true,
    "maxUploadBytes": 25000000,
    "maxFilesPerUpload": 20,
    "allowClips": true,
    "maxClipBytes": 80000000,
    "maxClipSeconds": 15,
    "theme": {
      "accentHue": 345,
      "fonts": "serif",
      "frame": "round",
      "material": "glass"
    }
  },
  "privacyNotice": {
    "notice": {
      "revision": "publication=afterReview;audiences=wall+organisers+sharedGallery;retention=30;selfRemoval=900",
      "publication": "afterReview",
      "audiences": ["wall", "organisers", "sharedGallery"],
      "retentionDays": 30,
      "selfRemovalSeconds": 900
    },
    "acknowledgement": "none"
  }
}
```

Only what a guest may know before joining. The owner, the quota, the counts and the
settings that are none of their business are absent.

`theme` is not a permission like the two switches above it — it is what the host's event
_looks_ like (§7), and the guest's phone is one of the three screens it looks like it on.
It rides here because there is deliberately no readable "event by slug", so the upload
screen learns it from the session the join wrote: a `sessionStorage` read is synchronous,
which is what puts the right colour on the first frame instead of repainting one round
trip later under a guest's thumb. A client that has never heard of it renders the
product's own look.

`allowClips` here is **the host's switch and the box's capability together** — it answers
"may a guest send a video to this event, on this deployment", which is a different
question from `EventSettingsDto.allowClips` in §7, where the host sees their own setting
exactly as they left it. A box with no video encoder answers `false` however the host set
it, because `POST /clips` refuses with `500 clip.transcoderUnavailable` **after** multer
has written the upload to disk: without the conjunction every guest pays a full
eighty-megabyte upload, every time they try, until somebody redeploys.

`privacyNotice` is what the upload screen shows before a first photo (roadmap §5.1), and
where **this device** stands with it — the same body `GET /events/:slug/privacy-notice`
answers (§3), described there. It rides on the join so the upload screen knows before its
first frame whether to show the picker or the notice, with no second round trip. A new
device is `none`; a phone re-joining with a device token whose guest already read the
notice in force is `current` and is not shown it again.

`allowClips`, `maxClipBytes` and `maxClipSeconds` are here so that a refusal can happen
**before the bytes do**. A phone can read a recording's size and, usually, its duration
before sending it, and a guest told "cette vidéo est trop longue" at the picker has lost
nothing — where the same refusal after four minutes of venue Wi-Fi has cost them the
upload and, on a phone that slept halfway, the attempt. `maxClipBytes` is
`MAX_CLIP_BYTES` and deliberately not `maxUploadBytes`, which is the photo path's; both
are deployment configuration, which is why they travel rather than being compiled into
the client.

**Errors** — `404 event.notFound` for an unknown code, for an event that is `draft`,
`closed` or `archived`, **and** for a request whose `es_guest` cookie names a guest of
this event the host has revoked. All deliberately indistinguishable: a distinguishable
"not open yet" would let someone enumerate which codes exist, and a distinguishable
"you were removed" would make the front door the place that tells an ejected guest so.
The revoked case sets no cookie and creates no guest — that refusal is what keeps a
revocation from being undone by re-scanning the QR code on the table (`docs/SECURITY.md`
§11). `400 joinCode.wrongLength`, `400 joinCode.malformed`, `400 displayName.tooLong`,
`429 rate.limited`.

### `GET /api/events/:slug/wall`

The projected wall. Public read of **published** photos only — the read path is
structurally incapable of returning a pending photo.

**No query parameter this endpoint acts on.** In particular there is no `layout`: the
layout a room sees is a presentation choice belonging to the screen showing it, not a
property of the event, so it is chosen in the browser and this endpoint neither accepts
nor stores one. The `layout` in the response is the domain's default, which is what the
display starts on unless that browser says otherwise (see below).

The query schema is `.strict()` like every other, so **any parameter other than the two
e2e hooks below is a `400 request.invalid`**. That matters more here than anywhere else:
this is the URL a projector is left on for eight hours, and a tracking parameter appended
by whatever pasted the link turns the wall into an error page. The exceptions are
`e2e_interval` and `e2e_transition`, which the schema accepts and **nothing on this server
reads**: the handler passes `slideIntervalMs: null` whatever the `E2E_HOOKS` flag says,
and the overrides that make the Playwright suite fast are applied in the browser, off the
_display_ URL. They are accepted here and inert, which is a defect and not a feature —
§9.5.

**200**

```json
{
  "event": { "slug": "camille-et-sacha", "name": "Camille & Sacha" },
  "joinCode": "H7K2QM",
  "joinUrl": "https://photos.example.com/join/H7K2QM",
  "revision": "1f3k9a2",
  "items": [
    {
      "id": "…",
      "displayUrl": "/api/events/camille-et-sacha/photos/…/display",
      "thumbUrl": "/api/events/camille-et-sacha/photos/…/thumb",
      "width": 2560,
      "height": 1707,
      "caption": "Les confettis",
      "authorName": "Léa",
      "createdAt": "2026-06-20T21:04:11.031Z",
      "kind": "photo",
      "videoUrl": null,
      "durationMs": null
    }
  ],
  "slideIntervalMs": 8000,
  "kenBurnsDurationMs": 8800,
  "layout": "spotlight",
  "reactionsEnabled": true,
  "theme": {
    "accentHue": 345,
    "fonts": "serif",
    "frame": "round",
    "material": "glass"
  },
  "missions": [
    {
      "id": "…",
      "prompt": "un selfie avec les mariés",
      "scope": "guest",
      "achieved": true,
      "completedByGuests": 12
    }
  ],
  "wallLanguage": "fr"
}
```

`missions` is the host's prompt list (roadmap §2.1) and is **empty for most events**, which
is what stops the wall drawing a panel at all. It rides here rather than behind a second
request for the reason `theme` does: a projector runs unattended, and one fetch that either
arrives or does not beats two that can half-arrive.

Each row carries what the room draws and nothing else. `achieved` is true once **one
published photograph** names the mission — counted on every read, never stored, so a
photograph the host takes down stops counting on the next refresh. `scope` decides how a
row is drawn: `event` is a prompt answered once for the room and shows a tick, `guest` is
answered once per guest and shows `completedByGuests`. There is deliberately no "answered
at", so nothing here can drive a per-completion celebration — see §2.1's entry in the
roadmap for why that was declined.

`wallLanguage` is the language **this screen renders its own words in** (roadmap §1.5) —
one of `"fr" | "de" | "en" | "es" | "it"`. It is a setting on the event, and it is here
for the same reason `theme` is: the projector must not paint a frame in one language and
repaint in another.

It is the one surface that is **told** rather than asked. A guest's phone and a host's
browser each negotiate their own language; a projector has nobody in front of it, its
`navigator.languages` is the language of whichever machine the venue had in a cupboard,
and a stored preference there belongs to one phone out of two hundred. Unlike `layout`,
which genuinely belongs to the screen and is chosen with `?layout=`, this must not differ
between two projectors in one room — so there is deliberately **no `?lang=`**.

What it does **not** describe is the language of the event's _content_. The captions, the
display names and the mission prompts on this same response are what people wrote, and
nothing translates them: a wall set to `de` prints German labels around French prompts,
which is the right way round.

`theme` is here and not behind a second request for the reason the timings are: the wall
must not paint a frame in the product's colours and then repaint in the host's. A
projector that blinks on every reload is a defect two hundred people notice, and arriving
on this response the theme and the photos it themes are rendered together. Unlike
`layout` it is a property of the **event** rather than of the screen — two projectors in
one room must agree about the colour even when one is showing a mosaic and the other a
spotlight — so nothing in the browser may override it.

`revision` is an order-sensitive fingerprint of `items`. The client refetches when an
SSE signal arrives and compares revisions to decide whether the playlist actually
changed — which is what stops the wall jumping on every unrelated event.

`layout` is where a wall **starts**, not where it stays, and from there on it is a
client-side concern. The projector reads `?layout=` off its own _display_ URL —
`/e/:slug/display?layout=mosaic`, which is what a kiosk's autostart line can hold — and
the host's `L` key cycles the same thing at the screen; both live in the browser
(`web/src/features/wall/hooks/useLayoutParam.ts`) and neither is sent here. Names are
`spotlight | mosaic | polaroid | filmstrip | collage | split`, and an unknown or
malformed one is ignored in favour of this response's value rather than raising
anything: a projector rendering nothing for eight hours is the one failure this screen
may not have. All six render themselves; none falls back to a neighbour. `L` walks them
in the order above and wraps.

`joinCode` is present because the wall is also the invitation: it shows the code and a
QR while it is empty, and keeps a small corner reminder afterwards, so a guest arriving
late can join from the screen alone. It is the only host-side value the wall carries,
and it is exactly the value already printed on the tables.

`joinUrl` is the absolute link that QR encodes, built here from `PUBLIC_URL` — the same
builder behind `joinUrl` on `GET /api/events/:slug` (§4), so the two surfaces cannot
disagree about where a scan lands. **The projector must not rebuild it.** It did, from
`window.location.origin`, which is the address _that screen_ was opened on: a wall on a
venue mini-PC printed a QR for a hostname no guest's phone resolves, and a box behind a
TLS-terminating proxy printed plain `http`, on which the `Secure` guest cookie is never
sent. Both cases read correctly on screen — the six characters underneath were right the
whole time — which is §9 trap 1 of CLAUDE.md with a different mismatch. A client that
receives `joinCode` without `joinUrl` shows no QR rather than inventing one.

`authorName` is the name the guest typed at `POST /api/join` — the one thing they
supplied for exactly this purpose — and it is `null` whenever there is nobody to name: an
anonymous guest, or a photo the host uploaded from the venue's own camera. `null` means
**show no credit**, never a stand-in; "Invité" is French UI copy and belongs to the
client. Nothing else about the guest crosses: no guest id, no presence, no photo count.
The name is resolved event-scoped, like every other read here.

**Errors** — `404 event.notFound` when the event does not exist or is `draft` or
`archived`. A `closed` event still serves its wall: the projector is usually still on
while people say goodbye.

### The shared gallery (roadmap §4.1)

The link a host makes in §6 and sends after the event: `<PUBLIC_URL>/g/<token>`, where
the token is 43 base64url characters (256 random bits). The page at that address is the
SPA shell, served with the headers below; the five routes here are what it calls.

**One refusal for every dead link.** A malformed token, an unknown one, an expired or
revoked link, a link whose creator has been switched off or is no longer an owner of the
event, and a purged event all answer **`404 gallery.notAvailable`**, byte for byte, on
every route here. The host's console is where the reason is shown.

**Headers on every response, refusals included:** `Referrer-Policy: no-referrer`,
`X-Robots-Tag: noindex, nofollow`, and `Cache-Control: no-store` — relaxed only for an
inline rendition, to `private, max-age=<seconds until its URL expires>`. The SPA shell at
`/g/*` carries the same three.

**What is shown**: `published` photographs and clips of the link's event, never
`pending`, `rejected` or `hidden` — narrower than the host's own `album.zip` (§4),
which keeps hidden ones. Status is read on every request, so a photograph unpublished
after the page loaded is refused although its URL is correctly signed.

#### `GET /api/gallery/:token`

**200**

```json
{
  "eventName": "Camille & Sacha",
  "theme": { "accentHue": 305, "fonts": "…", "frame": "…", "material": "glass" },
  "photoCount": 124,
  "expiresAt": "2026-07-20T21:00:00.000Z",
  "archiveUrl": "/api/gallery-media/<linkId>/album.zip?e=<ms>&s=<signature>"
}
```

**401 `gallery.passwordRequired`** for a protected link this browser has not unlocked —
with no body but the error, so a forwarded link does not even say whose wedding it is.

#### `POST /api/gallery/:token/unlock`

`{ "password": "…" }`, **`.strict()`**. The password travels in a body and never in a
URL. **204**, setting `es_gallery`: `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS,
`Path=/api/gallery`, `Max-Age` two hours or the link's remaining life, whichever is
shorter. Its value is an expiry and a MAC over the link's id — not the password, and not
the token. A link with no password answers 204 too.

**Errors** — `401 gallery.wrongPassword`; `404 gallery.notAvailable` for a dead link,
decided **before** any hash is compared; `429 gallery.tooManyAttempts` (§1);
`400 request.invalid` for a body without a password; `403 request.csrfMissing` without
the CSRF pair.

#### `GET /api/gallery/:token/photos?cursor=…`

One page of sixty, newest first. `cursor` is the `nextCursor` of the previous page, sealed
by the server for this link; anything else is **`400 gallery.cursorInvalid`**.

```json
{
  "items": [
    {
      "id": "…",
      "kind": "photo",
      "width": 4032,
      "height": 3024,
      "caption": "Les confettis !",
      "previewUrl": "/api/gallery-media/<linkId>/<photoId>/thumb?e=<ms>&s=<signature>",
      "viewUrl": "/api/gallery-media/<linkId>/<photoId>/display?e=<ms>&s=<signature>",
      "downloadUrl": "/api/gallery-media/<linkId>/<photoId>/original?e=<ms>&s=<signature>"
    }
  ],
  "nextCursor": null
}
```

A clip's `previewUrl` and `viewUrl` are its `poster` and its `downloadUrl` its `video`.
No author name: a guest's first name was shown in the room, and a forwarded link is a
wider audience. Same `401` as above for a protected link.

#### `GET /api/gallery-media/:linkId/:photoId/:variant?e=…&s=…`

The bytes behind one signed URL. `e` is the expiry in epoch milliseconds and `s` an
HMAC-SHA256 over the link id, the photo id, the rendition and `e` — so a URL altered in
any of the four, or signed for another link, is refused. URLs live **one hour**, never
past the link's own expiry. They carry the link's **id**, never its token.

The signature is checked before anything is read; then the expiry; then **the link, on
this request** — so revoking a link kills every URL it ever issued at once rather than
when their hour is up; then the photograph, looked up in the link's own event.

The download rendition (`original` for a photograph — the ingest re-encode, EXIF and GPS
already stripped — and `video` for a clip) is `Content-Disposition: attachment;
filename="<slug>-<digest>.<jpg|mp4>"` with `Cache-Control: no-store`; the others are
`inline`. `X-Content-Type-Options: nosniff` on both.

**Errors** — `404 gallery.notAvailable` for every refusal; `404 photo.mediaMissing` for a
correctly signed URL whose bytes are gone.

#### `GET /api/gallery-media/:linkId/album.zip?e=…&s=…`

Every published photograph and clip, as their downloads, in one streamed ZIP:
`Content-Disposition: attachment; filename="<slug>-album.zip"`, `Cache-Control:
no-store`. The link is re-checked **before every entry**: revoked mid-download, the
response is aborted rather than ended cleanly, because a well-formed ZIP that stops early
looks exactly like a complete album. `404 gallery.notAvailable` otherwise.

---

## 3. Guest

All of these require the `es_guest` cookie, scoped to the event in the path.

### `POST /api/events/:slug/photos`

`multipart/form-data`:

| Field       |                                                            |
| ----------- | ---------------------------------------------------------- |
| `photos`    | 1..`maxFilesPerUpload` files                               |
| `caption`   | optional, applies to every file in the request             |
| `missionId` | optional uuid, applies to every file in the request (§2.1) |

**201** — a per-file outcome, so a guest whose third photo failed is told which one
rather than handed one opaque error for the batch:

```json
{
  "results": [
    { "index": 0, "status": "accepted", "photoId": "…" },
    { "index": 1, "status": "duplicate", "photoId": "…" },
    { "index": 2, "status": "rejected", "code": "image.tooManyPixels" }
  ]
}
```

`duplicate` is a **success**: the same bytes already exist in this event, so a
double-tapped submit or a retry after a dropped connection is a no-op rather than the
same photo twice on the wall.

The `code` on a `rejected` entry is **per file** and never becomes the response's own
status. These are the ones a guest can provoke:

| Per-file `code`             | Why                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `image.unsupportedFormat`   | The magic bytes are not JPEG, PNG, HEIC or WebP                                                    |
| `image.corrupt`             | The header will not decode                                                                         |
| `image.animated`            | An animated image; the wall is stills                                                              |
| `image.renderFailed`        | `sharp` could not re-encode it                                                                     |
| `image.tooManyPixels`       | Refused by the processor's own pixel ceiling                                                       |
| `photo.pixelBudgetExceeded` | Refused by the configured budget, from the header alone                                            |
| `event.quotaExceeded`       | This file would overrun the event's byte quota                                                     |
| `client.storageFull`        | This file would take the host's events past the account's total (`max_total_bytes`, roadmap §10.5) |

`event.quotaExceeded` is on that list and **not** in the whole-request list below: the
quota is charged file by file as the batch is written, so a guest sending five photos
into an almost-full event gets the first three accepted and the last two rejected,
rather than one 413 for the lot.

`client.storageFull` is the same refusal one level up, and it is judged in the **same
write transaction**. An event that belongs to a client (roadmap §10.2) is held to the
client's `max_total_bytes` across **all its events** — photographs of every status plus the
staged source of every clip still waiting — as well as to its own quota, and is refused by
whichever it reaches first, its own named first when both are reached. The event's own quota is
also lowered to the client's `max_event_quota_bytes` when that is smaller, for an event created
before an operator lowered it. The refusal carries **no `remaining`**: it is what the client's other events have left too, and a
guest of one event is not told how full its neighbours are. A photograph refused file by file is an
entry in `rejected` with the code alone; a clip, which is one file, answers a whole-request
`413 client.storageFull` whose `details` are `{ required }`. An event with no client is held to its own quota only, as it
always was.

**Whole-request errors** — `401 auth.required` / `401 guestToken.*` for a missing or
invalid token; `403 guest.wrongEvent` when the token names another event;
`403 guest.revoked`; `409 event.notAcceptingUploads`; `413 upload.tooLarge` (one file
over `maxUploadBytes`, refused by multer before any of our code runs);
`400 upload.tooManyFiles`; `400 caption.tooLong`; `403 event.captionsNotAllowed` when a
caption is sent to an event with captions off; `413 event.photoLimitReached` when the
batch would take the guest past the event's `maxPhotosPerGuest`; `429 rate.limited`;
**`429 upload.busy` with `Retry-After`** when the box's upload concurrency cap is
spent (shared with clips, §1); **`413 storage.boxFull`** when the box is nearly out of
disk space, decided before multer reads a byte (G3-06 / P4-10).
`400 upload.noFiles` when the request carries no `photos` part at all — a 201 with an
empty `results` array would tell a guest whose picker silently failed that their upload
worked. `400 upload.unexpectedField` when a file arrives under any other field name, and
`400 upload.rejected` for multer's remaining refusals (too many text fields, an
oversized field name or value).
`400 request.invalid` when `missionId` is not a uuid.

A well-formed `missionId` that names no prompt **of this event** is **not** an error: the
photographs are stored **untagged** and the tag is dropped, with a line in the server's
log. The bytes were never the problem — the identical request is accepted with the tag
left off — and a refusal does not stay in the guest's hands: an upload queued on venue
Wi-Fi replays through the outbox, where a refusal on its merits removes the entry from the
device. A host correcting a typo on the mission list would otherwise have deleted three
photographs off a phone whose owner had put it away. Nothing is silently lost either: the
guest's checklist is re-read after every settled batch, and the row the tag named is gone
from it.

> Until this audit the per-guest cap was documented here as `403 photo.tooManyForGuest`.
> The server has never sent that code: it sends `event.photoLimitReached`, and the
> `quotaExceeded` kind maps to **413**, not 403. The spelling above is the one on the
> wire. See §9.

### `GET /api/events/:slug/photos/mine`

The guest's own photos, **whatever the host decided** — being told a photo is awaiting
moderation beats wondering whether the upload worked.

```json
{
  "items": [
    {
      "id": "…",
      "status": "pending",
      "thumbUrl": "…",
      "caption": null,
      "createdAt": "…",
      "canDelete": true,
      "kind": "photo",
      "videoUrl": null,
      "durationMs": null
    }
  ]
}
```

`canDelete` is computed server-side from the grace window, the current status **and the
event's `allowGuestSelfDelete` switch**, so the client does not re-implement the rule and
then disagree with the server: it is exactly what `DELETE` below would allow.

`kind`, `videoUrl` and `durationMs` are the clip facet, present on every row of this
shape and `null`-valued on a photograph rather than absent — so no client tests for a
missing key. When `kind` is `"clip"`, **`thumbUrl` points at the poster frame**, which is
what lets a client that has never heard of video render a still rather than a broken
image; `videoUrl` is the mp4, and it is the URL that answers `Range` requests (§4).

### `GET /api/events/:slug/missions/mine`

The guest's checklist (roadmap §2.1): the host's prompts, and which of them **this guest**
has left to do. One read, because the screen that says there is something to do is fetched
on a saturated access point before the guest has taken a single photograph.

`Cache-Control: no-store`, for the reason `photos/mine` carries it: this is the view a
guest reloads to find out whether their photograph counted.

**200**

```json
{
  "items": [
    {
      "id": "…",
      "prompt": "un selfie avec les mariés",
      "scope": "guest",
      "done": false
    },
    { "id": "…", "prompt": "la première danse", "scope": "event", "done": true }
  ]
}
```

`done` is the only computed field and `scope` is what computes it. A `guest` prompt is done
once **this guest's own** published photograph names it — a checklist that ticked itself
because somebody across the room had already sent a selfie would remove the only thing this
feature adds. An `event` prompt is done for everybody once **anybody's** published
photograph names it, because "la première danse" happens once and leaving a hundred and
ninety-nine checklists open for it asks the room to photograph a moment that is over.

Only a **published** photograph counts, on both. A photograph a guest tagged and a
moderator then refused, hid or deleted was never counted and needs nothing to un-count it.

What is **not** here: any count of what other guests have done. A guest needs to know
whether there is something left for them; how many other people have done it is a
scoreboard, and §7 of the roadmap rules out social features between guests. The wall
carries `completedByGuests` because the room draws a number there; a phone does not.

Empty for the overwhelming majority of events, which set no prompts.

**Errors** — `401 auth.required` / `401 guestToken.*`; `403 guest.wrongEvent`;
`403 guest.revoked`; `404 event.notFound`.

### `GET /api/events/:slug/privacy-notice`

The privacy notice in force at this event, and whether **this device** has read it
(roadmap §5.1). The upload screen reads it when it opens and whenever it comes back into
view, because the copy the join left in the tab is a snapshot and the host may have changed
a setting since. `Cache-Control: no-store`.

**200**

```json
{
  "notice": {
    "revision": "publication=afterReview;audiences=wall+organisers+sharedGallery;retention=30;selfRemoval=900",
    "publication": "afterReview",
    "audiences": ["wall", "organisers", "sharedGallery"],
    "retentionDays": 30,
    "selfRemovalSeconds": 900
  },
  "acknowledgement": "none"
}
```

**Values, never sentences.** Every field but `operator` is derived from the event's settings (and,
for `retentionDays`, its client's ceiling) by `src/domain/privacy/privacyNotice.ts` on every read, and the client words them in the
guest's language, so the notice cannot promise something the configuration contradicts:

| Field                | Derived from                                                              | Meaning                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publication`        | `moderation`                                                              | `afterReview`: a person decides before the wall. `immediate`: published on arrival                                                                                                                                                                                                                                                               |
| `audiences`          | nothing: the same on every event                                          | `wall` (the projected wall, once published — the room, and anyone its public link reaches), `organisers` (host and moderators: everything, and the album) and `sharedGallery` (whoever the host may send the album's private link to, and whoever it is forwarded to: published only, in full resolution, until it expires or is withdrawn — §2) |
| `retentionDays`      | `retentionDays`, lowered to the client's `max_retention_days` — see below | days after the gallery **closes**; `null` — nothing deletes the album on its own                                                                                                                                                                                                                                                                 |
| `selfRemovalSeconds` | `allowGuestSelfDelete`, `guestSelfDeleteGraceSeconds`, `moderation`       | how long a guest may take a photo back; `null` when they cannot — including under `auto`, where nothing is ever off the wall to take back                                                                                                                                                                                                        |
| `operator`           | `OPERATOR_NAME` (not the event)                                           | who hosts the photograph, said as "Hébergé par <name>" (roadmap G2-17). **Absent** — the key is not there, and the revision is unchanged — on a box whose operator set none, which is every self-hosted box                                                                                                                                      |
| `revision`           | all of the above                                                          | opaque; two notices with the same revision say the same thing                                                                                                                                                                                                                                                                                    |

**The retention is the one the box applies.** For an event that belongs to a client, `retentionDays`
is the host's setting **clamped** by the client's `max_retention_days` (roadmap §10.5): an album
kept "for ever" under a thirty-day ceiling is told to the guest as thirty days, and so is one whose
host asked for ninety. The join, this read and the acknowledgement all use the same number, so the
revision a guest acknowledges is the one every read hands back. An event with no client is the notice
of its own settings, as before.

`audiences` is a list, and the shared gallery link of roadmap §4.1 was the first member
added to it. It is on every event rather than only on one with a live link: a notice is
read before an upload, a host makes the link after the event, and a guest is not asked
again once the event has closed — so the true statement at the moment of reading is that
the host _may_ share the album. A client must treat an audience it has no
sentence for as a notice it cannot show, not as a shorter one — this one shows no notice and
keeps the picker, as for a tab older than the feature, until a newer bundle loads.

**The operator is the last clause of `revision`, and only when there is one**
(`…;selfRemoval=900;operator=<name>`). A box that sets no `OPERATOR_NAME` produces the revision
it always produced, character for character, so installing a version with this field asks no
guest to read the notice again; a box that starts naming an operator, changes the name or stops
does ask them, once, because the notice then reads differently. The name is at most 100
characters, which keeps the longest revision well under the 512 the acknowledgement route
accepts.

`acknowledgement` is `none` (never read one here), `current` (read exactly this one) or
`outdated` (read one the host has since changed). **`outdated` is shown again before the
next upload**, whatever changed: retention, moderation or the self-delete window. Settings
the notice does not mention — captions, reactions, clips, the per-guest cap, the theme, the
wall language — leave every acknowledgement valid.

Nothing here gates the upload routes: the notice is shown by the upload screen, which does
not offer the picker until it is read. The reasons are on `privacyNoticeRoutes.ts`.

**Errors** — `401 auth.required` / `401 guestToken.*`; `403 guest.wrongEvent`;
`403 guest.revoked`; `404 event.notFound`.

### `POST /api/events/:slug/privacy-notice/acknowledgement`

"J'ai compris": records on the guest's own row that this device read the notice.

```json
{
  "revision": "publication=afterReview;audiences=wall+organisers+sharedGallery;retention=30;selfRemoval=900"
}
```

`revision` is the one the screen showed, echoed back as received. **200** with the same
body as the read above, now `current`. Idempotent: a second tap for the same revision keeps
the first instant.

**Errors** — `409 privacyNotice.outdated` when `revision` is no longer the notice in force
(the host changed a setting while the guest was reading): nothing is recorded, and the
client shows the new notice. `400 request.invalid` for a missing, empty or non-string
`revision`, or any other key. `401 auth.required` / `401 guestToken.*`;
`403 guest.wrongEvent`; `403 guest.revoked`; `404 event.notFound`.

### `POST /api/events/:slug/clips`

A short video clip. `multipart/form-data`, **exactly one** file under the field `clip`,
optional `caption`. Guest token required.

A separate route with its own `multer`, its own byte limit and its own storage, and none
of that is incidental: the photo path's `MAX_UPLOAD_BYTES` feeds a per-request heap
ceiling the deployment's memory limit was reasoned against, and a clip streams to **disk**
rather than to the heap because the request that carries it is slow by nature.

**202 Accepted** — and the status code is the contract. Nothing has been created that a
moderator can see: **a clip that is still transcoding has no `photos` row at all**, which
is what makes a half-encoded clip on the projector unrepresentable rather than filtered
out. What comes back is the job to watch and the id of the row it will become.

```json
{
  "clipJobId": "…",
  "status": "queued",
  "photoId": "…",
  "failureCode": null
}
```

`photoId` is fixed when the clip is staged, so a client can start watching for that row
immediately; it names an existing photo only once `status` is `"done"`. A retried upload
of the same bytes answers `202` with the **same** `clipJobId` rather than queueing a
second transcode — the digest of the source is the job's idempotency key, which is what
makes a dropped upload on venue Wi-Fi safe to repeat.

| `status`   | Meaning                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `reserved` | Admitted, and its bytes are still arriving. A window of milliseconds that only a second upload of the same file can observe |
| `queued`   | Waiting for the worker. This is what a fresh upload answers                                                                 |
| `running`  | Being transcoded now                                                                                                        |
| `done`     | `photoId` exists, `pending` like any other upload until a host decides                                                      |
| `failed`   | Given up on. `failureCode` says why, the client words it in French, **and sending the same file again starts a fresh job**  |

A `failed` job never blocks a re-upload. Its codes `event.quotaExceeded`, `event.photoLimitReached`
and `client.storageFull` are verdicts about the **album** rather than about the bytes,
and an album empties: the host deletes fifty photographs and the same clip now fits. The
old row stays, so the first `clipJobId` still resolves and still says why that attempt
ended; the new upload gets a new job. The same applies after a clip is deleted — the job
that produced it is retired with it.

**Errors** — `400 clip.unsupportedFormat` when the bytes are not a container this server
opens, decided from the **signature** before anything is written;
`400 clip.sourceByteSizeInvalid` for an empty file; `400 upload.noFiles` when the request
carries no `clip` part; `403 event.clipsNotAllowed` when the host turned video off for
this event **or** the event's client has no clips (`clips_allowed = 0`, roadmap §10.5) — checked
even when the event's own setting says yes, which is the case of a client moved to a plan without
video, and answered the same way so a guest is not told which of the two it was;
`403 event.captionsNotAllowed`; `409 event.notAcceptingUploads`;
`413 upload.tooLarge` past `MAX_CLIP_BYTES`; `413 event.quotaExceeded`;
`413 client.storageFull` when the client's events together have no room for the source
(`max_total_bytes`), decided in the same transaction as the event's own quota and before a byte
is written;
**`429 clip.queueFull` with `Retry-After`** when the box has more clips waiting than it
will accept — a condition that clears in about a minute, and deliberately not the
quota's `413`, which tells a guest the gallery is full and to go and find the organiser;
**`429 upload.busy` with `Retry-After`** when the box's upload concurrency cap is
spent (shared with photos, §1) — a different condition from the queue, and one that
clears in seconds rather than about a minute; **`413 storage.boxFull`** when the box is
nearly out of disk space, decided before anything is written to it (G3-06 / P4-10);
`500 clip.stageFailed`; and `500 clip.transcoderUnavailable` when this deployment has no
video encoder at all — decided on the request, so a box with no ffmpeg refuses here
rather than accepting the upload and failing the job minutes later.

The quota and the queue depth are decided **once**, inside the transaction that reserves
the queue row — before any byte of the upload is written. Two requests in flight cannot
both be admitted, and the loser has spent nothing.

A refused clip leaves **nothing** on the disk: the row is written first, so the refusal
happens before a byte is spent. That ordering is also what makes the quota mean what it
says — the quota is computed from rows, so an upload whose bytes landed before its row
was charged to nobody.

### `GET /api/events/:slug/clips/:clipJobId`

"Where is my clip?" — the one question a guest has during the window between the upload
and the transcode, when `GET /photos/mine` has nothing to show them. Guest token
required, and the token must be for **this event** — authorship is deliberately not the
check. The dedupe is event-scoped, so two guests sending the same video from the group
chat share one job and the second is handed the first's id in the `202`; an authorship
check answered their next poll with `404` about an upload just accepted. A clip job id
is an unguessable v4 uuid given only to the client that staged those bytes, and this view
carries no author, no caption and no bytes.

Answers the same body as the upload above. `Cache-Control: no-store`: this is the one
view whose purpose is to change.

**Errors** — `404 clipJob.notFound` for a job that does not exist and for one in another
event. Never `403`: a 403 would confirm that the id names a real clip, and these ids are
handed out to phones.

The `failureCode` on a `failed` job is one of `clip.unsupportedFormat`, `clip.corrupt`,
`clip.noVideoStream`, `clip.durationUnknown`, `clip.tooShort`, `clip.tooLong`,
`clip.pixelBudgetExceeded`, `clip.probeUnreadable`, `clip.transcodeFailed`,
`clip.transcodeTimedOut`, `clip.transcodeCancelled`, `clip.storageFailed`,
`clip.sourceMissing`, `clip.transcoderUnavailable`, `clip.abandoned`,
`event.quotaExceeded`, `event.photoLimitReached`, `client.storageFull` (the transcoded output no longer
fits the client's total) or `client.clipsNotAllowed` (the client's plan stopped including video while
the clip was queued; given up on without encoding it). Each has French copy, because a clip
that silently stays "en cours" for the rest of the evening is the failure this endpoint
exists to prevent.

### `DELETE /api/events/:slug/photos/:photoId`

A guest taking back a photo they regret. Permitted only for their own photo, only while
`pending` or `rejected`, only inside `guestSelfDeleteGraceSeconds`, and only when the
event allows self-deletion. Pulling a photo off the wall mid-slideshow is the host's
call.

**204**. **Errors** — `403 photo.deleteForbidden`,
`403 event.guestSelfDeleteDisabled`, `404 photo.notFound`.

This path is **shared with the moderator endpoint of the same name** in §6. The request
is dispatched on the credential presented: with an `es_guest` cookie the guest rules
above apply, and without one it is handled as the moderator endpoint — so a caller with
neither credential gets `401 auth.required` from the role check.

### `PATCH /api/events/:slug/photos/:photoId/caption`

```json
{ "caption": "Les confettis" }
```

`caption` is **required and nullable**, not optional: `null` clears the caption, and an
empty body `{}` is a `400 request.invalid`. "Leave it as it was" is not an intent this
endpoint has — a PATCH with nothing to apply is a client bug worth hearing about.

Author-only, while pending, inside the grace window. **204**.

**Errors** — `403 photo.captionEditForbidden`, `403 event.captionsNotAllowed`,
`404 photo.notFound`, `400 caption.tooLong` (the limit is 140 characters; `details.max`
carries it).

### `POST /api/events/:slug/photos/:photoId/reactions`

```json
{ "kind": "love" }
```

`kind` ∈ `love | laugh | wow | cheers | clap` — a closed set, because arbitrary emoji
projected in front of a family is not acceptable. One of each kind per guest per photo.
Only on a **published** photo: you react to what is on the wall.

**204**. **Errors** — `409 reaction.alreadyExists`, `409 reaction.notPublished`,
`403 event.reactionsDisabled`, `429 reaction.rateLimited`.

### `DELETE /api/events/:slug/photos/:photoId/reactions/:kind`

Withdraw one's own reaction. **204**. **Errors** — `404 reaction.notFound`, which is also
the answer for another guest's reaction: the row is addressed by
`(event, photo, guest, kind)`, so it is not forbidden, it is simply not there.

### `GET /api/events/:slug/photos/:photoId/reactions`

```json
{
  "counts": { "love": 12, "laugh": 3, "wow": 0, "cheers": 5, "clap": 1 },
  "mine": ["love"]
}
```

Every kind is always present and zeroed, so the client never handles a missing key.
`Cache-Control: no-store`: a count is stale the instant it is read, and both the phone
and the wall recount on the next SSE signal.

Note the consequence of this living in §3 rather than §2: it needs a guest token, so the
**projector cannot read reaction counts**. The wall response carries `reactionsEnabled`
and nothing else about reactions. `404 photo.notFound` for a photo outside this event.

---

## 4. Media

### `GET /api/events/:slug/photos/:photoId/:variant`

`variant` ∈ `thumb | display | original` for a photograph, `video | poster` for a clip.

Asking a row for a rendition its **kind** does not have is `404 photo.notFound` — the
miss is on the row, not on the disk, because `photo.mediaMissing` is the code that means
"a row points at bytes that are gone" and that is a corruption worth an operator's
attention.

There is deliberately no spelling that reaches a clip's **staged upload**. Those bytes
still carry whatever the phone wrote into the container, including location; they are
stored inside the media store so the event's purge reaches them, and they are outside the
set of servable renditions entirely — the media use case's own parameter type excludes
them, so no route can parse a value that would return one.

Served by a controller, never `express.static`, so authorization and event scoping
apply to every byte. 1.0 served media from a path built out of the session's `partyId`
and the client's filename.

| Caller           | May read                                                     |
| ---------------- | ------------------------------------------------------------ |
| Public           | `thumb`, `display`, `poster`, `video` of a **published** row |
| Guest            | the above, plus any rendition of **their own** row           |
| Moderator, owner | any rendition of any row in that event                       |

`original` is the one rendition a non-moderator never receives, whatever the status.

**The event must serve its wall, whoever is asking.** This route resolves the event
through the same public gate the wall uses, so a `draft` or `archived` event serves no
media **to anyone — a moderator and the owner included**, and answers
`404 event.notFound`. That is deliberate rather than an oversight of the role check: the
album export below is the archived event's read path, and it is the one a host is sent
to after the party. A moderator who cannot see thumbnails on a draft event is looking at
an event that has no photos yet.

Response headers: `Cache-Control: private, max-age=31536000, immutable`, a strong
`ETag` (the content hash **and** the variant, since `thumb` and `display` share a hash
while being different bytes), `X-Content-Type-Options: nosniff` and
`Content-Disposition: inline` — never `attachment`, because every surface renders these
in an `<img>`. Year-long caching is safe because the name is the content hash: different
bytes are a different URL. `If-None-Match` is honoured and answers **304** with the
validator still set, so a projector does not re-download a slide it showed an hour ago.

#### Range requests

`Accept-Ranges: bytes` is on **every** response from this route, and a `Range` header is
honoured with a **206** carrying `Content-Range` and the length of the part.

This is not an optimisation. A `<video>` element issues a range request before it will
let anyone scrub, and Safari will not begin playback **at all** against a handler that
answers `200` with the whole body — so a clip that is served without this simply does not
play. The failure is invisible to CSP and to every test that does not actually send the
header.

| Request                           | Answer                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| no `Range`                        | `200`, whole body, `Content-Length` of the object                     |
| `bytes=0-`, `bytes=200-499`, `-4` | `206`, `Content-Range: bytes <first>-<last>/<size>`                   |
| a last byte past the end          | `206`, clamped to the end of the object, as RFC 9110 requires         |
| a first byte past the end         | `416 photo.rangeNotSatisfiable` with `Content-Range: bytes */<size>`  |
| a multi-range request             | `200`, the whole object — permitted, and what every player copes with |

The `416` carries the real size, which is what lets a player correct itself instead of
retrying the same impossible range for the rest of the evening. It is written at the
route rather than through the error-kind table: `416` is a property of one representation
and of the header that asked for it, not a class of business failure, and the taxonomy in
§1 is worth keeping small enough to hold in your head.

**Errors** — `404 photo.notFound`, including for a photo in another event, for a
rendition the caller may not read, and for a rendition this row's kind does not have.
`404 photo.mediaMissing` when the row exists but its bytes do not — distinguishable in
the logs from a scoping miss, and identical on the wire.

### `GET /api/events/:slug/album.zip`

Streams the album. Moderator or above. Includes only statuses the domain's `isInAlbum`
accepts — `published` and `hidden`, **never** `rejected`. 1.0's ZIP shipped every row
regardless of status, so a host who carefully rejected a photo handed it out anyway.

`Content-Disposition: attachment; filename="<slug>-album.zip"`, from the resolved event's
canonical slug and never from the path, so the download cannot be called something the
wall and the printed card do not. `Cache-Control: no-store` and no `Content-Length`: the
size is unknown until the archive is written, and a four-thousand-photo wedding is
several gigabytes. Streamed, never buffered.

Unlike the media route above, this one is behind `requireRole('moderator')` and so
**does** serve an archived event: `401 auth.required` with no session,
`404 event.notFound` for a caller with no membership, `403 auth.forbidden` never
(both roles may export). A failure part-way through the stream destroys the socket
rather than appending JSON — a truncated ZIP that looked complete is how a host deletes
an album they do not actually hold.

---

## 5. Authentication

Six of these thirteen take no principal, and each for its own reason: a login is where a
principal comes from, a logout can only ever destroy the one it was handed — answering
401 to a client whose session has just expired would leave the stale cookie in the
browser — and `/auth/me` exists to answer whether there is a principal at all. Stated
here so that an absent authorization middleware in `routes/authRoutes.ts` is a
documented decision rather than an omission a reader has to judge. The two password-reset
routes take none for the reason a login does: the person asking has lost the credential.

| Method | Path                               | Principal                                                               |
| ------ | ---------------------------------- | ----------------------------------------------------------------------- |
| `POST` | `/api/auth/login`                  | none                                                                    |
| `POST` | `/api/auth/logout`                 | none                                                                    |
| `GET`  | `/api/auth/me`                     | none                                                                    |
| `POST` | `/api/auth/password`               | any signed-in user whose account is still enabled; no event, so no role |
| `POST` | `/api/auth/sessions/revoke-others` | same: any signed-in user whose account is still enabled, for itself     |
| `POST` | `/api/auth/password-reset/request` | none: the person asking has no credential                               |
| `POST` | `/api/auth/password-reset/confirm` | none: the mailed link is the credential                                 |
| `POST` | `/api/auth/login/2fa`              | none: the half-finished sign-in the password bought is the credential   |
| `POST` | `/api/auth/2fa/enroll`             | any signed-in operator, and the password again                          |
| `POST` | `/api/auth/2fa/confirm`            | the same operator, with the code the app shows                          |
| `POST` | `/api/auth/step-up`                | any signed-in user whose account is still enabled; password, and code   |
| `POST` | `/api/auth/2fa/recovery-codes`     | any signed-in user, behind a fresh step-up                              |
| `POST` | `/api/auth/2fa/disable`            | any signed-in user, behind a fresh step-up                              |

### `POST /api/auth/login`

```json
{ "email": "host@example.com", "password": "…" }
```

Regenerates the session id on success, to defeat fixation. Every failure returns the
same `401 auth.invalidCredentials` — unknown email, wrong password and disabled account
are indistinguishable, and an unknown email costs the same time as a known one. Beyond the
per-client limit, a network that has failed five times for one address is answered
`429 rate.limited` with a `Retry-After` for a growing wait of at most 15 minutes, the same
for every address, real or not (§1, "Rate limits"). A `401` is the only answer that counts as a
failure.

**200**

```json
{
  "userId": "…",
  "email": "host@example.com",
  "displayName": "Camille",
  "mustChangePassword": false
}
```

**200, when the account has an authenticator** — the password was right and **no session was
started**:

```json
{ "secondFactorRequired": true }
```

The response names no one. The caller asks for a code and sends it to
[`POST /api/auth/login/2fa`](#post-apiauthlogin2fa). Everything above about failure still
holds: an unknown address, a wrong password and a disabled account are one `401`, and a wrong
password costs an enrolled account exactly what it costs any other — the second factor is asked
for only after the password is proven.

### `POST /api/auth/logout`

Destroys the session and clears the cookie. **204**. Idempotent.

### `GET /api/auth/me`

```json
{
  "authenticated": true,
  "user": {
    "userId": "…",
    "email": "…",
    "displayName": null,
    "mustChangePassword": false,
    "canOperateSite": false,
    "secondFactor": {
      "available": true,
      "enrolled": false,
      "verified": false,
      "required": false
    }
  }
}
```

`{ "authenticated": false }` with **200** when there is no session — the client asks
this on every page load, and a 401 in the console on first visit is noise.

**`displayName` is always `null` here**, and that is the contract rather than a gap. The
response is built from the session principal, which holds only a user id and an address: a
name in the session would be a copy that goes stale the moment the account is renamed, and
reading the row would make a controller touch a repository. The fresh name comes from the
login response; this endpoint answers the question it is actually asked, which is whether
the caller is signed in. A client that needs a name on a page load has to keep the one
`POST /api/auth/login` returned.

**`mustChangePassword` is not from the session either.** It is read from storage on this
request (`UserRepository.authStateFor`, P3-03) — the same single read
`requirePasswordCurrent` already made before this handler ran, reused rather than asked
twice. A value copied into the cookie at login would still say `false` for an account
flagged afterwards, and would still say `true` for one that cleared the flag from a
different tab.

**`canOperateSite` is the account's authority over the box**: `true` when its site role is
`operator` (docs/ROADMAP.md §10.1), `false` for everyone else, read from storage on this
request like the two fields above — an account demoted after it signed in stops saying
`true` on its next call. It is the same question `requireOperator` asks of `/api/site/*`
(one predicate, `canOperateSite` in `domain/users/siteRole.ts`), and it grants nothing
by itself: a request to `/api/site/*` is judged by the gate, not by what this reported.

It is **not** whether the operator's console exists on this instance. That is
`features.siteAdmin` on [`GET /api/about`](#get-apiabout) (`SITE_ADMIN`), and this field does
not change with it: an operator on a box with `SITE_ADMIN=off` still reads `true`, and a
client that offers the console must require both. A disabled account is told
`{ "authenticated": false }` and nothing else, so this is never reported for one. The login
response (`POST /api/auth/login`) does not carry it.

**`secondFactor`** is where this account stands with the second factor (G2-13), and nothing a
caller could use against it: `available` — this box has a `MFA_ENCRYPTION_KEY`, so an operator can
enrol; `enrolled` — the account has a confirmed authenticator (storage, this request); `verified`
— **this session** has passed the second factor (the session's own stamp); `required` — the box
sets `REQUIRE_OPERATOR_2FA` and the account operates it. A console that reads
`required && !verified` sends the account to enrol when `!enrolled` and to the code prompt
otherwise. It grants nothing: `/api/site/*` is judged by its gate.

`Cache-Control: no-store`, always. The body is an identity and a rolling session
re-sends its cookie alongside it, so a shared cache holding this response would hand
one host's session to whoever asks next.

### `POST /api/auth/password`

```json
{ "currentPassword": "…", "newPassword": "…" }
```

**204**, and **every other session of the account is signed out** (the credentials epoch, SECURITY.md
§2): a cookie that was stolen before the change stops working on its next request. The
response replaces the caller's own session — a new `es_session` and a new `es_csrf`, so the
client must read the CSRF cookie again — and the caller stays signed in. **Errors** — `401 auth.invalidCredentials`, `400 password.*`,
`400 password.unchanged`, and `401 auth.required` when the session outlived the account it
names or that account has been disabled. Both are refused by `requireUser` before the
handler runs, and they are one answer on purpose: the id comes from the session, so either
case means the session no longer names anybody, and a browser holding a dead session should
be sent back to the login form rather than told the route is missing. (It used to answer
`404 user.notFound` here; the use case still returns that code, and nothing routes to it.)

### `POST /api/auth/sessions/revoke-others`

No body. **204**, and every session of this account issued before now is refused from its next
request on — the lost laptop, the shared office machine, the cookie someone else may hold.
The caller's own session is replaced (a new `es_session`, a new `es_csrf`) and stays signed
in. It changes nothing else: not the password, not the flags. **Errors** — `401 auth.required`
(no session, or the account is switched off), `403 auth.passwordChangeRequired` while the
account must still choose a password.

### `POST /api/auth/password-reset/request`

```json
{ "email": "camille@example.org", "locale": "fr" }
```

`locale` is optional (`fr`, `en`, `de`, `es`, `it`; default `fr`): the language of the page the
person asked from, and the language the mail is written in. Unknown keys are refused.

**202** with the body `{}`, **for every address**: an account, an address nobody uses, a
malformed one, a switched-off account, one that has already been mailed three times this hour.
The status, the body and the headers are the same, and the answer does not wait for the mail
to be sent, so the time is the same too. If an enabled account uses the address it is mailed a
plain-text message with a link to `/password/reset/<token>` on `PUBLIC_URL`, good for **an
hour** and **once**; asking again revokes the earlier link.

**`404 feature.unavailable`** when the box can send no mail (`SMTP_URL` unset), whatever the
address. There is no self-service reset on such a box and `features.forgotPassword` on
`GET /api/about` is `false`. The link is never returned in a response. **Errors** — `400
request.invalid`, `429 rate.limited` (the sign-in budget, its own bucket, and the per-address
throttle of §1 "Rate limits", whose `Retry-After` is the wait; both answer every address alike),
and the CSRF codes like every write. Responses are `Cache-Control: no-store`, the rate-limit refusals aside.

### `POST /api/auth/password-reset/confirm`

```json
{ "token": "…", "password": "…" }
```

`token` is the last segment of the mailed link. **204**: the password is set, a forced change
is cleared, **every session the account had is signed out**, and no session is started — the
person signs in with the password they chose. The link works once.

**Errors** — `400 auth.invalidToken` for every way a link can be dead (never issued, expired,
already used, replaced by a newer one, issued for another purpose, for an account that is now
switched off or uses another address), always the same answer. `400 password.*` for a password
the policy refuses — and **the link is not spent by it**, so the form can be corrected and
resubmitted. `400 request.invalid`, `429 rate.limited` and the CSRF codes. Responses are
`Cache-Control: no-store`.
---

### The second factor (roadmap §10.1, G2-13 / P3-15)

An operator account may enrol a TOTP authenticator (RFC 6238: HMAC-SHA1, six digits, thirty seconds,
one step of drift either way) and ten recovery codes. It exists only on a box with an
`MFA_ENCRYPTION_KEY`: with none, `enroll` and `confirm` answer `404 feature.unavailable`, and
nothing about signing in changes. Enrolment is the operator's alone (`403 auth.forbidden` for any
other account).

**The secret is stored encrypted** (AES-256-GCM under the key, a fresh IV per row), the recovery
codes as SHA-256 digests. Both are shown **once**, in a response that is `Cache-Control: no-store`.

### `POST /api/auth/2fa/enroll`

```json
{ "password": "…" }
```

The password again — a session cookie alone must not be enough to attach a stranger's phone to an
account. Mints a secret and stores it **unconfirmed**: nothing about signing in changes until the
next call proves the app produces the right code. Calling it again replaces an unconfirmed secret.

**200**

```json
{
  "otpauthUri": "otpauth://totp/EventSlide:host%40example.com?secret=…&issuer=EventSlide&algorithm=SHA1&digits=6&period=30",
  "secret": "JBSWY3DPEHPK3PXP…"
}
```

The URI is what the QR code carries and `secret` is the same secret for an app that cannot scan.
**401** `auth.invalidCredentials` for a wrong password; **403** `auth.forbidden` for an account that
is not the operator; **409** `auth.secondFactorAlreadyEnrolled` while a confirmed authenticator
stands (remove it first, behind a step-up); **404** `feature.unavailable` with no key.

### `POST /api/auth/2fa/confirm`

```json
{ "code": "123456" }
```

Proves the app shows the right code (the steps either side of now are accepted). In one gesture the
authenticator is confirmed, **the step that proved it is spent**, ten recovery codes are minted,
**every session of the account issued before now is ended** (a thief who held the password is signed
out; the caller's own session is renewed and stamped as having passed the second factor), and the
enrolment is audited (`account.secondFactorEnrolled`).

**200** `{ "recoveryCodes": ["K7QM-2XTR-9PHD-4VNB", …] }` — ten, shown once, 80 random bits each.
**401** `auth.invalidSecondFactor` (wrong code, or a step already spent); **400**
`auth.totpCodeInvalid` for text that is not six digits (the sign-in answers the neutral
`auth.invalidSecondFactor` for the same text, so the shape of a code is not something it tells a
caller); **409** `auth.noEnrolmentInProgress` when nothing was begun.

### `POST /api/auth/login/2fa`

```json
{ "code": "123456" }
```

or `{ "recoveryCode": "K7QM-2XTR-9PHD-4VNB" }` — **exactly one** of the two (a body naming both, or
neither, is `400 request.invalid`). Finishes the sign-in that `POST /api/auth/login` began. Until it
does, the caller holds a half-finished sign-in in the session, **with no `userId`**: every gate keys
on that, so the session is anonymous to `requireUser`, `requireRole` and `requireOperator` alike and
reaches nothing else. It lives **five minutes**, allows **five wrong codes**, and is void if the
account's credentials changed (a reset, a password change, a switch-off) after the password was typed.

On success the session is regenerated (new id, new CSRF token) and stamped as having passed the
second factor. **200** is the same body as the login's.

- **401** `auth.invalidSecondFactor` — a code that matches no step, one for a step **already spent**
  (the replay refusal), a recovery code never issued or already used, and text that is neither: one
  answer, so what separates them stays the owner's to know.
- **401** `auth.secondFactorExpired` — no half-finished sign-in, one past its five minutes, one that
  used its five wrong codes, or one the account's credentials outlived. Start again with the password.
- **429** `auth.tooManySecondFactorAttempts` — the account's budget of wrong attempts is spent
  (below).
- **500** `auth.secondFactorUnavailable` — the stored secret will not open under the
  configured key. A recovery code still works, because it never needed the key.

A recovery code is **single use**, decided by one conditional statement, and spending one is audited
(`account.recoveryCodeUsed`, with the number left and never a code).

### `POST /api/auth/step-up`

```json
{ "password": "…", "code": "123456" }
```

`code` may be `recoveryCode` instead; **at most one**, and neither for an account with no
authenticator, which proves itself with the password alone. Stamps the session, for **five minutes**,
as having confirmed the person at the keyboard. Two routes ask for it today — `2fa/recovery-codes` and
`2fa/disable`, below — and answer **403 `auth.stepUpRequired`** without a fresh stamp; the operator
routes that cannot be taken back (offboarding a client, suspending or resuming one, changing a
ceiling, G2-14) will carry the same gate, `requireStepUp`, when they are mounted. **204**. The code must be of a step **later than
the last one spent**, so the code that signed in cannot be reused here: the person waits for the
app's next one. The stamp is not carried across a renewal of the session id (a password change).

**401** `auth.invalidCredentials` / `auth.invalidSecondFactor`; **429** as above.

### `POST /api/auth/2fa/recovery-codes` and `POST /api/auth/2fa/disable`

Both need a fresh step-up (**403** `auth.stepUpRequired`). The first replaces **every** recovery code,
spent or not, and answers **200** `{ "recoveryCodes": [...] }` (**409** `auth.secondFactorNotEnrolled`
for an account with nothing to recover; audited as `account.recoveryCodesRegenerated`). The second
removes the authenticator and its codes (**204**, idempotent, audited as
`account.secondFactorDisabled`), ends every session of the account, and renews the caller's **without**
the second-factor stamp: on a box that requires one, removing a factor never opens `/api/site`, it
closes it.

### The gate on `/api/site`, and what a session carries

With `REQUIRE_OPERATOR_2FA=true`, `siteRoutes` applies `requireSecondFactor` **after**
`requireOperator`: an account that does not operate the box is told `403 auth.forbidden` and nothing
about second factors; an operator whose session has no `secondFactorAt` is told `403
auth.secondFactorRequired`. The stamp is written into the server-side session by a passed second
step or a confirmed enrolment and nowhere else, kept across a renewal, and dropped when the factor
is removed. Off — the default — the gate does nothing at all.

**Rate limits.** The four doors that take a secret — `login/2fa`, `step-up`, `2fa/enroll` and `2fa/confirm` — have
the sign-in budget per client address (own bucket each, `rate.limited`), **and** one budget per
**account** of 10 wrong attempts per quarter of an hour from every address together
(`auth.tooManySecondFactorAttempts`, failures only: the owner who types it right spends nothing).
The account budget is what bounds a distributed guesser against six digits.

## 6. Host and moderator

`:slug` scopes the role check: `requireRole('moderator')` means _moderator of this
event_, never "is logged in".

| Method   | Path                                       | Role      | OK  |                                                |
| -------- | ------------------------------------------ | --------- | --- | ---------------------------------------------- |
| `GET`    | `/api/events`                              | any       | 200 | Dashboard summaries                            |
| `POST`   | `/api/events`                              | any       | 201 | Create; the creator becomes owner              |
| `GET`    | `/api/events/:slug`                        | moderator | 200 | Full event including settings                  |
| `PATCH`  | `/api/events/:slug`                        | owner     | 200 | Rename; answers the full event                 |
| `PATCH`  | `/api/events/:slug/settings`               | owner     | 200 | Settings; answers the full event               |
| `POST`   | `/api/events/:slug/status`                 | owner     | 200 | `{ "status": "live" }`; answers the full event |
| `PATCH`  | `/api/events/:slug/schedule`               | owner     | 200 | Scheduled open/close; answers the full event   |
| `POST`   | `/api/events/:slug/join-code`              | owner     | 200 | Rotate; answers the full event, new code       |
| `DELETE` | `/api/events/:slug`                        | owner     | 204 | Purge: media first, then rows                  |
| `GET`    | `/api/events/:slug/photos`                 | moderator | 200 | Paginated, filterable                          |
| `GET`    | `/api/events/:slug/moderation`             | moderator | 200 | Queue + `pendingCount`                         |
| `PATCH`  | `/api/events/:slug/photos/:photoId/status` | moderator | 204 | `{ "decision": "publish" }`                    |
| `POST`   | `/api/events/:slug/moderation/bulk`        | moderator | 200 | `{ "photoIds": [...], "decision": "reject" }`  |
| `DELETE` | `/api/events/:slug/photos/:photoId`        | moderator | 204 | Delete any photo                               |
| `GET`    | `/api/events/:slug/guests`                 | moderator | 200 | Guest list + active count                      |
| `POST`   | `/api/events/:slug/guests/:guestId/revoke` | moderator | 204 | Remove a disruptive guest; idempotent          |
| `GET`    | `/api/events/:slug/moderators`             | owner     | 200 | Memberships                                    |
| `POST`   | `/api/events/:slug/moderators`             | owner     | 201 | Invite; **address _and_ temporary password**   |
| `DELETE` | `/api/events/:slug/moderators/:userId`     | owner     | 204 | Revoke; never the last owner                   |
| `GET`    | `/api/events/:slug/top-photos`             | moderator | 200 | Photo of the night                             |

Five routes answer the **whole event** rather than `204`, and that is worth stating
because it is not obvious from the verb: rename, settings, status, schedule and
join-code rotation all end in the same `EventDto` that `GET /api/events/:slug` returns,
so a console never has to refetch to redraw a header, a QR code or a settings form after
saving it.

### Errors across this section

`401 auth.required` with no session; `404 event.notFound` for an unknown slug **and** for
a caller with no membership of it; `403 auth.forbidden` — `details.required` naming
`owner` or `moderator` — for a moderator on an owner-only route. Beyond the
cross-cutting codes in §1:

| Code                           | Status | Where                                                                                                                               |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `event.slugUnavailable`        | 409    | Create, when the slug is in use — custom or derived, never echoed                                                                   |
| `event.customSlugNotAllowed`   | 400    | Create, with a `slug` when `ALLOW_CUSTOM_SLUGS=false`                                                                               |
| `event.creationRateLimited`    | 429    | Create, beyond the account's hourly allowance                                                                                       |
| `event.quotaAboveCeiling`      | 400    | Create, when `quotaBytes` exceeds `MAX_EVENT_QUOTA_BYTES` or the client's `max_event_quota_bytes` (`details.maxBytes`: the smaller) |
| `client.retentionAboveCeiling` | 400    | Settings, when `retentionDays` is above the client's `max_retention_days`, or `null` while one exists (`details.maxDays`)           |
| `client.clipsNotAllowed`       | 400    | Settings, switching `allowClips` on for a client with `clips_allowed = 0`                                                           |
| `client.liveNotAllowed`        | 403    | Status, going live for a client with `live_allowed = 0`                                                                             |
| `client.liveWindowOver`        | 403    | Status, reopening an event once `opened_at + max_live_days` has passed                                                              |
| `event.creationNotAllowed`     | 403    | Create, under `EVENT_CREATION=clientMembers`, by an account with no client                                                          |
| `client.notFound`              | 404    | Create, naming a client that is not the caller's, or not saying which of several                                                    |
| `client.ceilingReached`        | 409    | Create, when the client has used its events (`details.ceiling`: `events` or `eventsPerPeriod`)                                      |
| `event.immutable`              | 409    | Rename, settings or schedule on an `archived` event                                                                                 |
| `event.illegalTransition`      | 409    | A status change the lifecycle does not allow                                                                                        |
| `event.scheduleInPast`         | 400    | A scheduled instant whose minute has already gone by                                                                                |
| `event.scheduleOutOfOrder`     | 400    | A scheduled closing at or before the scheduled opening                                                                              |
| `event.notModeratable`         | 409    | A single or bulk decision on an `archived` event                                                                                    |
| `photo.illegalTransition`      | 409    | A decision the photo's status machine does not allow                                                                                |
| `guest.notFound`               | 404    | Revoking a guest id that is not in this event                                                                                       |
| `membership.alreadyExists`     | 409    | Inviting someone who already moderates this event                                                                                   |
| `membership.notFound`          | 404    | Revoking a membership that is not there                                                                                             |
| `membership.lastOwner`         | 409    | Revoking the only remaining owner                                                                                                   |
| `event.joinCodeExhausted`      | 500    | Rotation could not find a free code — a bug, not a client error                                                                     |
| `event.slugExhausted`          | 500    | `EVENT_SLUG_SUFFIX=random` could not find a free suffix — likewise                                                                  |
| `event.mediaPurgeFailed`       | 500    | A purge that could not remove the bytes; rows are left alone                                                                        |

### `GET /api/events`

**200** `{ "items": [ EventSummaryDto, … ] }`, every event the caller owns or moderates.
An empty dashboard is a 200 with an empty list — a 404 would make "no events yet" look
like a broken page on a host's first login.

```json
{
  "items": [
    {
      "id": "…",
      "slug": "camille-et-sacha",
      "name": "Camille & Sacha",
      "status": "live",
      "photoCount": 312,
      "pendingCount": 12,
      "guestCount": 74,
      "usedBytes": 1840293012,
      "createdAt": "2026-06-20T17:00:00.000Z"
    }
  ]
}
```

A summary carries no join code and no settings. `GET /api/events/:slug` is where those
live, and it needs a role in the event to answer.

`usedBytes` is **the same sum the upload paths enforce the event's quota against**:
photographs of every status **plus** the staged sources of clips still waiting to be
transcoded (`reserved`, `queued`, `running`; a `done` or `failed` clip holds no bytes). It
used to count photographs alone, so a host could be shown room that an upload then
refused as full. The same number appears in every `EventDto`.

### `POST /api/events`

The request body — and `template` is the one field here that is **not** echoed back, for
the reason below:

```json
{
  "name": "Camille & Sacha",
  "slug": "camille-et-sacha",
  "startsAt": null,
  "quotaBytes": null,
  "template": "wedding",
  "wallLanguage": "fr"
}
```

`slug` is optional and derived from `name` when absent, by the same function the UI
previews with — a second implementation in the client is how "the slug I saw is not the
slug I got" happens. `startsAt` is an ISO-8601 string or `null`; `quotaBytes` is a
positive integer or `null`, and `null` or absent takes the configured default. **201**
with the full event including its join code.

An explicit `quotaBytes` is bounded by `MAX_EVENT_QUOTA_BYTES` (roadmap §10.5 / G3-02),
the box-wide ceiling nobody's request may cross: above it, refused with
**400 `event.quotaAboveCeiling {maxBytes}`**, never silently reduced to the ceiling. A
box that never set `MAX_EVENT_QUOTA_BYTES` has none, which is every self-hosted
install's behaviour before this existed. For an event that belongs to a client the bound is the
**smaller** of that and the client's `max_event_quota_bytes`, and `maxBytes` names the one that applied;
a request that names **no** quota is given the client's ceiling when that is below the box default,
rather than refused — an event created with no opinion has nothing for a refusal to correct.

`wallLanguage` is optional, one of `"fr" | "de" | "en" | "es" | "it"`, and absent means
French. The host console sends the language its operator is reading at that moment, which
is the only signal anybody has about a screen nobody will be holding — and it is a
**snapshot**: nothing re-reads that preference afterwards, so a host who later switches
their own browser has not moved a projector in a room. `PATCH /settings` is where it
changes deliberately.

**Who may create, and the client an event belongs to (roadmap §10.2, P3-05 / G2-04).**
`EVENT_CREATION` is `anyAccount` (the default, and every box's behaviour before it existed:
any signed-in account, an invited moderator included) or `clientMembers`, which a box run
for other people sets and which **boot refuses unless `SITE_ADMIN=on`** (exit 78, roadmap
§10.9). Under `clientMembers` an account that belongs to no client is refused
**403 `event.creationNotAllowed`**, before the name or the slug is looked at, so a refused
account learns nothing about other tenants from a validation error or a slug collision. The
box's operator is allowed, and so is a member of a client.

The new event is attached to a client, fixed at creation:

- a member of **one** client: that client, with nothing to send;
- a member of **several**: the body must carry `"clientId"` (a uuid) naming one of theirs;
  without it, **404 `client.notFound`**;
- the operator: no client, unless they name one of their own (`clientId`) — their events are
  never counted against anybody's ceilings by default; an account with no client under
  `anyAccount`: no client either (`client_id` is null in storage, which is what every event
  on a box that never had clients has).

`clientId` is optional, and naming a client that is not the caller's — whether it exists or
not — is the same **404 `client.notFound`**, so the field is not a way to enumerate clients.
A value that is not a uuid is `400 request.invalid`. The id is **never echoed**: nothing in
the `EventDto` carries it.

The event, its owner's membership and — for a client's event — the client's creation counter
are written **in one transaction**. Two ceilings of the client are checked in that same
transaction: its events now, of every status (`max_events`), and the events it has created
this period (`max_events_per_period`). A creation they refuse is
**409 `client.ceilingReached`** with `details: { ceiling, used, max }`, and nothing is
written. The per-period counter **never decreases**: deleting an event
(`DELETE /api/events/:slug`) frees a slot of the first ceiling and none of the second, so
create, delete, recreate cannot walk around it. The other
§10.5 ceilings are enforced on every write path:

- **What the event is made with** (roadmap §10.5 / G2-05). Reductions, never refusals, because an
  event being created has no value the host chose to override: `settings.retentionDays` is
  **clamped** to the client's `max_retention_days` — and "keep for ever" (`null`, the default,
  which no template turns off) **becomes the ceiling itself** — and `settings.allowClips` is
  switched **off** when the client has `clips_allowed = 0`. The host reads both back in the
  event's settings. An event with no client is made exactly as before: the template's retention,
  clips as the template says.
- **What it may become** — `PATCH /settings` and `POST /status`, below; **what it may hold** —
  uploads, §3; **what it keeps** — the retention purge, below.

Until the operator API exists (roadmap §10.2, G2-14), nothing over HTTP creates a client or
adds a member, so on a box that sets `clientMembers` today the operator is the only account
that can create an event; leave the policy at `anyAccount` until clients can be enrolled.

**The slug (roadmap G3-05 / P4-09, decision D-14).** Three environment variables govern
it, all backward-compatible by default:

- `EVENT_SLUG_SUFFIX` (`none` default, `random` on the hosted instance): when `random`, a
  derived slug (`slug` absent from the body) **always** carries a random six-character
  suffix, `camille-sacha-h7k2qm` — never only on a collision, which would prove the bare
  slug exists.
- `ALLOW_CUSTOM_SLUGS` (`true` default, `false` on the hosted instance): when `false`, a
  body that sends a well-formed `slug` is refused with `400 event.customSlugNotAllowed`,
  rather than the field being silently dropped. A malformed `slug` — wrong shape or
  length — never reaches that check: the shared `slug` schema in
  `requestSchemas.ts` validates it first, regardless of this flag, and answers
  `400 request.invalid` instead.
- A slug collision — custom or derived — is always `409 event.slugUnavailable`, with
  **no slug in the response**. This replaces `event.slugTaken`, which echoed the
  computed slug back and so let a caller who only ever sent a free-text `name` learn
  another tenant's literal, already-normalised address.

**The join code.** `JOIN_CODE_LENGTH` (6 to 10, default 6) sets how many characters a
newly minted code has; an existing event's code keeps whatever length it was minted
with.

**The creation limit.** Beyond `EVENT_CREATION_RATE_LIMIT_PER_HOUR` (default 20)
creations from one **account** in an hour, `429 event.creationRateLimited`. See §1's
rate limit table.

**Errors** — `409 event.slugUnavailable`, `400 event.customSlugNotAllowed`,
`429 event.creationRateLimited`, `400 eventName.*`, `400 slug.*`,
`400 event.quotaAboveCeiling {maxBytes}` for a `quotaBytes` above `MAX_EVENT_QUOTA_BYTES`,
`403 event.creationNotAllowed` under `EVENT_CREATION=clientMembers`,
`404 client.notFound`, `409 client.ceilingReached {ceiling, used, max}`,
`400 request.invalid` for a language outside the five or a `clientId` that is not a uuid.
A quota above a **client's** `max_event_quota_bytes` is the same `400 event.quotaAboveCeiling`, with
`maxBytes` naming the smaller bound.

#### `template` — what the settings start from

`"wedding" | "birthday" | "conference" | "party"`, optional. Absent means the product
defaults, which is what every event created before this field existed has. Unlike
`startsAt` and `quotaBytes` it is **not nullable**: there is no "no template" value to
send, only the absence of one, and `"template": null` is `400 request.invalid` like any
other unexpected shape. A name outside the four is the same refusal — no error code of its
own, because an unknown enum value already has one.

**The template is applied once and then does not exist.** The response carries the
settings it produced and no `template` key, nothing stores which template an event came
from, and no later request re-applies one. That is the design rather than an omission: a
host who picks `wedding` and then changes `moderation` on the settings page has changed
their event, not departed from something that will argue back. `src/domain/events/eventTemplate.ts`
holds the reasoning and the alternative it rejects.

What each one sets — and it sets **only** these, leaving every other setting at its
default:

| Template     | Changes                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `wedding`    | `guestSelfDeleteGraceSeconds: 3600`, `retentionDays: 365`, theme rose / serif / round          |
| `birthday`   | `moderation: "auto"`, `retentionDays: 90`, theme violet / sans / round                         |
| `conference` | `allowClips: false`, `retentionDays: 30`, `maxPhotosPerGuest: 25`, theme azure / sans / square |
| `party`      | `moderation: "auto"`, `retentionDays: 30`, theme teal / sans / soft                            |

Nothing here restates a default, which is why `wedding` and `conference` say nothing about
`moderation`: `manual` is already the default and both want it. Every accent is one of the
four hues the console's picker names, so the settings page can show a host what their own
event is set to — and every one passes the legibility rule in §8, asserted rather than
assumed.

Two of these values are worth reading twice before copying them into a client.

`retentionDays` is a **deletion**, and its clock starts at `closedAt` rather than at
creation: `Event.expiresAt` answers `null` until the event is closed, so a template's
retention is inert on an event the host never closes and a real countdown on one they
close that night. When it passes, `purgeExpiredEvents` removes the media tree and the
event row. Nothing in the product notifies anybody beforehand, so a client that surfaces
these templates must say what the number does rather than printing the duration alone.

`moderation: "auto"` publishes without review, and that covers **clips as well as
photographs** — `transcodeNextClip` stamps a finished clip with an `automatic` reviewer
under `auto` exactly as photo ingest does, and neither template touches `allowClips`. The
console discloses this on the two cards that set it, in the same words the settings page
uses when a host selects `auto` there.

There is no `layout` in this table although the roadmap entry names one: no event stores a
wall layout at all, here or anywhere (§8).

### `GET /api/events/:slug` — the event

The shape every route in the table that answers `200` returns.

```json
{
  "id": "…",
  "slug": "camille-et-sacha",
  "name": "Camille & Sacha",
  "status": "live",
  "photoCount": 312,
  "pendingCount": 12,
  "guestCount": 74,
  "usedBytes": 1840293012,
  "createdAt": "2026-06-20T17:00:00.000Z",
  "joinCode": "H7K2QM",
  "joinUrl": "https://photos.example/join/H7K2QM",
  "quotaBytes": 21474836480,
  "settings": {
    "moderation": "manual",
    "allowCaptions": true,
    "allowReactions": true,
    "allowClips": true,
    "allowGuestSelfDelete": true,
    "guestSelfDeleteGraceSeconds": 900,
    "retentionDays": 30,
    "maxPhotosPerGuest": null,
    "theme": {
      "accentHue": 305,
      "fonts": "sans",
      "frame": "soft",
      "material": "glass"
    },
    "wallLanguage": "fr"
  },
  "startsAt": null,
  "closedAt": null,
  "scheduledOpenAt": null,
  "scheduledCloseAt": null,
  "scheduleDiscardedAt": null,
  "role": "owner"
}
```

`startsAt` and `scheduledOpenAt` are **not** the same field and neither is derived from
the other. `startsAt` is the printed start of the party, set when the event is created,
shown on the dashboard, and read by no rule. `scheduledOpenAt` and `scheduledCloseAt`
are the automatic lifecycle: the server opens and closes the event when they pass. An
event with a `startsAt` and no `scheduledOpenAt` opens when the host presses the button,
which is what every event created before this field existed still does.

`joinUrl` is built server-side from `PUBLIC_URL` so the QR code and the printed card
cannot disagree — 1.0's central defect was exactly two client-side spellings of one link.
`role` is the **caller's** role in this event, not a property of the event. The four
counts come from the caller's own dashboard listing rather than a second repository read
in the handler.

### `PATCH /api/events/:slug`

```json
{ "name": "Camille & Sacha" }
```

Rename. **200** with the event. **Errors** — `409 event.immutable` on an archived event,
`400 eventName.empty`, `400 eventName.tooShort`, `400 eventName.tooLong`,
`400 eventName.malformed` (a name with no letter or digit in it at all).

### `PATCH /api/events/:slug/settings`

A **partial** update. Every field is optional, and an absent key means "leave it alone" —
which is a different intent from `null`, and the two are kept apart all the way to the
domain. `retentionDays: null` clears retention; `retentionDays` absent does not touch it.

```json
{
  "moderation": "manual",
  "allowCaptions": true,
  "allowReactions": true,
  "allowClips": true,
  "allowGuestSelfDelete": true,
  "guestSelfDeleteGraceSeconds": 900,
  "retentionDays": 30,
  "maxPhotosPerGuest": 20,
  "theme": {
    "accentHue": 345,
    "fonts": "serif",
    "frame": "round",
    "material": "glass"
  },
  "wallLanguage": "de"
}
```

| Field                         | Accepted                                         |
| ----------------------------- | ------------------------------------------------ |
| `moderation`                  | `manual` \| `auto`                               |
| `allowCaptions`               | boolean                                          |
| `allowReactions`              | boolean                                          |
| `allowClips`                  | boolean — see below                              |
| `allowGuestSelfDelete`        | boolean                                          |
| `guestSelfDeleteGraceSeconds` | integer 0..86400                                 |
| `retentionDays`               | integer 1..3650, or `null` for "keep"            |
| `maxPhotosPerGuest`           | integer 1..10000, or `null` for "no cap"         |
| `theme`                       | object — all four keys required, see below       |
| `wallLanguage`                | `fr` \| `de` \| `en` \| `es` \| `it` — see below |

**A client's ceilings (roadmap §10.5 / G2-05).** For an event that belongs to a client, an edit is
**refused** where creation reduces — shortening what a host just typed would tell them they got
what they asked for:

- `retentionDays` above the client's `max_retention_days`, or `null` ("keep for ever") while one
  exists: **400 `client.retentionAboveCeiling {maxDays}`**;
- `allowClips: true` while the client has `clips_allowed = 0`: **400 `client.clipsNotAllowed`**.

Only what a save **changes** is asked. The settings form sends every field on every save, so a field
re-sent with the value the event already has is not a request: a host is not locked out of switching
moderation at the party because the operator lowered a ceiling since they chose their retention (the
purge already honours the lower number, and a clip is refused at upload). Going **to** a value the
ceiling does not allow is refused. An archived event still answers `409 event.immutable` first. Nothing is stored or announced for
a refused patch. An event with no client is not asked anything.

`allowClips` is `true` for an event **created** after video shipped and `false` for one
that existed before it. The two are deliberately different: an event created today is
written with the field, while one whose settings predate it belongs to a host who was
never asked — and a deploy must not start accepting 80 MB uploads on a wedding that is
live at that moment.

The host-facing switch is the "Autoriser les vidéos" checkbox on the event settings page.
It matters more than it looks: the persistence fallback reads `false` for every event
stored before the deploy, so without it video would be unreachable on exactly the events
the feature exists for. Note also that the first save of **any** setting on such an event
writes `allowClips: false` into its blob, after which it is indistinguishable from a host
who chose no — which is why the checkbox ships in the same form as every other setting
rather than behind one of its own.

#### `wallLanguage` — what language the room's screen speaks

One of `"fr" | "de" | "en" | "es" | "it"`, a partial update like every field above it
except `theme`: absent leaves it alone. Defaulted at creation to the language the host
was reading (`POST /api/events`), and never re-read from anybody's preference afterwards.

It reaches **one surface**. The guest's phone and the host's own console each negotiate
their own language from the browser and ignore this entirely, which is what makes a French
host running an English-speaking conference representable: they set the wall to English,
write their prompts in English, and go on reading their console in French.

It is deliberately **not** a statement about what language the event's _content_ is in. A
caption is written by whichever guest wrote it, and two hundred guests do not share a
language even when the host does, so no single field could be true about them — and a
field that claimed to would be the thing a later change built a translation of a guest's
caption on. Event names, captions, display names and mission prompts are shown exactly as
typed, on every surface, in every language.

A value outside the five is `400 request.invalid`, and that refusal is load-bearing rather
than tidy: the client resolves this tag against its own copy table, so a tag it has no
words for would put a projector on the fallback language for eight hours while the settings
page showed the host the tag they chose.

#### `theme` — how the event looks

```
{ "accentHue": 0..359, "fonts": "sans" | "serif",
  "frame": "soft" | "square" | "round", "material": "glass" | "plain" }
```

The one field here that is **not** a partial update: absent leaves the theme alone, but a
`theme` that is present must carry all four keys, and anything else is
`400 request.invalid`. They are one decision made on one form — the same argument
`PATCH /schedule` makes about its two instants — and the legibility rule below judges them
together, so merging half a theme into a stored one would produce a palette nobody chose.

`material` arrived after the other three, so a client written against the older shape sends
three keys and is refused until it is reloaded. That is the intended trade: the alternative
is for an absent `material` to mean something, the only sane meaning is `glass`, and a host
who chose `plain` would then have it silently undone by a stale tab saving an unrelated
checkbox. A refusal a reload fixes beats a choice quietly reverted.

`accentHue` is a **hue angle**, not a colour: the lightness and chroma are the design
system's and cannot be moved, which is the whole reason a host cannot make the wall
unreadable. No colour is ever sent or received by this API.

**Contrast is validated server-side against the token contract.** A hue is refused when
its ink fails 7:1 on the accent, when it fails 4.5:1 on the pressed state, or when it sits
within 30° of `--success`, `--danger` or `--warning` — at which point "press this" and
"that went wrong" read as one signal from the back of a room. The refusal names what was
broken; the host is told rather than silently moved to a colour they did not pick.

The console offers four named hues (violet 305, rose 345, azure 250, teal 195) and this
endpoint accepts any angle it can prove legible. The list is an affordance; the rule is
the guard.

`material` is whether the event's panes wear the liquid-glass material or the opaque
surface the product already ships everywhere else. It is the host's decision about their
evening, not the viewer's about their phone: a device's own answers — a missing
`backdrop-filter`, `prefers-reduced-transparency`, a frame rate that stopped holding — are
decided in the browser and **outrank** it, so `plain` means "never the material" while
`glass` means "the material, where this machine can hold it". It never reaches the wall's
rendering, which gave the material up on every machine before this field existed.

An event whose stored settings predate this field reads the product's own look —
`{ "accentHue": 305, "fonts": "sans", "frame": "soft", "material": "glass" }` — which is
exactly what it has been rendering, so nothing changes on any screen at the deploy. The
same holds one level down for an event themed before `material` existed: the key is filled
in as `glass`, which is what that blob was already rendering. That is deliberately _not_
the shape of the `allowClips` fallback above: these consent to nothing and cost nothing, so
the absent-key answer and the default answer coincide — which is also why neither of them
needed a migration.

**A downgrade past this field discards it, and that is worth knowing before an event rather
than after one.** An older build hydrates a `"material": "plain"` event happily, because it
ignores the key — but the first save of any setting on that build re-serialises the whole
blob without it, so rolling forward again reads the host's choice as `glass`. Self-hosted
operators do roll back on the day; if one does, the host's surface finish is the thing to
re-pick afterwards.

The theme also rides on `POST /api/join` (§3) and `GET /api/events/:slug/wall` (§4), so
the guest's phone and the projector paint the right colour on their first frame instead of
repainting one round trip later.

**200** with the event. **Errors** — `409 event.immutable`,
`400 eventSettings.graceSecondsInvalid`, `400 eventSettings.retentionDaysInvalid`,
`400 eventSettings.maxPhotosPerGuestInvalid`, `400 eventTheme.accentHueInvalid`,
`400 eventTheme.accentUnreadable`, `400 eventTheme.accentTooCloseToStatus`.

There is no per-event wall `layout` here, and no API accepts one anywhere: the layout is
chosen at the screen — `?layout=` on the display URL, or the host's `L` key — and
nothing persists it (§2).

### `POST /api/events/:slug/status`

```json
{ "status": "live" }
```

`status` ∈ `draft | live | closed | archived`. Which transitions are legal is the
aggregate's table, not a check in the handler, so the console and the projector cannot
hold two ideas of what `archived` means. **200** with the event.
**Errors** — `409 event.illegalTransition`; and, for an event that belongs to a client:
**403 `client.liveNotAllowed`** going live while the client has `live_allowed = 0` (quarantine, an
expired Pass), and **403 `client.liveWindowOver`** reopening a closed event once
`opened_at + max_live_days <= now`.

**The live window (roadmap §10.5 / G2-05).** `closed → live` is a legal transition and reopening clears
the closing instant, so without a bound a host pressing one button a month would keep a public wall and
its photographs for ever. The event records `opened_at` the **first** time it goes live — for every event,
with a client or without — and nothing moves it afterwards: a reopening inside the window does not
restart it. For a client's event, once `opened_at + max_live_days` has passed, going live is refused as
above, from this route **and** from a scheduled opening (reported `refused`; the schedule is discarded
and `scheduleDiscardedAt` says so). Closing and archiving are never refused. The schedule sweep also
**closes** a client's live event whose window has run out — closed, not archived: the album stays
readable and the host keeps the export — and the retention clock starts at that moment. The purge happens
at the latest at `opened_at + max_live_days + max_retention_days`, however many times the event was
reopened. A client's live event with no recorded opening (made live before `opened_at` existed) is given one
by the first sweep, counted from that pass. An event with no client has no window: it reopens whenever,
exactly as before.

**Retention under a ceiling.** For an event of a client with `max_retention_days`, the album is purged at
the earliest of the host's own retention and `max(closed_at + max_retention_days, retention_cap_since +
RETENTION_CAP_NOTICE_DAYS)` — so an event kept "for ever" is not kept for ever, and lowering a ceiling
never purges an album closed long ago the same night: an album **already closed when the ceiling was
lowered** is owed `RETENTION_CAP_NOTICE_DAYS` (30 by default) from that day, and one closed afterwards is
not — it was under the lower ceiling from its first day and is purged at `closed_at + max_retention_days`,
the number its guests were told. A `NULL` anywhere (no host retention, no ceiling, an event that
never opened) removes one candidate and never switches the others off.

### `PATCH /api/events/:slug/schedule`

```json
{
  "scheduledOpenAt": "2026-06-20T16:00:00.000Z",
  "scheduledCloseAt": "2026-06-21T00:00:00.000Z"
}
```

When the event opens and closes by itself. **Both keys are required**, and either may be
`null` — which is the one shape in this section that is not a partial update, and it is
deliberate: these two fields are read together on one form, and "open at 18:00" with
`scheduledCloseAt` absent could mean either "leave the closing alone" or "there is no
closing". `null` says "the host does this one by hand" with no second spelling.

**200** with the event. **Errors** — `409 event.immutable` on an archived event,
`400 event.scheduleInPast` for an instant that has already gone by,
`400 event.scheduleOutOfOrder` when the closing is at or before the opening,
`400 request.invalid` for a timestamp that is not ISO-8601 **with an offset**.

`event.scheduleInvalid` also exists in the domain, for an instant that is not a readable
date at all. **No request can produce it**: this route parses with zod first, so a
malformed timestamp is `400 request.invalid` before the aggregate sees it. It is a
defensive guard on the entity, kept because a domain factory does not trust its caller,
and it is listed here so its absence from a client's error handling is a decision rather
than an oversight.

**An instant that has already gone by is refused when it is set.** This is the most
likely mistake with this endpoint, not a corner case: it is 21:30, the party is running,
the host arms the closing, picks `02:00` and leaves the date on today. Accepting it would
end the evening within one sweep. The comparison is made **to the minute** — the minute
in progress is accepted, the one before it is not — so a client that sends the current
minute a few seconds after it began is not refused for being correct.

This does not contradict the missed-window behaviour below. That rule is about an instant
that _aged_ past while nothing was running; a stored instant is never re-validated. The
guard runs once, against the clock at the moment of the request.

**Timezone.** What is stored and what is sent are **instants**, in ISO-8601 with an
offset — `Z` or any other, so `2026-06-20T18:00:00+02:00` is accepted and normalised to
UTC on the way out. There is no per-event timezone and no wall-clock string on the wire: a
value such as `2026-06-20T18:00:00` with no offset is a `400`, because the server does not
know what time it is at the venue and must not guess. The admin console resolves the
host's local 18:00 against the **browser's** timezone before sending, and renders it back
the same way — the host's laptop is at the party, so 18:00 means 18:00 where the party is.
A host configuring an event from another timezone is setting their own local time, and
does the arithmetic themselves.

Two consequences of having no per-event timezone, stated so a client author is not
surprised by them. On the night the clocks go forward, a local time that does not exist
(02:30, where 02:00 becomes 03:00) resolves an hour later than it reads; on the night they
go back, a local time that happens twice resolves to the **first** occurrence. The console
does no special-casing, and an API client resolving its own wall-clock times will meet the
same two cases. The console's field also offers minutes only, so an instant set through
this endpoint with seconds on it reads back into that form truncated, and re-saving from
the form sends the truncated value.

**What the sweep does with them.** A background job (`SCHEDULE_SWEEP_INTERVAL_MINUTES`,
five minutes by default, `off` to disable) opens the events whose `scheduledOpenAt` has
passed and closes the ones whose `scheduledCloseAt` has passed. Three properties are part
of the contract:

- **The instants are deadlines, not appointments.** If the server was down at 18:00 the
  event opens at the next sweep, not never. The comparison is `now >= instant`.
- **The transitions are the ordinary ones.** A scheduled open is refused for exactly the
  reasons a manual one is — an `archived` event does not reopen because a timestamp
  passed — and the refused instant is then discarded rather than retried forever.
- **It is idempotent, and it consumes what it acts on.** An instant that has been acted
  on is cleared, so both fields read back as `null` afterwards and a second sweep changes
  nothing. A closing starts the retention clock exactly as a manual one does; it deletes
  no photos.

A refused instant is cleared like an applied one — retrying an impossible transition
every few minutes forever is worse — and `scheduleDiscardedAt` on the event records when
that happened. It is the only trace that the host's schedule ever existed, since the two
fields read back empty; the console renders it as a notice, and saving any schedule, the
empty one included, clears it.

**Turning the sweep off does not pause the schedule, it stops applying it.** While
`SCHEDULE_SWEEP_INTERVAL_MINUTES=off`, instants keep being accepted and stored and nothing
acts on them, so they accumulate in the past. The first sweep after it is turned back on
applies the whole backlog in one pass, by the rules above — which includes reopening a
`closed` event that is still carrying a stale opening, and clearing its `closedAt` with
it. Clear the schedules of any affected event before re-enabling it.

**It also stops the live window from closing anything.** The sweep is what closes a client's live
event once `opened_at + max_live_days` has passed, and what stamps the opening of one that has none
recorded. With it `off`, such an event stays live until a host closes it by hand — the refusal of a
`closed → live` after the window still holds, because that is decided on the request, but nothing
ends the window for a room that never closes it. A box that serves clients with a `max_live_days`
leaves the sweep on.

### `POST /api/events/:slug/join-code`

No body. The emergency lever: a join link is circulating outside the venue, so the old
code stops working immediately. **200** with the event, carrying the new code and the
new `joinUrl`, so the console reprints the QR without a second request.

The new code is minted at the box's **current** `JOIN_CODE_LENGTH` (6 to 10, default 6),
which may differ from the length the old code had — nothing requires every code on a box
to be the same length.

### `DELETE /api/events/:slug`

No body. **204**, empty, no `Content-Type`. This is the only irreversible endpoint in
the product, and there is no confirmation step in the protocol — the confirmation
belongs to the console, because a second HTTP round trip would not make the first one
any harder to send by accident.

**Owner only.** `canDeleteEvent` is `owner`, so a moderator _of this event_ gets
`403 auth.forbidden` with `details.required: "owner"`. Lending out the moderation screen
for an evening must not be able to lose the album.

**What is destroyed**, in this order — and the order is part of the contract:

1. Every byte under the event's media directory: the original, display and thumb
   variants of every photo, published, pending, hidden and rejected alike.
2. The `events` row, and with it everything `ON DELETE CASCADE` hangs off it — `photos`,
   `guests`, `reactions` and `event_memberships`.

Media first, row second, because the row is the only record that the bytes exist: delete
it first and a failure halfway through leaves gigabytes on disk with nothing left to find
them by. The other order leaves a purge that can simply be run again.

**What survives.** User accounts: an owner or moderator keeps their login and every
other event they are a member of, and only their membership of _this_ event is removed.
Sessions: nobody is signed out, here or elsewhere. Other events on the same instance,
media directories included. The slug itself, which becomes free — a new event may take
it.

**On an event already purged** the slug no longer resolves, so a second call answers
`404 event.notFound` — the same answer a caller with no membership gets, for the same
reason (§6, _Errors across this section_). The status code is therefore not idempotent,
and a client that reads 404 here as "already gone" is reading it correctly.

**No lifecycle guard.** Rename and settings answer `409 event.immutable` on an archived
event; a purge does not. It is legal from `draft`, `live`, `closed` and `archived`
alike, because archiving is what a host does _instead_ of deleting, not a step on the
way to it. **No `409` is reachable on this route.**

**No realtime frame.** The handler publishes nothing on the event bus, so a wall or a
console still holding an SSE connection is not told. Its next request against the event
answers `404 event.notFound`. A guest whose device token names the purged event gets
`404 event.notFound` too; if the host later creates a new event on the same slug, that
old token names a different event id and gets `403 guest.wrongEvent`.

**Errors** — `401 auth.required` with no session, answered before the slug is looked up
so the route cannot be used to discover which events exist; `404 event.notFound` for an
unknown slug, a malformed one, and for a caller with a session but no membership;
`403 auth.forbidden` for a moderator of the event; `500 event.mediaPurgeFailed` when the
media root could not be cleared — a read-only mount, or a disk that went away. That last
one leaves the rows alone on purpose, so the call can simply be retried once the disk is
back. CSRF applies as to every `DELETE` (§1).

### `GET /api/events/:slug/photos`

The admin gallery: the same photos as the queue, newest first, **without** the queue's
ordering. Cursor-paged rather than offset-paged because guests keep uploading while a
host scrolls, and an offset silently skips or repeats a photo as rows shift.

Query: `status` ∈ `pending | published | rejected | hidden | all` (default `all`),
`limit` 1..200 (default 60), `cursor` (opaque, max 512 characters, from a previous
`nextCursor`).

**200**

```json
{
  "items": [
    {
      "id": "…",
      "status": "published",
      "thumbUrl": "/api/events/camille-et-sacha/photos/…/thumb",
      "displayUrl": "/api/events/camille-et-sacha/photos/…/display",
      "width": 2560,
      "height": 1707,
      "caption": "Les confettis",
      "authorName": null,
      "byteSize": 5412880,
      "createdAt": "2026-06-20T21:04:11.031Z",
      "kind": "photo",
      "videoUrl": null,
      "durationMs": null
    }
  ],
  "nextCursor": null
}
```

Two differences from a moderation row, and both are deliberate rather than accidental.
`authorName` is **always `null`** here: this read resolves no guest, and looking one up
would mean a controller performing a second repository read. And `byteSize` **is** on
this row — it is the album view, where a host asking "what is filling my quota" is a
reasonable question, and it is the one surface that would render it. `Cache-Control:
no-store`.

### `GET /api/events/:slug/guests`

**No query parameter.** The schema is an empty `.strict()` object, so any parameter is a
`400 request.invalid` — including `activeWithinMinutes`, which this endpoint accepted and
discarded until 12 September.

**200**

```json
{
  "items": [
    {
      "id": "…",
      "displayName": "Léa",
      "joinedAt": "2026-06-20T19:12:00.000Z",
      "lastSeenAt": "2026-06-20T21:40:00.000Z",
      "photoCount": 7,
      "revoked": false
    }
  ],
  "activeCount": 74
}
```

Revoked guests are **included** in `items`: a removal the host cannot see afterwards
looks like a button that did nothing. `activeCount` is presence and excludes them.

`activeCount` counts the guests seen in the **last five minutes**, and that window is not
a caller's choice. It is one number on a console read across a room, so a window the
caller picked would make the same field mean "here now" to one screen and "was here this
evening" to the next, with nothing on the wire saying which — and at the top of the range
the old parameter allowed it would have converged on `items.length`, which this response
already carries. The window and the reason for it live in
`src/application/usecases/guests/listGuests.ts`. A second horizon, if a host ever needs
one, is a second named field and not a knob that redefines this one.

### `POST /api/events/:slug/guests/:guestId/revoke`

No body. **204**, and idempotent: this button is pressed on a phone in front of a
projector and will be double-tapped, so the entity keeps the first timestamp.
**Errors** — `404 guest.notFound`, which is also the answer for a guest of another event.

Revoking cuts the device off in both directions: the token it holds answers
`403 guest.revoked` on every guest route, and `POST /api/join` refuses that same device
a fresh identity with the ordinary `404 event.notFound`. It binds the **device**, not the
person — a guest who clears their cookies is a new guest with the code still printed on
the table — so pair it with a join-code rotation against somebody determined.
`docs/SECURITY.md` §11 has the full statement of the limit.

### `GET /api/events/:slug/moderators`

**200** `{ "items": [ … ] }`, owner only.

```json
{
  "items": [
    {
      "userId": "…",
      "email": "lea@example.test",
      "displayName": "Léa",
      "role": "moderator",
      "grantedAt": "2026-06-18T09:00:00.000Z"
    }
  ]
}
```

The address is here because it is how a host recognises the person they invited, and it
is only ever shown to an owner of that same event. Note what is absent: no password
state, no last login, and nothing about the other events that account may run.

### `POST /api/events/:slug/moderators`

```json
{
  "email": "lea@example.test",
  "displayName": "Léa",
  "temporaryPassword": "…"
}
```

`temporaryPassword` is **required**, and this is the part of the contract most likely to
surprise: there is no mailer in this product, so the credential is one the host reads out
to the person they are handing the laptop to. It is not generated server-side — the HTTP
layer holds no id generator, and a controller inventing a credential is exactly the kind
of decision this layer must not make. It is bounded only in length; the policy belongs to
`Password` and applies when the invitee chooses their own.

`displayName` is optional and may be `null`; the console lists the address when there is
no name.

**201**

```json
{ "userId": "…", "created": true }
```

`created` is the useful half: it says whether the temporary password the host just typed
is worth reading out. An address that already had an account keeps its own password — an
invitation that reset it would let one host take over a colleague's account, and with it
every other event that colleague runs.

**Errors** — `409 membership.alreadyExists`, `400 email.malformed`,
`400 email.containsWhitespace`, `400 email.empty`, `400 password.*` on the temporary
password.

> Until this audit the table above said only "Invite by email", and
> `web/src/lib/api/client.ts` sent only the address — so every invitation from the
> console was a `400 request.invalid`. Both halves are fixed: the table says what the
> schema requires, and the panel now has the password field
> (`web/src/features/admin/ModeratorsPanel.tsx`), asserted by
> `ModeratorsPanel.test.tsx` and by the client→server body contract test in
> `src/interface/http/presenters/requestContract.test.ts`.

### `DELETE /api/events/:slug/moderators/:userId`

**204**. The last owner is refused by the use case rather than the handler: an event left
unowned has no route back, since inviting is itself an owner's action.
**Errors** — `409 membership.lastOwner`, `404 membership.notFound`.

### `GET /api/events/:slug/share-link`

The event's shared gallery link (roadmap §4.1). **`owner`**, like the two below:
publishing the album beyond the room is a decision about the whole event. **200**,
`Cache-Control: no-store`:

```json
{
  "link": {
    "id": "…",
    "createdAt": "2026-06-21T10:00:00.000Z",
    "expiresAt": "2026-07-21T10:00:00.000Z",
    "hasPassword": true,
    "available": true
  }
}
```

`link` is `null` when the event has none. An expired link is still reported until it is
replaced, with `available: false`; so is one made by a co-owner whose account has since
been switched off. `available` is computed by the rule the gallery itself asks. **There is
no URL**: only the token's SHA-256 is stored, so the address exists once, in the answer
below.

### `POST /api/events/:slug/share-link`

**`owner`**. `{ "expiresInDays"?: 1–90, "password"?: string | null }`, **`.strict()`**.
Absent lifetime is 30 days; absent, `null` or empty password is none. Any event status,
archived included — the album is usually sent after the event is over.

**201**, `Cache-Control: no-store`: `{ "link": { …as above }, "url":
"<PUBLIC_URL>/g/<token>" }`. Making a link **revokes the current one in the same
transaction**, so a link that has gone further than meant is dealt with by making a new
one.

**Errors** — `400 shareLink.lifetimeInvalid` outside 1–90 days; the account policy's
`400 password.*` codes (twelve characters, not the event's name); `400 request.invalid`
for a lifetime that is not a whole number or an extra key; `403 auth.forbidden` for a
moderator; `404 event.notFound` for a non-member.

### `DELETE /api/events/:slug/share-link`

**`owner`**. **204**, idempotent: revoking when there is no link succeeds. Takes effect
on the next request any gallery page, thumbnail, download or archive entry makes.

### `GET /api/events/:slug/missions`

The host's prompt list (roadmap §2.1), with how the room is answering it.
**`moderator`**, unlike the three that follow: knowing that nobody has photographed the
cake yet is what a moderator standing at a laptop mid-evening actually wants, and telling
them costs the event nothing. Writing the sentence two hundred people read off a projector
is the owner's.

No paging: an event may hold at most **12** prompts, so the whole list is the page.

**200**

```json
{
  "items": [
    {
      "id": "…",
      "prompt": "un selfie avec les mariés",
      "scope": "guest",
      "achieved": true,
      "publishedPhotos": 17,
      "completedByGuests": 12
    }
  ]
}
```

All three numbers are counted over **published** photographs on every read and none of
them is stored, which is what makes them fall again the moment a host takes a photograph
down. `completedByGuests` counts distinct guests rather than photographs — a guest who
sent four selfies did the mission once — and a host's own upload counts towards
`publishedPhotos` and towards nobody's guest tally.

The photographs themselves are **not** here. A mission's photographs are ordinary
photographs, already in the queue and the gallery; §2.1 says they stay that way.

### `POST /api/events/:slug/missions`

**`owner`**. `{ "prompt": "…", "scope": "guest" | "event" }`, both required.

**201** with the row, which is a fact rather than a convenience: a freshly created prompt
has no photographs by construction, so its three numbers are genuinely zero.

**Errors** — `400 mission.promptEmpty` (nothing visible survives sanitising),
`400 mission.promptTooLong` (over 60 characters after it), `400 request.invalid` (a scope
outside the set, or a key this contract does not have — the body is `.strict()`),
`409 mission.duplicate` when this event already holds that prompt, `409 mission.limitReached`
with `details.max` when the event already holds twelve, `409 event.immutable` on an archived
event, `403 auth.forbidden` for a moderator, `404 event.notFound` for anybody else.

A prompt is **content**, not interface copy: it is stored as the host typed it, in whatever
language the event is held in, and nothing translates it. It is folded to one line and
stripped of invisible characters (bidirectional overrides, zero-width padding) before it is
stored, because it reaches a projector in front of two hundred people. Markup is _not_
stripped — React escapes on render, and a sanitiser here would eat a host writing "3 < 4".

### `PATCH /api/events/:slug/missions/:missionId`

**`owner`**. The same body as the create, **both fields every time** — the shape
`PATCH /events/:slug/schedule` already has, and for the same reason: they are one decision
made on one row of one form, and a partial update would let a scope be persisted beside a
prompt the server refused.

**204**, where the create answers 201 with the row. An edit changes a prompt and a scope and
touches no photograph, so nothing re-counts them; padding the response with zeros to keep
the two shapes matching would put a false number on the wire. The console refetches the
list, which it is doing anyway on the `mission.changed` signal this publishes.

This endpoint is why deleting and re-adding is the wrong way to fix a typo: a delete
**unfiles** every photograph that named the mission, so the correction would silently take
them out of the count they were already in. An edit keeps the id, so it keeps them.

**Errors** — the create's, plus `404 mission.notFound` for a prompt that does not exist or
belongs to another event, and `400 request.invalid` for a `:missionId` that is not a uuid.

### `DELETE /api/events/:slug/missions/:missionId`

**`owner`**. **204**.

It removes a **prompt** and never a photograph. Every photograph filed under it is unfiled
(`ON DELETE SET NULL` in the schema) and stays in the album, in the queue, in the export and
on the wall exactly as it was.

**Errors** — `404 mission.notFound` (including another event's), `409 event.immutable`,
`403 auth.forbidden` for a moderator, `404 event.notFound` for anybody else.

### `GET /api/events/:slug/top-photos`

"Photo de la soirée". Query: `limit` 1..50, default 10 — bounded low on purpose, because
the panel is projected and a podium of forty photos is not a podium.

**200**

```json
{
  "items": [
    {
      "photoId": "…",
      "thumbUrl": "/api/events/camille-et-sacha/photos/…/thumb",
      "counts": { "love": 12, "laugh": 3, "wow": 0, "cheers": 5, "clap": 1 },
      "total": 21
    }
  ]
}
```

Only the thumb is offered: the panel is a podium of small tiles beside the wall, and a
second full-size URL per entry would have the projector fetch megabytes it never renders.
`Cache-Control: no-store`.

### `PATCH /api/events/:slug/photos/:photoId/status`

```json
{ "decision": "publish" }
```

`decision` ∈ `publish | reject | hide` — the host's **verb**, never the resulting state.
The two vocabularies are kept apart so a client can never post a status it invented, and
so the status machine stays free to grow a state no keystroke maps to. **204**.

**Errors** — `409 event.notModeratable` on an archived event,
`409 photo.illegalTransition`, `404 photo.notFound`.

### `GET /api/events/:slug/moderation`

The console's one read: one tab of the queue, plus the badge.

Query: `status` ∈ `pending | published | rejected | hidden | all` (default `pending`),
`limit` 1..200 (default 60). **No `cursor`** — sending one is a `400 request.invalid`,
for the reason `nextCursor` is always `null` below. The cursor-paged surface is
`GET /api/events/:slug/photos`.

**200**

```json
{
  "items": [
    {
      "id": "…",
      "status": "pending",
      "thumbUrl": "/api/events/camille-et-sacha/photos/…/thumb",
      "displayUrl": "/api/events/camille-et-sacha/photos/…/display",
      "width": 2560,
      "height": 1707,
      "caption": "Les confettis",
      "authorName": "Léa",
      "createdAt": "2026-06-20T21:04:11.031Z",
      "kind": "photo",
      "videoUrl": null,
      "durationMs": null
    }
  ],
  "pendingCount": 12,
  "nextCursor": null
}
```

A row carries the **caption itself**, not a flag saying one exists. The host is deciding
whether that text is projected at the size of the room, and a badge is exactly what does
not let them read it. `authorName` is the sender's display name, resolved server-side in
one batched read, and `null` for a guest who stayed anonymous or for a host's own
upload — the client picks the French for an unattributed photo, and the server never
invents a name. `width` and `height` are the intrinsic size, so the grid is laid out
before the thumbnails arrive.

A moderation row may say more than a wall item, because a moderator is not the room. It
still carries no content hash, no storage key, no path — and no byte size, because
nothing renders one.

`pendingCount` is across the whole event rather than the page in hand: a badge that
shrank to the page size the moment a `limit` was applied would under-report the work
left. `nextCursor` is always `null`, and this queue is deliberately not cursor-paged —
the ordering is applied to the whole filtered set _before_ `limit`, so the oldest pending
photo cannot be pushed off the page by newer arrivals, and a cursor names a position in a
stable order that this one does not have. That is why the request refuses a `cursor`
rather than accepting one it would silently drop; `null` is reported rather than the key
omitted, so the client reads one shape either way. The pending tab is oldest first
for the same reason; every other tab is newest first, because there the host is looking
at what just happened.

`Cache-Control: no-store`. This is the one surface that shows photos the host has not
approved.

### `POST /api/events/:slug/moderation/bulk`

```json
{ "photoIds": ["…", "…"], "decision": "publish" }
```

**200**

```json
{ "applied": ["…"], "skipped": ["…"] }
```

`decision` is the same closed set as the single decision: `publish | reject | hide`.
`photoIds` is 1..200 UUIDs — bounded because a bulk action is a screenful, not an entire
album, and an unbounded array would let one request hold a transaction open across four
thousand rows.

A batch **skips** items whose transition is illegal rather than failing wholesale — a
bulk action across a screenful must not be lost because one photo was already rejected.
Ids from another event are neither applied nor reported: listing them as skipped would
confirm that a photo the caller may not see exists.

**Errors** — `409 event.notModeratable` on an archived event. A single illegal
transition is a skip, not an error.

---

## 7. Realtime

### `GET /api/events/:slug/stream`

Server-sent events, one channel per event.

```
: heartbeat

id: 41
event: change
data: {"type":"photo.moderated"}
```

Rules the implementation must keep:

- **Per-event channels.** The hub filters by event id before a listener is called.
  1.0 had one global emitter and every listener compared party names inside its own
  callback, with a fallback to the string `'myParty'`.
- **`flushHeaders()` immediately** and `X-Accel-Buffering: no`, or a reverse proxy
  buffers the stream and the wall appears frozen.
- **A heartbeat comment frame every 15 s.** Without it proxies and mobile networks
  close an idle connection and the wall silently stops updating.
- **`id:` on every frame, `Last-Event-ID` honoured on reconnect**, so a projector that
  drops for thirty seconds does not miss the photos published in between.
- **The payload is an invalidation signal, not data.** The client refetches the wall or
  the queue. Pushing rows would mean two divergent code paths for the same state and an
  authorization decision on the push side.
- Subscribers are capped per event — 200 by default — and the cap is answered with
  **`503 service.notReady` and a `Retry-After`, before a single header of the stream is
  written**. `EventBus.subscribe` returns a `Result`, so a refusal is a value the route
  has to handle rather than a no-op unsubscribe it cannot tell from a real one. A
  refused connection is a failed request, never a connection that carries nothing.
- The response opens with `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive` and a `: connected`
  comment frame, so a client behind a buffering proxy learns immediately that bytes flow.

**Concurrency limits, on both stream routes.** These count what is _held open_, not what
is spent per minute — a stream holds a socket, an interval and a subscription for the
whole evening, so requests-per-minute bounds nothing that matters here.

| Bound                                   | Value | Answer                                    |
| --------------------------------------- | ----- | ----------------------------------------- |
| Streams open at once per client key     | 12    | `429 rate.limited`                        |
| Streams open at once across the process | 500   | `503 service.notReady`, `Retry-After: 30` |
| Subscribers per event, in the bus       | 200   | `503 service.notReady`, `Retry-After`     |

A slot is returned the moment the connection closes, so a client that reloads gets it
straight back. The client key is the one every other limiter uses, IPv6 collapsed to its
/56 subnet.

### `GET /api/events/:slug/moderation/stream`

The same frames, on the same per-event channel, behind `requireRole('moderator')`.

Authorization matches the resource: the wall stream is public for an event that serves
its wall — a projector is a machine nobody will sign in to at 22:00 — while this one
refuses a caller with no session (`401 auth.required`) and a caller with no membership
(`404 event.notFound`). The payloads are identical because they are invalidation signals
rather than data; what differs is who may hold the connection open, and therefore who
learns that anything is happening at this event at all.

It is the channel a moderation console subscribes to, and the console does:
`api.moderationStreamUrl(slug)` in `web/src/lib/api/client.ts`, used by
`web/src/features/moderation/hooks/useModerationQueue.ts`. It used to hold the public
wall channel instead, which worked only because the frames are identical.

---

## 8. Not in 2.0

Deliberate omissions, with reasons in [ROADMAP.md](ROADMAP.md): no public write API for
third parties, no webhook delivery, no OAuth for hosts, no signed URLs for the event's own
media (it is authorized per request instead — the shared gallery's signed URLs in §2 are
the one exception, and they are re-checked against the link per request too), and no
GraphQL.

---

## 9. Where this contract and the code still disagree

> ### ⚠️ This section is not the contract. Nothing described here is implemented.
>
> Sections 1–8 above are the contract: every route there exists and behaves as written.
> **This section is the opposite** — it is the list of places where the server does _not_
> do what a reader would expect, plus, in §9.10, two routes that have been **proposed and
> never built**.
>
> If you are an agent or an integrator: §1–8 is what you may rely on. Treat anything you
> find only in §9 as a bug report, not as a specification. In particular
> `GET /api/join/:code` and `PATCH /api/events/:slug/guests/:guestId` in §9.10 **answer
> `404 route.notFound` today**, from the unmatched-`/api` fallback in
> `server.ts` — they are sketches of a shape that was judged natural, not endpoints.
> Calling one, or writing a client that expects one, will fail against the running
> server.
>
> Each entry is labelled. **doc corrected above** means §1–8 was wrong and has been
> fixed, so the entry is history. **code defect**, **stale code** and **drift** mean the
> behaviour is still wrong — deliberately left wrong, because rewriting a specification
> to agree with a bug is the one outcome an audit must not produce. When one is fixed,
> the fix moves the behaviour into §1–8 and the entry is deleted from here.
>
> An open entry may still be **narrowed**: a comment that misdescribed the defect can be
> corrected, and a claim that has gone stale can be struck, while the behaviour stays as
> it is and the entry stays here. An entry that says less than it did is progress; an
> entry that quietly says something untrue is the reason this section exists.
>
> **The numbers do not shift when an entry goes**, so a gap means "fixed and removed",
> not "missing". 9.2 (the moderator invitation the console could not send), 9.6 (the
> console on the public wall channel), 9.9 (the SSE subscriber cap failing in silence),
> 9.3 (`activeWithinMinutes` accepted and discarded) and 9.4 (the moderation `cursor`
> accepted and inert) have all been fixed and are now described where they belong, in §6
> and §7.

Found by an end-to-end audit of every route against
`src/interface/http/routes/*.ts`, `src/interface/http/schemas/requestSchemas.ts`,
`src/interface/http/presenters/dto.ts` and `web/src/lib/i18n/fr.ts`. Recorded rather than
papered over: §1 says this document is the specification and one side is a bug, so the
bug needs a name and a line number.

Every route that exists is documented, and every route documented exists — verified in
both directions: **37 routes in code, 37 `###` headings in §1–8, no discrepancy either
way**. Nothing here is a missing endpoint. The audit found ten divergences; five have
since been fixed and removed, and these five are the places where the code and the intent
above are not yet the same thing. Items marked **doc corrected above** have been fixed in
this file. The rest are code defects — rewriting a specification to agree with a bug is
the one outcome an audit must not produce.

**Three of the ten were a parameter accepted and then ignored** — the precise failure
`.strict()` exists to prevent, and one §1 states as part of this contract: a refused field
teaches the caller something, an accepted field that changes no answer lies to them. Two
are now closed and the third, 9.5, is below with the reason it is not.
`activeWithinMinutes` (9.3) and the moderation `cursor` (9.4) were each **removed from
their schema**, so sending either is now a `400 request.invalid`. That was a decision per
entry and not one rule applied twice: wiring the parameter was the live alternative in
both cases, and both refusals are argued next to the code they constrain — in
`listGuests.ts` for the presence window, in `requestSchemas.ts` for the cursor. Only two
branches are available to an entry of this shape, and leaving the field accepted is
neither.

### 9.1 The per-guest cap sends a code this document invented — **doc corrected above**

`src/application/usecases/photos/uploadPhotos.ts:177` returns
`DomainError.quotaExceeded('event.photoLimitReached')`. This file said
`403 photo.tooManyForGuest`, which the server has never sent and which is also the wrong
status — `quotaExceeded` maps to **413**. `web/src/lib/i18n/fr.ts` already carries French
for **both** spellings, with a comment saying it is keeping them until the contract picks
one. It has now picked: `event.photoLimitReached`. The `photo.tooManyForGuest` entry in
`fr.ts` is dead and can go.

### 9.5 The wall's e2e timing hooks are accepted and read by nothing — **stale code**

`wallQuery` (`requestSchemas.ts`) accepts `e2e_interval` and `e2e_transition`. The route
parses the query at `publicRoutes.ts:167`, passes `slideIntervalMs: null` at `:178`
unconditionally, and reads neither; the real overrides live client-side in
`web/src/features/wall/hooks/useTimingOverrides.ts`. **This is the third parameter-accepted-
then-ignored entry, and the one still open** — the other two are the closed 9.3 and 9.4
named in the numbering note above.

Narrowed on 12 September rather than closed. The schema's own comment claimed the route
honoured the pair under `E2E_HOOKS=1`, which described a design that is not there; it now
states that the server reads neither and points here. What remains is the accepting
itself, plus two things that follow it:

- `HttpConfig.e2eHooks` (`types.ts:75`, set from `container.ts:162`) is plumbed through
  the HTTP layer and **read by no handler**. `publicRoutes.test.ts` exercises both states
  of the flag precisely to pin that it changes no answer.
- The rationale the flag was given does not hold on the side that does read the hooks.
  `useTimingOverrides.ts` says "the server refuses to boot production with `E2E_HOOKS`
  set, so the hooks cannot reach a real event" — but that flag guards the **server**, and
  the overrides are applied in the **browser**, from the display URL, by the same bundle
  production serves. A projector opened on `?e2e_interval=50` is sped up in production
  today. Self-inflicted rather than cross-user, so it is a false rationale and not a
  vulnerability — but it is the sentence that would stop the next reader from removing
  the hooks, and it is wrong.

Closing it is a removal from `wallQuery` plus the flag, and it is not a one-file change:
`requestSchemas.ts` and its test; `publicRoutes.ts` and `publicRoutes.test.ts`, which
asserts **200** for `?e2e_interval=250&e2e_transition=10000` and is the test that goes red
first; `types.ts`, `container.ts` and `middlewareHarness.ts` for the flag; and
`docs/TESTING.md:414,472` with `.claude/skills/eventslide-e2e/SKILL.md:175`, which both
still describe the hooks as server-honoured. Nine files, one commit — which is why it did
not travel with 9.3 and 9.4, whose fixes were a schema line each.

### 9.7 One name, `ModerationPhotoDto`, for two different rows — **drift**

Re-verified on 12 September, and **two of the three claims this entry used to make were
themselves stale**; what is left is smaller and sharper than it was written.

The live half: `ModerationPhotoDto` in `src/interface/http/presenters/dto.ts:88` is the
row of `GET /api/events/:slug/photos` — the gallery — and carries `byteSize`.
`ModerationPhotoDto` in `web/src/lib/api/dto.ts:98` is the row of
`ModerationQueueResponse`, i.e. of `GET /api/events/:slug/moderation`, whose server row is
a **different interface**, `ModerationQueueItemDto` (`dto.ts:204`), which correctly has no
`byteSize`. So each declaration is right about the endpoint it actually serves, and the
drift is the shared name: a reader comparing the two finds a field on one side and not the
other and cannot tell whether that is a bug. Nothing receives the mismatched bytes today —
the gallery has no client method at all, which `requestContract.test.ts` records by name in
`NO_CLIENT_CALLER`. The fix is a rename on the client side to `ModerationQueueItemDto`, in
`web/src/lib/api/dto.ts` and its referents; it changes no wire format.

Corrected rather than carried forward: `ModerationQueueResponseDto` is **gone** — no
declaration anywhere — and `GuestListResponseDto` is **not dead**, `eventRoutes.ts` imports
it and types the guest-list response with it. Both were listed here as dead code.

### 9.8 Codes a guest or host can provoke that have no French copy — **copy gaps**

Each renders the generic "Une erreur est survenue" sentence, which tells the reader
nothing about a refusal they could act on. Reachable through a route, in rough order of
how likely anyone is to hit them:

| Code                       | Reached by                                                  |
| -------------------------- | ----------------------------------------------------------- |
| `request.tooLarge`         | Any JSON body over 64 KB — a 200-id bulk action is close    |
| `route.notFound`           | Any mistyped `/api` path                                    |
| `photo.mediaMissing`       | A photo row whose bytes are gone                            |
| `eventName.malformed`      | An event name with no letter or digit in it                 |
| `email.containsWhitespace` | A pasted address with a stray space, on the invitation form |
| `email.empty`              | A whitespace-only address on the same form                  |
| `upload.rejected`          | Multer's remaining refusals on an upload                    |
| `service.notReady`         | Only a probe sees this one; listed for completeness         |

`server.unexpected` deliberately has none: it falls through to the generic sentence,
which is the correct copy for a bug.

### 9.10 Two use cases are wired into the container with no route in front of them

Confirmed, and both are real: `makeResolveJoinCode`
(`src/application/usecases/events/resolveJoinCode.ts`, wired at
`src/main/usecases.ts:136`, declared at `src/interface/http/useCases.ts:62`) and
`makeRenameGuest` (`src/application/usecases/guests/renameGuest.ts`, wired at
`src/main/usecases.ts:180`, declared at `useCases.ts:71`). Both have unit tests; neither
is called by any router.

They are not the same kind of gap.

`resolveJoinCode` answers the question `/join/:code` asks before a guest commits: it
returns the event's name and whether captions and reactions are on, with the same
"unknown code and closed event are indistinguishable" rule as `POST /api/join`. Without a
route the join page cannot show a guest **which** event they are about to join before
they hand over a name — the client must call `POST /api/join`, which creates the guest
and sets the cookie, to find out. The natural shape is `GET /api/join/:code`, public,
rate-limited like the POST. It is a deliberate contract addition, not a bug fix, so it is
not written into §2 above.

`renameGuest` is the guest's ability to correct the name their photos are signed with —
and that name is projected in front of a room. `PATCH /api/events/:slug/guests/:guestId`
with the guest token, answering `403 auth.forbidden` when the acting guest is not the
target and `404 guest.notFound` when the id is not in this event, is what the use case is
already written for.

Neither is documented above, because this file specifies what the server implements.

**Still open on 12 September, and re-verified**: `src/main/usecases.ts:136` and `:180` wire
both, `useCases.ts:12` and `:19` declare both, `grep` over
`src/interface/http/routes/` finds them in no router — only in the route tests, which
stub them as deliberately unwired. Dead code that looks alive is worse than dead code that
looks dead, and this has been true across two reviews.

The decision is not deferrable much longer, and neither branch is a schema change, which
is why it did not travel with 9.3 and 9.4: **giving them routes** means a handler in
`publicRoutes.ts` for `GET /api/join/:code` (public, rate-limited like the POST) and one in
`guestRoutes.ts` for `PATCH /api/events/:slug/guests/:guestId` — `renameGuest` takes an
`actingGuestId` from the verified device token and refuses any other target, so it belongs
behind the guest-token middleware and **cannot** be mounted on the host surface in
`eventRoutes.ts`. **Deleting them** means the two use-case files, their unit tests, and the
lines in `usecases.ts` and `useCases.ts`. What deletion loses is worth writing down before
anyone takes it: the join page can then only tell a guest which event they are joining by
calling `POST /api/join`, which creates the guest and sets the cookie — the guest commits
before they can confirm they are at the right wedding — and a guest who mistypes the name
projected under their photos has no way to correct it.
