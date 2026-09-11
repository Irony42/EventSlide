# API — EventSlide 2.0

The HTTP contract. This document is the specification the server implements and the web
client consumes; when they disagree, this file is right and one of them is a bug.

Maintained by hand. An undocumented endpoint is an incomplete one — see
`.claude/skills/eventslide-http-endpoint/SKILL.md`.

> **Status.** Every route below is implemented on branch `deuxpointzero`; nothing is
> marked **(planned)** any more. Last audited end to end against
> `src/interface/http/routes/*.ts`, `schemas/requestSchemas.ts` and `presenters/dto.ts`.
> Where this document and the code still disagree, §9 says so by name rather than
> leaving the reader to find out from a 400.

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
breaking change. `message` is for logs and developers — the client picks French copy
from `code` via `web/src/lib/i18n/fr.ts` and must never display `message`. `details`
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

### Cross-cutting error codes

These are not attached to one endpoint and every client must handle them. Each has
French copy in `web/src/lib/i18n/fr.ts`; a code with none renders the generic fallback
sentence to a guest, which is why the two lists are kept in step.

| Code                      | Status | When                                                            |
| ------------------------- | ------ | --------------------------------------------------------------- |
| `request.invalid`         | 400    | Any zod failure: wrong type, out of bounds, unexpected field    |
| `request.tooLarge`        | 413    | A JSON body over 64 KB                                          |
| `request.csrfMissing`     | 403    | No `es_csrf` cookie, or no `X-CSRF-Token` header                |
| `request.csrfMismatch`    | 403    | The header does not equal the cookie                            |
| `auth.required`           | 401    | A route needs a principal and there is none                     |
| `auth.forbidden`          | 403    | In scope for the event, but the role is too weak                |
| `guestToken.expired`      | 401    | The device token is past its 36 hours                           |
| `guestToken.badSignature` | 401    | The device token does not verify                                |
| `guestToken.malformed`    | 401    | The token is unreadable, or its guest row no longer exists      |
| `route.notFound`          | 404    | No such `/api` endpoint — answered in the API's own error shape |
| `server.unexpected`       | 500    | A bug. `details.requestId` matches the `X-Request-Id` header    |

### Principals

| Principal            | Credential                                                                        | Established by         |
| -------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| **Host / moderator** | `es_session` cookie, `HttpOnly` `SameSite=Lax`                                    | `POST /api/auth/login` |
| **Guest**            | `es_guest` cookie, `HttpOnly` `SameSite=Lax`, HMAC-signed and scoped to one event | `POST /api/join`       |
| **Public**           | none                                                                              | —                      |

A guest token grants: upload to **that one event** while it is `live`, deletion of
**their own** photo inside the grace window, a caption on their own pending photo, and
a reaction. Nothing else. It is checked against the event in the URL on every request,
and the named guest row must not be revoked.

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
no cookie jar.

### Rate limits

Per minute, configurable, `429` with `Retry-After` when exceeded.

| Endpoint                                      | Default | Bucket                  | Code                   |
| --------------------------------------------- | ------- | ----------------------- | ---------------------- |
| `POST /api/join`                              | 20      | client IP               | `rate.limited`         |
| `POST /api/auth/login`                        | 10      | client IP               | `rate.limited`         |
| `POST /api/events/:slug/photos`               | 12      | client IP **and** event | `rate.limited`         |
| `POST /api/events/:slug/photos/:id/reactions` | 30      | client IP **and** event | `reaction.rateLimited` |

The two guest write endpoints key on IP **and** event on purpose: a whole table of
guests shares one access point and therefore one public IP, so a per-IP-only limit would
throttle the venue rather than an abuser, and a burst on one event must not close
another event running on the same box. IPv6 addresses are collapsed to their /56 subnet,
because a per-address limit on a /64 residential allocation is no limit at all.

Uploads are additionally bounded per event by a byte quota, which closes uploads rather
than filling the disk.

---

## 2. Public

### `GET /api/health`

Liveness. No authentication, no body validation, and it must not touch the database —
a health check that fails when the database is busy causes the restart it was meant to
prevent.

```json
{ "status": "ok", "version": "2.0.0", "uptimeSeconds": 4821 }
```

### `GET /api/ready`

Readiness. Verifies the database answers (one `SELECT 1`) and that the media root is
writable — actually writing and removing a probe file, because `access(W_OK)` reports a
read-only bind mount and a full disk as writable and then fails on the first upload.

**200**

```json
{ "status": "ready", "checks": { "database": "ok", "media": "ok" } }
```

**503** `service.notReady` when either fails, with `details` naming which:

```json
{
  "error": {
    "code": "service.notReady",
    "message": "A dependency is unavailable",
    "details": { "database": "ok", "media": "unavailable" }
  }
}
```

503 rather than 500: this is a correct answer about an incorrect state, and an
orchestrator distinguishes the two.

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
    "maxFilesPerUpload": 20
  }
}
```

Only what a guest may know before joining. The owner, the quota, the counts and the
settings that are none of their business are absent.

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
`e2e_interval` and `e2e_transition`, which the schema still accepts and nothing on the
server reads — they are honoured in the browser, and only when the server was started
with `E2E_HOOKS=1`. See §9.

**200**

```json
{
  "event": { "slug": "camille-et-sacha", "name": "Camille & Sacha" },
  "joinCode": "H7K2QM",
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
      "createdAt": "2026-06-20T21:04:11.031Z"
    }
  ],
  "slideIntervalMs": 8000,
  "kenBurnsDurationMs": 8520,
  "layout": "spotlight",
  "reactionsEnabled": true
}
```

`revision` is an order-sensitive fingerprint of `items`. The client refetches when an
SSE signal arrives and compares revisions to decide whether the playlist actually
changed — which is what stops the wall jumping on every unrelated event.

`layout` is where a wall **starts**, not where it stays, and from there on it is a
client-side concern. The projector reads `?layout=` off its own _display_ URL —
`/e/:slug/display?layout=mosaic`, which is what a kiosk's autostart line can hold — and
the host's `L` key cycles the same thing at the screen; both live in the browser
(`web/src/features/wall/hooks/useLayoutParam.ts`) and neither is sent here. Names are
`spotlight | mosaic | polaroid | filmstrip`, and an unknown or malformed one is ignored
in favour of this response's value rather than raising anything: a projector rendering
nothing for eight hours is the one failure this screen may not have. `polaroid` and
`filmstrip` are in the contract and render as their nearest built layout in 2.0.

`joinCode` is present because the wall is also the invitation: it shows the code and a
QR while it is empty, and keeps a small corner reminder afterwards, so a guest arriving
late can join from the screen alone. It is the only host-side value the wall carries,
and it is exactly the value already printed on the tables.

`authorName` is the name the guest typed at `POST /api/join` — the one thing they
supplied for exactly this purpose — and it is `null` whenever there is nobody to name: an
anonymous guest, or a photo the host uploaded from the venue's own camera. `null` means
**show no credit**, never a stand-in; "Invité" is French UI copy and belongs to the
client. Nothing else about the guest crosses: no guest id, no presence, no photo count.
The name is resolved event-scoped, like every other read here.

**Errors** — `404 event.notFound` when the event does not exist or is `draft` or
`archived`. A `closed` event still serves its wall: the projector is usually still on
while people say goodbye.

---

## 3. Guest

All of these require the `es_guest` cookie, scoped to the event in the path.

### `POST /api/events/:slug/photos`

`multipart/form-data`:

| Field     |                                                |
| --------- | ---------------------------------------------- |
| `photos`  | 1..`maxFilesPerUpload` files                   |
| `caption` | optional, applies to every file in the request |

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

| Per-file `code`             | Why                                                     |
| --------------------------- | ------------------------------------------------------- |
| `image.unsupportedFormat`   | The magic bytes are not JPEG, PNG, HEIC or WebP         |
| `image.corrupt`             | The header will not decode                              |
| `image.animated`            | An animated image; the wall is stills                   |
| `image.renderFailed`        | `sharp` could not re-encode it                          |
| `image.tooManyPixels`       | Refused by the processor's own pixel ceiling            |
| `photo.pixelBudgetExceeded` | Refused by the configured budget, from the header alone |
| `event.quotaExceeded`       | This file would overrun the event's byte quota          |

`event.quotaExceeded` is on that list and **not** in the whole-request list below: the
quota is charged file by file as the batch is written, so a guest sending five photos
into an almost-full event gets the first three accepted and the last two rejected,
rather than one 413 for the lot.

**Whole-request errors** — `401 auth.required` / `401 guestToken.*` for a missing or
invalid token; `403 guest.wrongEvent` when the token names another event;
`403 guest.revoked`; `409 event.notAcceptingUploads`; `413 upload.tooLarge` (one file
over `maxUploadBytes`, refused by multer before any of our code runs);
`400 upload.tooManyFiles`; `400 caption.tooLong`; `403 event.captionsNotAllowed` when a
caption is sent to an event with captions off; `413 event.photoLimitReached` when the
batch would take the guest past the event's `maxPhotosPerGuest`; `429 rate.limited`.
`400 upload.noFiles` when the request carries no `photos` part at all — a 201 with an
empty `results` array would tell a guest whose picker silently failed that their upload
worked. `400 upload.unexpectedField` when a file arrives under any other field name, and
`400 upload.rejected` for multer's remaining refusals (too many text fields, an
oversized field name or value).

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
      "canDelete": true
    }
  ]
}
```

`canDelete` is computed server-side from the grace window, the current status **and the
event's `allowGuestSelfDelete` switch**, so the client does not re-implement the rule and
then disagree with the server: it is exactly what `DELETE` below would allow.

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

`variant` ∈ `thumb | display | original`.

Served by a controller, never `express.static`, so authorization and event scoping
apply to every byte. 1.0 served media from a path built out of the session's `partyId`
and the client's filename.

| Caller           | May read                                           |
| ---------------- | -------------------------------------------------- |
| Public           | `thumb`, `display` of a **published** photo        |
| Guest            | the above, plus any variant of **their own** photo |
| Moderator, owner | any variant of any photo in that event             |

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

**Errors** — `404 photo.notFound`, including for a photo in another event and for a
variant the caller may not read. `404 photo.mediaMissing` when the row exists but its
bytes do not — distinguishable in the logs from a scoping miss, and identical on the
wire.

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

Three of these four take no principal, and each for its own reason: a login is where a
principal comes from, a logout can only ever destroy the one it was handed — answering
401 to a client whose session has just expired would leave the stale cookie in the
browser — and `/auth/me` exists to answer whether there is a principal at all. Stated
here so that an absent authorization middleware in `routes/authRoutes.ts` is a
documented decision rather than an omission a reader has to judge.

| Method | Path                 | Principal                                |
| ------ | -------------------- | ---------------------------------------- |
| `POST` | `/api/auth/login`    | none                                     |
| `POST` | `/api/auth/logout`   | none                                     |
| `GET`  | `/api/auth/me`       | none                                     |
| `POST` | `/api/auth/password` | any signed-in user; no event, so no role |

### `POST /api/auth/login`

```json
{ "email": "host@example.com", "password": "…" }
```

Regenerates the session id on success, to defeat fixation. Every failure returns the
same `401 auth.invalidCredentials` — unknown email, wrong password and disabled account
are indistinguishable, and an unknown email costs the same time as a known one.

**200**

```json
{
  "userId": "…",
  "email": "host@example.com",
  "displayName": "Camille",
  "mustChangePassword": false
}
```

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
    "mustChangePassword": false
  }
}
```

`{ "authenticated": false }` with **200** when there is no session — the client asks
this on every page load, and a 401 in the console on first visit is noise.

**`displayName` is always `null` here**, and that is the contract rather than a gap. The
response is built from the session principal alone, which holds a user id, an address and
the password flag and nothing else: a name in the session would be a copy that goes stale
the moment the account is renamed, and reading the row would make a controller touch a
repository. The fresh name comes from the login response; this endpoint answers the
question it is actually asked, which is whether the caller is signed in. A client that
needs a name on a page load has to keep the one `POST /api/auth/login` returned.

`Cache-Control: no-store`, always. The body is an identity and a rolling session
re-sends its cookie alongside it, so a shared cache holding this response would hand
one host's session to whoever asks next.

### `POST /api/auth/password`

```json
{ "currentPassword": "…", "newPassword": "…" }
```

**204**. **Errors** — `401 auth.invalidCredentials`, `400 password.*`,
`400 password.unchanged`, and `404 user.notFound` when the session outlived the
account it names — the id comes from the session, so a miss means the account was
deleted underneath it and never that the caller guessed wrong.

---

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

Four routes answer the **whole event** rather than `204`, and that is worth stating
because it is not obvious from the verb: rename, settings, status and join-code rotation
all end in the same `EventDto` that `GET /api/events/:slug` returns, so a console never
has to refetch to redraw a header, a QR code or a settings form after saving it.

### Errors across this section

`401 auth.required` with no session; `404 event.notFound` for an unknown slug **and** for
a caller with no membership of it; `403 auth.forbidden` — `details.required` naming
`owner` or `moderator` — for a moderator on an owner-only route. Beyond the
cross-cutting codes in §1:

| Code                       | Status | Where                                                           |
| -------------------------- | ------ | --------------------------------------------------------------- |
| `event.slugTaken`          | 409    | Create, when the slug is in use                                 |
| `event.immutable`          | 409    | Rename or settings on an `archived` event                       |
| `event.illegalTransition`  | 409    | A status change the lifecycle does not allow                    |
| `event.notModeratable`     | 409    | A single or bulk decision on an `archived` event                |
| `photo.illegalTransition`  | 409    | A decision the photo's status machine does not allow            |
| `guest.notFound`           | 404    | Revoking a guest id that is not in this event                   |
| `membership.alreadyExists` | 409    | Inviting someone who already moderates this event               |
| `membership.notFound`      | 404    | Revoking a membership that is not there                         |
| `membership.lastOwner`     | 409    | Revoking the only remaining owner                               |
| `event.joinCodeExhausted`  | 500    | Rotation could not find a free code — a bug, not a client error |
| `event.mediaPurgeFailed`   | 500    | A purge that could not remove the bytes; rows are left alone    |

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

### `POST /api/events`

```json
{
  "name": "Camille & Sacha",
  "slug": "camille-et-sacha",
  "startsAt": null,
  "quotaBytes": null
}
```

`slug` is optional and derived from `name` when absent, by the same function the UI
previews with — a second implementation in the client is how "the slug I saw is not the
slug I got" happens. `startsAt` is an ISO-8601 string or `null`; `quotaBytes` is a
positive integer or `null`, and `null` or absent takes the configured default. **201**
with the full event including its join code.

**Errors** — `409 event.slugTaken`, `400 eventName.*`, `400 slug.*`.

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
    "allowGuestSelfDelete": true,
    "guestSelfDeleteGraceSeconds": 900,
    "retentionDays": 30,
    "maxPhotosPerGuest": null
  },
  "startsAt": null,
  "closedAt": null,
  "role": "owner"
}
```

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
  "allowGuestSelfDelete": true,
  "guestSelfDeleteGraceSeconds": 900,
  "retentionDays": 30,
  "maxPhotosPerGuest": 20
}
```

| Field                         | Accepted                                 |
| ----------------------------- | ---------------------------------------- |
| `moderation`                  | `manual` \| `auto`                       |
| `allowCaptions`               | boolean                                  |
| `allowReactions`              | boolean                                  |
| `allowGuestSelfDelete`        | boolean                                  |
| `guestSelfDeleteGraceSeconds` | integer 0..86400                         |
| `retentionDays`               | integer 1..3650, or `null` for "keep"    |
| `maxPhotosPerGuest`           | integer 1..10000, or `null` for "no cap" |

**200** with the event. **Errors** — `409 event.immutable`,
`400 eventSettings.graceSecondsInvalid`, `400 eventSettings.retentionDaysInvalid`,
`400 eventSettings.maxPhotosPerGuestInvalid`.

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
**Errors** — `409 event.illegalTransition`.

### `POST /api/events/:slug/join-code`

No body. The emergency lever: a join link is circulating outside the venue, so the old
code stops working immediately. **200** with the event, carrying the new code and the
new `joinUrl`, so the console reprints the QR without a second request.

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
      "createdAt": "2026-06-20T21:04:11.031Z"
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

Query: `activeWithinMinutes`, integer 1..1440, default 30.

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

`activeWithinMinutes` is validated and then **not applied** — the use case owns what "at
the party" means and uses its own window. It is parsed rather than ignored so that a
malformed value is still a 400 rather than silently accepted, but a client must not
expect it to change the answer. See §9.

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
> `web/src/lib/api/client.ts` sends only the address — so every invitation from the
> console is a `400 request.invalid`. See §9.

### `DELETE /api/events/:slug/moderators/:userId`

**204**. The last owner is refused by the use case rather than the handler: an event left
unowned has no route back, since inviting is itself an owner's action.
**Errors** — `409 membership.lastOwner`, `404 membership.notFound`.

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
`limit` 1..200 (default 60). A `cursor` is accepted by the schema and read by nothing —
see `nextCursor` below, and §9.

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
      "createdAt": "2026-06-20T21:04:11.031Z"
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
photo cannot be pushed off the page by newer arrivals. The pending tab is oldest first
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
- Subscribers are capped per event — 200 by default — and the cap must be answered with
  **`503`, never a silent leak**. This is the one rule in this list the implementation
  does not keep today; see §9.9.
- The response opens with `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive` and a `: connected`
  comment frame, so a client behind a buffering proxy learns immediately that bytes flow.

### `GET /api/events/:slug/moderation/stream`

The same frames, on the same per-event channel, behind `requireRole('moderator')`.

Authorization matches the resource: the wall stream is public for an event that serves
its wall — a projector is a machine nobody will sign in to at 22:00 — while this one
refuses a caller with no session (`401 auth.required`) and a caller with no membership
(`404 event.notFound`). The payloads are identical because they are invalidation signals
rather than data; what differs is who may hold the connection open, and therefore who
learns that anything is happening at this event at all.

It is the channel a moderation console should subscribe to. Today's console does not —
see §9.

---

## 8. Not in 2.0

Deliberate omissions, with reasons in [ROADMAP.md](ROADMAP.md): no public write API for
third parties, no webhook delivery, no OAuth for hosts, no per-photo signed URLs (media
is authorized per request instead), and no GraphQL.

---

## 9. Where this contract and the code still disagree

Found by an end-to-end audit of every route against
`src/interface/http/routes/*.ts`, `src/interface/http/schemas/requestSchemas.ts`,
`src/interface/http/presenters/dto.ts` and `web/src/lib/i18n/fr.ts`. Recorded rather than
papered over: §1 says this document is the specification and one side is a bug, so the
bug needs a name and a line number.

Every route that exists is now documented, and every route documented exists. Nothing
here is a missing endpoint; these are the ten places where the code and the intent above
are not yet the same thing. Items marked **doc corrected above** have been fixed in this
file. The rest are code defects, and none of them has been touched — rewriting a
specification to agree with a bug is the one outcome an audit must not produce.

### 9.1 The per-guest cap sends a code this document invented — **doc corrected above**

`src/application/usecases/photos/uploadPhotos.ts:177` returns
`DomainError.quotaExceeded('event.photoLimitReached')`. This file said
`403 photo.tooManyForGuest`, which the server has never sent and which is also the wrong
status — `quotaExceeded` maps to **413**. `web/src/lib/i18n/fr.ts` already carries French
for **both** spellings, with a comment saying it is keeping them until the contract picks
one. It has now picked: `event.photoLimitReached`. The `photo.tooManyForGuest` entry in
`fr.ts` is dead and can go.

### 9.2 The moderator invitation is unusable from the console — **code defect**

`src/interface/http/schemas/requestSchemas.ts:239` requires `temporaryPassword`, and
`src/interface/http/routes/eventRoutes.ts:357` parses the body with it.
`web/src/lib/api/client.ts:183` sends `{ email }` and nothing else, so every invitation
from `web/src/features/admin/ModeratorsPanel.tsx` is refused with
`400 request.invalid`. The client also types the response as `ModeratorDto` where the
server answers `{ userId, created }` at 201.

The contract in §6 is the server's, and it is the right one — there is no mailer, so the
host has to hand over a credential. The client is the side to fix: a password field in
the panel, threaded through `useInviteModerator` and `api.inviteModerator`.

### 9.3 `activeWithinMinutes` is validated and then ignored — **code defect**

`src/interface/http/routes/eventRoutes.ts:293` parses `guestListQuery` and discards the
result; `listGuests` uses its own `PRESENCE_WINDOW_MS`. A parameter that is accepted,
bounded, and then has no effect is the precise failure mode `.strict()` exists to
prevent — the sender believes it took effect. Either thread it into the use case or drop
it from the schema so that sending it is a 400.

### 9.4 The moderation queue accepts a `cursor` it cannot use — **code defect**

`moderationQueueQuery` (`requestSchemas.ts:181`) accepts `cursor`;
`src/interface/http/routes/moderationRoutes.ts:115` never reads it and the response
always says `nextCursor: null`. Same shape of problem as 9.3, and the fix is the same
one: this queue is deliberately not cursor-paged, so the field should not be accepted.

### 9.5 The wall's e2e timing hooks are accepted and read by nothing — **stale code**

`wallQuery` (`requestSchemas.ts:209`) accepts `e2e_interval` and `e2e_transition`, and
its own comment says the route honours them under `E2E_HOOKS=1`. The route
(`publicRoutes.ts:178`) passes `slideIntervalMs: null` unconditionally and reads neither;
the real overrides live client-side in
`web/src/features/wall/hooks/useTimingOverrides.ts`. The comment describes a design that
is not there, and `HttpConfig.e2eHooks` is plumbed to this and used by nothing.

### 9.6 The moderation console subscribes to the public stream — **code defect**

`web/src/features/moderation/hooks/useModerationQueue.ts:392` uses `api.streamUrl`,
which is the **public wall** channel (`web/src/lib/api/client.ts:193`).
`GET /api/events/:slug/moderation/stream` (`streamRoutes.ts:219`) is implemented,
authorized and unused. The frames are identical so nothing is visibly broken, but the
console holds an unauthenticated connection to an endpoint whose whole point is that the
authorized one exists.

### 9.7 `ModerationPhotoDto` differs between the two declarations — **drift**

`src/interface/http/presenters/dto.ts:89` carries `byteSize`;
`web/src/lib/api/dto.ts:98` does not, and its comment says the field was removed because
nothing renders it. Both are in use: the server's is the row of
`GET /api/events/:slug/photos`, which really does ship `byteSize`. The client type is
simply narrower than the bytes it receives, which typechecks and misleads. §6 above now
documents the field as present.

Two server DTOs are also dead: `ModerationQueueResponseDto` and `GuestListResponseDto`
(`presenters/dto.ts:102` and `:155`) have no referent anywhere. The first is the more
dangerous of the two, because it describes the queue page with the `byteSize`-carrying
row that the queue no longer sends.

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

### 9.9 The SSE subscriber cap fails silently instead of answering 503 — **code defect**

The most serious item on this list, and the one §7 is left stating as intent.

`src/infrastructure/realtime/inMemoryEventBus.ts:70` refuses a subscription past
`maxSubscribersPerEvent` (200 by default) by logging a warning and returning a **no-op
unsubscribe**, with a comment saying "the HTTP layer decides whether to answer 503".
`src/interface/http/routes/streamRoutes.ts:148` calls `bus.subscribe` and ignores what
comes back. The HTTP layer never decides anything.

What a projector gets when an event is over the cap: `200`, the headers, `: connected`,
and a heartbeat comment every fifteen seconds — for the rest of the night, without a
single `change` frame. It looks connected to the client, to the browser's network panel,
and to the `connected` flag `useEventStream` exposes. The wall simply stops updating.

That is trap §9.3 in CLAUDE.md ("SSE dies silently behind proxies") reproduced on our own
side of the wire, and it is worse than the proxy version because there is no dropped
connection for a reconnect to notice. The fix belongs in `openStream`: `subscribe` has to
report refusal, and the route has to answer `503 service.notReady` before it writes any
headers.

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
