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
| `POST /api/events/:slug/clips`                | 12      | client IP **and** event | `rate.limited`         |
| `POST /api/events/:slug/photos/:id/reactions` | 30      | client IP **and** event | `reaction.rateLimited` |

The two guest write endpoints key on IP **and** event on purpose: a whole table of
guests shares one access point and therefore one public IP, so a per-IP-only limit would
throttle the venue rather than an abuser, and a burst on one event must not close
another event running on the same box. IPv6 addresses are collapsed to their /56 subnet,
because a per-address limit on a /64 residential allocation is no limit at all.

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
{ "status": "ready", "checks": { "database": "ok", "media": "ok", "video": "ok" } }
```

**503** `service.notReady` when either fails, with `details` naming which:

```json
{
  "error": {
    "code": "service.notReady",
    "message": "A dependency is unavailable",
    "details": { "database": "ok", "media": "unavailable", "video": "ok" }
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
`spotlight | mosaic | polaroid | filmstrip | collage | split`, and an unknown or
malformed one is ignored in favour of this response's value rather than raising
anything: a projector rendering nothing for eight hours is the one failure this screen
may not have. All six render themselves; none falls back to a neighbour. `L` walks them
in the order above and wraps.

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

| `status`  | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| `queued`  | Waiting for the worker. This is what a fresh upload answers            |
| `running` | Being transcoded now                                                   |
| `done`    | `photoId` exists, `pending` like any other upload until a host decides |
| `failed`  | Given up on. `failureCode` says why, and the client words it in French |

**Errors** — `400 clip.unsupportedFormat` when the bytes are not a container this server
opens, decided from the **signature** before anything is written;
`400 clip.sourceByteSizeInvalid` for an empty file; `400 upload.noFiles` when the request
carries no `clip` part; `403 event.clipsNotAllowed` when the host turned video off for
this event; `403 event.captionsNotAllowed`; `409 event.notAcceptingUploads`;
`413 upload.tooLarge` past `MAX_CLIP_BYTES`; `413 event.quotaExceeded`;
**`429 clip.queueFull` with `Retry-After`** when the box has more clips waiting than it
will accept — a condition that clears in about a minute, and deliberately not the
quota's `413`, which tells a guest the gallery is full and to go and find the organiser;
`500 clip.stageFailed`; and `500 clip.transcoderUnavailable` when this deployment has no
video encoder at all.

### `GET /api/events/:slug/clips/:clipJobId`

"Where is my clip?" — the one question a guest has during the window between the upload
and the transcode, when `GET /photos/mine` has nothing to show them. Guest token
required, and a guest may read only their **own** job.

Answers the same body as the upload above. `Cache-Control: no-store`: this is the one
view whose purpose is to change.

**Errors** — `404 clipJob.notFound` for a job that does not exist, one in another event,
**and one belonging to another guest**. Never `403`: a 403 would confirm that the id
names a real clip, and these ids are handed out to phones.

The `failureCode` on a `failed` job is one of `clip.unsupportedFormat`, `clip.corrupt`,
`clip.noVideoStream`, `clip.durationUnknown`, `clip.tooShort`, `clip.tooLong`,
`clip.transcodeFailed`, `clip.transcodeTimedOut`, `clip.storageFailed`,
`clip.sourceMissing`, `clip.transcoderUnavailable`, `clip.abandoned`,
`event.quotaExceeded` or `event.photoLimitReached`. Each has French copy, because a clip
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

| Code                       | Status | Where                                                           |
| -------------------------- | ------ | --------------------------------------------------------------- |
| `event.slugTaken`          | 409    | Create, when the slug is in use                                 |
| `event.immutable`          | 409    | Rename, settings or schedule on an `archived` event             |
| `event.illegalTransition`  | 409    | A status change the lifecycle does not allow                    |
| `event.scheduleInPast`     | 400    | A scheduled instant whose minute has already gone by            |
| `event.scheduleOutOfOrder` | 400    | A scheduled closing at or before the scheduled opening          |
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
    "allowClips": true,
    "allowGuestSelfDelete": true,
    "guestSelfDeleteGraceSeconds": 900,
    "retentionDays": 30,
    "maxPhotosPerGuest": null
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
  "maxPhotosPerGuest": 20
}
```

| Field                         | Accepted                                 |
| ----------------------------- | ---------------------------------------- |
| `moderation`                  | `manual` \| `auto`                       |
| `allowCaptions`               | boolean                                  |
| `allowReactions`              | boolean                                  |
| `allowClips`                  | boolean                                  |
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

### `POST /api/events/:slug/join-code`

No body. The emergency lever: a join link is circulating outside the venue, so the old
code stops working immediately. **200** with the event, carrying the new code and the
new `joinUrl`, so the console reprints the QR without a second request.

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
third parties, no webhook delivery, no OAuth for hosts, no per-photo signed URLs (media
is authorized per request instead), and no GraphQL.

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
