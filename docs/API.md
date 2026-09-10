# API — EventSlide 2.0

The HTTP contract. This document is the specification the server implements and the web
client consumes; when they disagree, this file is right and one of them is a bug.

Maintained by hand. An undocumented endpoint is an incomplete one — see
`.claude/skills/eventslide-http-endpoint/SKILL.md`.

> **Status.** The contract is fixed. Endpoints land on branch `deuxpointzero`
> incrementally; anything not yet implemented is marked **(planned)**.

---

## 1. Conventions

|               |                                                       |
| ------------- | ----------------------------------------------------- |
| Base path     | `/api`                                                |
| Encoding      | JSON, UTF-8. Uploads are `multipart/form-data`.       |
| Timestamps    | ISO-8601 UTC strings, e.g. `2026-06-20T21:04:11.031Z` |
| Ids           | Opaque UUIDv4 strings. Never assume order or meaning. |
| Empty success | `204 No Content` with no body                         |

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

Mismatch → `403 request.csrfMismatch`.

### Rate limits

Per IP, per minute, configurable. Exceeding one returns 429 with `Retry-After`.

| Endpoint                                      | Default |
| --------------------------------------------- | ------- |
| `POST /api/join`                              | 20      |
| `POST /api/auth/login`                        | 10      |
| `POST /api/events/:slug/photos`               | 12      |
| `POST /api/events/:slug/photos/:id/reactions` | 30      |

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

Readiness. Verifies the database answers and the media root is writable.
`503 service.notReady` when either fails.

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

**Errors** — `404 event.notFound` for an unknown code **and** for an event that is
`draft`, `closed` or `archived`. Deliberately indistinguishable: a distinguishable
"not open yet" would let someone enumerate which codes exist.
`400 joinCode.wrongLength`, `400 joinCode.malformed`, `400 displayName.tooLong`,
`429 rate.limited`.

### `GET /api/events/:slug/wall`

The projected wall. Public read of **published** photos only — the read path is
structurally incapable of returning a pending photo.

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

`joinCode` is present because the wall is also the invitation: it shows the code and a
QR while it is empty, and keeps a small corner reminder afterwards, so a guest arriving
late can join from the screen alone. It is the only host-side value the wall carries,
and it is exactly the value already printed on the tables.

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

**Errors** — `401` no or invalid token; `403 guest.wrongEvent` when the token names
another event; `403 guest.revoked`; `409 event.notAcceptingUploads`;
`413 upload.tooLarge`; `413 event.quotaExceeded`; `400 upload.tooManyFiles`;
`400 caption.tooLong`; `403 photo.tooManyForGuest`; `429 rate.limited`.
`400 upload.noFiles` when the request carries no `photos` part at all — a 201 with an
empty `results` array would tell a guest whose picker silently failed that their upload
worked. `400 upload.unexpectedField` when a file arrives under any other field name.

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

`null` clears it. Author-only, while pending, inside the grace window. **204**.

**Errors** — `403 photo.captionEditForbidden`, `403 event.captionsNotAllowed`,
`404 photo.notFound`, `400 caption.tooLong`.

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

Response headers: `Cache-Control: private, max-age=31536000, immutable` and a strong
`ETag`. Safe because the filename is the content hash — different bytes are a different
URL. `original` is never cached publicly.

**Errors** — `404 photo.notFound`, including for a photo in another event and for a
variant the caller may not read.

### `GET /api/events/:slug/album.zip`

Streams the album. Moderator or above. Includes only statuses the domain's `isInAlbum`
accepts — `published` and `hidden`, **never** `rejected`. 1.0's ZIP shipped every row
regardless of status, so a host who carefully rejected a photo handed it out anyway.

`Content-Disposition: attachment; filename="<slug>-album.zip"`. Streamed, never
buffered.

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
    "displayName": "…",
    "mustChangePassword": false
  }
}
```

`{ "authenticated": false }` with **200** when there is no session — the client asks
this on every page load, and a 401 in the console on first visit is noise.

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

| Method   | Path                                       | Role      |                                               |
| -------- | ------------------------------------------ | --------- | --------------------------------------------- |
| `GET`    | `/api/events`                              | any       | Dashboard summaries                           |
| `POST`   | `/api/events`                              | any       | Create; the creator becomes owner             |
| `GET`    | `/api/events/:slug`                        | moderator | Full event including settings                 |
| `PATCH`  | `/api/events/:slug`                        | owner     | Rename                                        |
| `PATCH`  | `/api/events/:slug/settings`               | owner     | Settings                                      |
| `POST`   | `/api/events/:slug/status`                 | owner     | `{ "status": "live" }`                        |
| `POST`   | `/api/events/:slug/join-code`              | owner     | Rotate                                        |
| `DELETE` | `/api/events/:slug`                        | owner     | Purge: media first, then rows                 |
| `GET`    | `/api/events/:slug/photos`                 | moderator | Paginated, filterable                         |
| `GET`    | `/api/events/:slug/moderation`             | moderator | Queue + `pendingCount`                        |
| `PATCH`  | `/api/events/:slug/photos/:photoId/status` | moderator | `{ "decision": "publish" }`                   |
| `POST`   | `/api/events/:slug/moderation/bulk`        | moderator | `{ "photoIds": [...], "decision": "reject" }` |
| `DELETE` | `/api/events/:slug/photos/:photoId`        | moderator | Delete any photo                              |
| `GET`    | `/api/events/:slug/guests`                 | moderator | Guest list + active count                     |
| `POST`   | `/api/events/:slug/guests/:guestId/revoke` | moderator | Remove a disruptive guest                     |
| `GET`    | `/api/events/:slug/moderators`             | owner     | Memberships                                   |
| `POST`   | `/api/events/:slug/moderators`             | owner     | Invite by email                               |
| `DELETE` | `/api/events/:slug/moderators/:userId`     | owner     | Revoke; never the last owner                  |
| `GET`    | `/api/events/:slug/top-photos`             | moderator | Photo of the night                            |

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
slug I got" happens. **201** with the full event including its join code.

**Errors** — `409 event.slugTaken`, `400 eventName.*`, `400 slug.*`.

### `POST /api/events/:slug/moderation/bulk`

```json
{ "photoIds": ["…", "…"], "decision": "publish" }
```

**200**

```json
{ "applied": ["…"], "skipped": ["…"] }
```

A batch **skips** items whose transition is illegal rather than failing wholesale — a
bulk action across a screenful must not be lost because one photo was already rejected.
Ids from another event are neither applied nor reported.

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
- Subscribers are capped per event; the cap is `503` rather than a silent leak.

Authorization matches the resource: the wall stream is public for an event that serves
its wall; the moderation stream requires a moderator.

---

## 8. Not in 2.0

Deliberate omissions, with reasons in [ROADMAP.md](ROADMAP.md): no public write API for
third parties, no webhook delivery, no OAuth for hosts, no per-photo signed URLs (media
is authorized per request instead), and no GraphQL.
