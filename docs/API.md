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

- **Every body and every query schema is strict** (`z.strictObject`). An unexpected field is a **400**,
  not a silently ignored key. A client that sends `{ "name": …, "colour": … }` to an
  endpoint that knows nothing about `colour` is told so, rather than believing the value
  took effect. This applies to query strings too — including the wall's, which is why a
  projector URL must not carry tracking parameters.
- **A schema failure is always `400 request.invalid`**, never a per-field code.
  `details.fields` names up to ten offending paths, comma-separated, each once however many
  rules it broke, and never echoes the values:

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

- **A path that is not valid percent-encoding is `400 request.invalid` too**, with no
  `details`: `/api/events/%E0%A4%A/wall`, `/g/%E0%A4%A`, a link copied with its last escape
  cut in half. The router refuses it when it matches the address to a route, before that
  route's handlers and before any lookup, so it is the same answer for every address and
  tells the caller nothing about whether the thing it names exists. (The gates mounted ahead
  of the routers — CSRF on a state-changing method, the session and the password-change
  gate — still answer first, as they do for any path.) It never echoes the parameter, which
  on a gallery, invitation or password-reset address is the credential, and it is not
  written to the log as a failure. On an address that carries a credential it goes out with
  the gallery's three headers (below). Two surfaces answer it in their own voice, because
  their contract is one refusal for every dead link: the shared gallery's API, below, and the
  invitation API.

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

**Caching.** Everything under `/api` is `Cache-Control: no-store` unless its own entry says otherwise:
the media of a photograph (§4, `immutable`, because its name is its content hash) and the event
streams (§7) set their own. A route does not have to remember to say it, and one that forgot used to
answer the host's list of moderators, with their e-mail addresses, with no header at all.

**404 and 403 are used deliberately.** A photo, guest or reaction belonging to another
event returns **404**, not 403 — a 403 would confirm the resource exists and turn the
endpoint into an enumeration oracle. **So does a guest token that names another event**: it is
`404 event.notFound` too, whatever the status of the event asked about. 403 is only for a principal
who is genuinely in scope but lacks the role.

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
| `request.invalid`             | 400    | A zod failure, or a path that is not valid percent-encoding                      |
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

Two cookies are not credentials. `es_csrf` is the CSRF value (below). **`es_device`** is set by a
completed `POST /api/auth/login` (and by `POST /api/auth/password`) and is a key for the sign-in throttle's bucket, not a principal:
it authenticates nobody and skips no step of a sign-in (see `POST /api/auth/login` and
docs/SECURITY.md §5). `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS, `Path=/api/auth`, 90
days, renewed by every successful sign-in and kept across a sign-out.

A guest token grants: upload to **that one event** while it is `live`, deletion of
**their own** photo inside the grace window, a caption on their own pending photo, a
reaction, changing **their own** display name, and reading and acknowledging the event's privacy
notice for **that device**.
Nothing else. It is checked against the event in the URL on every request,
and the named guest row must not be revoked.

A gallery token grants one thing: reading the **published** photographs of one event, in
full resolution, while the link is open and its creator still owns the event. It is not a
guest token and carries no event in the URL; §2's shared gallery routes resolve everything
from it.

### `/api/site` and `/api/site/*` — reserved for the box's operator

The namespace for running one box for other people (roadmap §10.9): `/api/site` itself and
every path below it, at a segment boundary — `/api/sites` is not in it and answers as any
unknown path does. What it carries is below: the box's **reads** (clients, a client's events, accounts,
the audit log, the defaults a new client starts with) and the operator's **acts on a client and its
owner** (open one, rename it, change its ceilings, invite into it, reset a password). Its suspension and resumption are here as well;
The operator's acts on **accounts** (switch off, switch on, delete) and on the **end of an engagement**
(offboard) are here too.

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

The web client does not probe this namespace to learn the mode. It reads
`features.siteAdmin` from the public instance-information endpoint, `GET /api/about` (§2),
which is derived from the very setting that decides whether the namespace is mounted, so
the two cannot disagree. The operator's console, `/admin/site` (G2-15, docs/SECURITY.md §23),
is registered only where that flag is true, and offered only to an account whose
`GET /api/auth/me` says `canOperateSite`: two flags, two questions, and neither is an
authorisation, since every request below is judged by the gate described here.

**What the namespace is.** Every route below is behind `requireOperator` and, where the box asks for
one, the second factor (the table above). **Every route that changes something is also behind
`requireStepUp`** (§5): the session must have confirmed the person with their password, and a fresh code
where they have an authenticator, within the last five minutes, or the answer is **403
`auth.stepUpRequired`** — **before the body is read**, so a body is never parsed for a caller who may not
send it. That is stricter than the plan's table, which names the irreversible acts only; a console prompts
once before a session of writes. The reads ask for none. A state-changing request meets CSRF first.

| Route                                            | What it is                                      | Step-up | Audit line(s)                                       |
| ------------------------------------------------ | ----------------------------------------------- | :-----: | --------------------------------------------------- |
| `GET /api/site/clients`                          | every client with its ceilings and what it uses |    —    | —                                                   |
| `GET /api/site/clients/:clientId/events`         | one client's events as shapes and sizes         |    —    | —                                                   |
| `GET /api/site/accounts`                         | every account, by address                       |    —    | —                                                   |
| `GET /api/site/audit`                            | the audit log                                   |    —    | —                                                   |
| `GET /api/site/client-defaults`                  | the ceilings a new client starts with           |    —    | —                                                   |
| `POST /api/site/clients`                         | open a client and invite its owner              |   yes   | `client.created`, `invitation.issued`               |
| `PATCH /api/site/clients/:clientId`              | rename a client                                 |   yes   | `client.renamed`                                    |
| `PUT /api/site/clients/:clientId/ceilings`       | change a client's ceilings, **with a reason**   |   yes   | `client.ceilingsChanged` (and `client.periodReset`) |
| `POST /api/site/clients/:clientId/suspend`       | freeze a client                                 |   yes   | `client.suspended`                                  |
| `POST /api/site/clients/:clientId/resume`        | lift a suspension                               |   yes   | `client.resumed`                                    |
| `POST /api/site/clients/:clientId/invitations`   | invite somebody into a client's account         |   yes   | `invitation.issued`                                 |
| `POST /api/site/accounts/:userId/password-reset` | reset an account's password                     |   yes   | `account.resetRequested`, `account.resetIssued`     |
| `POST /api/site/clients/:clientId/offboard`      | end an engagement                               |   yes   | `client.offboarded`                                 |
| `POST /api/site/accounts/:userId/disable`        | switch an account off                           |   yes   | `account.disabled` (one line per client)            |
| `POST /api/site/accounts/:userId/enable`         | switch an account back on                       |   yes   | `account.enabled` (one line per client)             |
| `DELETE /api/site/accounts/:userId`              | delete an account (erasure request)             |   yes   | `account.deleted` (one line per client)             |

**The reads show shapes and sizes, never what a client or a guest made.** A client row is an id, a name,
its ceilings, the instants it was created, suspended and set to be purged, and four counts and a byte sum;
an event row is an id, a status, instants, a quota and what is used; an account row is an id, an address, a
role on the box, instants, whether it must change its password, the number of events it owns and the
clients it belongs to. There is **no** event name, slug or join code, no photograph or caption, no guest or
guest's name, no mission prompt, no account display name, no contact address and no hash or token of any
kind in any answer of the namespace (docs/SECURITY.md §18 and §22). Every read is `Cache-Control: no-store`.

**Pages** are keyset pages, newest first. `limit` is 1 to 200 (50 by default); `after` is the `next` of
the previous page and is an id. A page ends with `"next": null`. A cursor that names nobody is an **empty
page**, not the first one again; so is a cursor that names another client's event. The audit log pages with
`before` (the `next` of the previous page, a number), which is **a bound and not a pointer**: every line
older than it, so a `before` past the newest line answers the newest page and not an empty one. A key a
query does not have is `400 request.invalid`.

#### `GET /api/site/clients`

`?after=<clientId>&limit=<1..200>`. **200**

```json
{
  "items": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "Camille et Sacha",
      "createdAt": "2026-06-20T21:00:00.000Z",
      "suspendedAt": null,
      "purgeAfter": null,
      "ceilings": {
        "maxEvents": 3,
        "maxTotalBytes": null,
        "maxEventQuotaBytes": null,
        "maxRetentionDays": null,
        "clipsAllowed": true,
        "liveAllowed": true,
        "maxLiveDays": null,
        "maxEventsPerPeriod": null,
        "periodStartedAt": null
      },
      "eventsCreatedInPeriod": 0,
      "usage": {
        "eventCount": 1,
        "liveEventCount": 1,
        "memberCount": 3,
        "usedBytes": 0
      }
    }
  ],
  "next": null
}
```

`usedBytes` is the figure the upload paths enforce `maxTotalBytes` against (photographs of every status
plus the staged source of every clip still waiting to be transcoded), so the number the operator reads is
the number a guest is refused against.

#### `GET /api/site/clients/:clientId/events`

`?after=<eventId>&limit=<1..200>`. **200** `{ "items": [ { "id", "status", "createdAt", "startsAt",
"openedAt", "closedAt", "quotaBytes", "usedBytes", "photoCount" } ], "next" }`. **404 `client.notFound`** for
a client that does not exist, which is **not** a client with no event (an empty page).

#### `GET /api/site/accounts`

`?after=<userId>&limit=<1..200>`. **200** `{ "items": [ { "id", "email", "siteRole", "createdAt",
"lastLoginAt", "disabledAt", "mustChangePassword", "ownedEventCount", "clients": [ { "clientId", "role" } ] } ],
"next" }`.

#### `GET /api/site/audit`

`?before=<seq>&limit=<1..200>&clientId=<clientId>`. The **whole log** when no `clientId` is named, which is
the operator's view and not a client's, and one client's lines when one is. **200**

```json
{
  "items": [
    {
      "seq": 17,
      "at": "2026-06-20T21:00:00.000Z",
      "action": "client.ceilingsChanged",
      "actor": {
        "kind": "operator",
        "userId": "11111111-1111-4111-8111-111111111111",
        "label": null
      },
      "subject": { "type": "client", "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      "clientId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "details": {
        "before": { "maxEvents": null },
        "after": { "maxEvents": 3 },
        "reason": "Forfait mis à jour"
      }
    }
  ],
  "next": 16
}
```

`details` holds numbers, switches, instants and, **at the top level and under the key `reason`, the
operator's own sentence**: the one free text the log holds. A row stored under an older allow-list is read
again at the door and anything else in text is dropped. Unlike the client's own view (`GET /api/client/audit`,
§6), this one names the account behind an `operator` or a `member` actor and carries the reason.

#### `POST /api/site/clients`

`{ "clientName": string, "ownerEmail": string, "locale"?: "fr"|"en"|"de"|"es"|"it", "ceilings"?: { … } }`.
Opens a client **with no member and no event** and invites its owner; the owner's account exists only once
the invitation is accepted. `ceilings` is the operator's own: a ceiling it names is kept, `null` included
(it lifts the box's `NEW_CLIENT_*` default for this client), and one it leaves out takes the default.
**201**, `Cache-Control: no-store`

```json
{
  "clientId": "…",
  "invitation": {
    "id": "…",
    "delivery": "mail",
    "expiresAt": "2026-06-27T21:00:00.000Z",
    "pendingApproval": false
  }
}
```

`delivery` is `mail` or `link`. **`link` — the invitation's URL — is in the answer only where no mail went
out** (a box with no relay, or a relay that failed), because there is then no other way to get it to the
owner. Where a mailer delivers, **the answer holds no token and no link**: it is in the owner's inbox and
nowhere else. `pendingApproval` is `false` by construction.

**400** `request.invalid` (a missing or unknown key, a locale outside the catalogue); `email.malformed`;
`clientName.empty` and the other name refusals; `clientCeilings.*Invalid`. Nothing is created and no line is
written for any of them.

#### `PATCH /api/site/clients/:clientId`

`{ "name": string }`. **204**. **404** `client.notFound`; **400** `request.invalid` (a key the contract does not
have, an id that is not one) or `clientName.*`. Renaming a client to the name it has changes and writes nothing.

#### `PUT /api/site/clients/:clientId/ceilings`

`{ "ceilings": { … }, "reason": string }`. **A patch, not a replacement**: a key left out keeps the client's
value and an explicit `null` removes that ceiling, so raising one number cannot silently lift the other
eight. The keys are the nine ceilings of `GET /api/me/limits` (§6) (`periodStartedAt` an ISO-8601 UTC instant); a renewal (a
`periodStartedAt` that moves) resets the counter of events created in the period, and **a lowered
`maxRetentionDays` starts the notice clock** (docs/SECURITY.md §5). **200**, `Cache-Control: no-store`

```json
{
  "ceilings": { "maxEvents": 3, "maxTotalBytes": null, "…": "…" },
  "eventsCreatedInPeriod": 0
}
```

**The reason is mandatory** (decided 2026-10-23). A body without one is **400 `request.invalid`**; a blank or
malformed one is **400 `audit.reasonInvalid`** with `details: { "max": 200 }`, **before the client is read or
anything is written**, even for a patch that would change nothing. A reason is one line of at most 200
characters, trimmed and NFC-normalised, with no control or invisible character and **no `@`**. It is written
to the log as `client.ceilingsChanged { before, after, reason }` — the operator's view shows it, **the client's
owner is not shown it** — and is never echoed back in an error. On the hosted instance only non-financial
reasons are admitted (the size of an event, capacity, abuse: a policy of the operator and not something the
route can check).

**404** `client.notFound`; **400** `clientCeilings.*Invalid` for a value the catalogue refuses (`0`, a retention
outside its bounds). Nothing moves for any of them.

#### `POST /api/site/clients/:clientId/suspend` and `.../resume`

No body. **204**. Suspension is **one column** (`clients.suspended_at`) and one audit line
(`client.suspended` / `client.resumed`, carrying the client id and no detail): no account is disabled, no event
changes status, no photograph is touched, and the ceilings are as they were when it is lifted. Both are
idempotent: freezing a frozen client keeps its first instant and writes no second line, and lifting a client that is
not frozen writes nothing. The line is written before the column, so a failure to record leaves the client as it
was. **404** `client.notFound`. `resume` refuses a client whose engagement has ended (`offboard`) with **409** `client.offboarding`.

What a suspended client is told, per surface (docs/SECURITY.md §22):

| Surface                                                                                                | Answer                                                                                        |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| join by code, guest upload, guest photographs, missions, privacy notice                                | the answer an event that does not exist gets (`404`), whatever the event's status             |
| the wall, its playlist and its live feed; a published photograph by slug; a gallery link and its media | the same `404` as an unknown event or a dead link                                             |
| an open live feed                                                                                      | closed at the next heartbeat, told to retry in 60 s, and answered with the `404` when it does |
| a member of the client, on any event route                                                             | **reads** as before; every **write** is `403 client.suspended`                                |
| a member's moderation feed                                                                             | stays open: members keep their reads, and only an event that is gone ends it                  |
| a malformed photograph id or variant on the media route                                                | the same `404`, answered before the ids are judged                                            |
| an invitation into the client, or a moderator invitation to one of its events                          | `404 invitation.notFound`, to preview and to accept, until the client is resumed              |
| a member creating an event, or attaching one to the client                                             | `403 client.suspended`, under either `EVENT_CREATION` policy                                  |
| an owner approving an operator's invitation or reset request                                           | `403 client.suspended`; a stranger is still told `404`                                        |
| `GET /api/me/limits`                                                                                   | `suspended: true`, so the screen can say so                                                   |

#### `POST /api/site/clients/:clientId/invitations`

`{ "email": string, "role": "owner"|"member", "locale"?: … }`. Invites somebody into the client's **account** —
never into an event (docs/SECURITY.md §20, R1 and R4). **201**, `Cache-Control: no-store`

```json
{
  "invitation": {
    "id": "…",
    "delivery": "mail",
    "expiresAt": "…",
    "pendingApproval": true
  }
}
```

`pendingApproval` is **`true` for a client that has an event, a member or another invitation waiting**: the invitation is written, mailed
and shown as for any other, and **opens nothing until an owner of the client approves it**
(`POST /api/client/invitations/:id/approve`, §6); the invitee cannot tell it from a link that never existed.
It is `false` for a client that holds nothing, which is the one case the operator handles alone: **an empty
client admits exactly one live operator invitation** (the first owner's, which `POST /api/site/clients`
writes), a second to another address waits, and a person re-sent their own link is not a second one. The operator
is read **from storage on this call**, not on the route's word. `link` is in the answer **only where no mail went out**:
a box with no relay, **or a relay that refused this mail**. **404** `client.notFound`; **400** `email.malformed` or `request.invalid`; **429**
`invitation.tooManyForAddress` once an address has had its five an hour.

#### `POST /api/site/clients/:clientId/offboard`

`{ "graceDays": 1..365 }`, whole days, and nothing else. **204**. Ends an engagement: the client's **live events are
closed and its drafts archived** (an event already closed or archived is left as it is, because its album is what the
client may still export), the client is **suspended** as by `suspend`, and its albums are given a **purge date**
`graceDays` from now. The retention sweep that already runs purges every event of a client whose date has passed, and
then finalises the client (docs/SECURITY.md §22): the accounts that were nothing but its own are deleted, the others
are only removed from it, and the client row goes. One audit line, `client.offboarded`, carries the window and how many
events were closed and archived, never which. Idempotent: a client already being offboarded keeps its first date,
whatever the second request asks for, and writes nothing. The purge date is an **upper bound**: an event's own retention, or a ceiling on the client, purges it sooner, and the earliest deadline wins. **400** `client.graceInvalid` outside the range (and
`request.invalid` for a body that is not exactly one number), **404** `client.notFound`. A suspended client
that is offboarding cannot be resumed.

#### `POST /api/site/accounts/:userId/disable` and `.../enable`

No body. **204**. `disable` switches an account off and ends every session it has; `enable` switches it back on, and the
sessions it had **stay ended** (the person signs in again). Both are idempotent and write **one line per client the
account belongs to**, each carrying that client's id (one with no client for an account that belongs to none), so the
owner's own trail says that a member's account was switched off. **403** `account.operatorProtected` for an
operator's account, another one's or the caller's own, which `disable` refuses and no route can switch off; **404**
`user.notFound`.

#### `DELETE /api/site/accounts/:userId`

No body. **204**. Deletes an account for a person's **erasure request** (GDPR). Its memberships, the invitations written
to it, its second factor and the share links it created go with it, and the actor pointer on every audit line it wrote is
set to null by the foreign key, which is the whole erasure on the log's side: the lines stay and nothing on them says who.
One `account.deleted` line per client it belonged to is written first. **What it does not erase**: the address is also in
the account's live sessions (until they expire, seven days at most) and in the invitation and reset links ever written to
it (until the opportunistic expiry sweep removes them). Refused with **403** `account.operatorProtected` (an operator's
account, switched off or not), **409** `account.holdsEvents` (it **owns** an event: hand it over or purge it first),
**409** `account.holdsMedia` (it **wrote** photographs or clips, whose files would stay on disk), **409**
`account.holdsReviews` (it **reviewed** photographs, whose rows name the reviewer and which the schema refuses to leave
with none) and **409** `account.lastClientOwner` (it is the only owner of a client that still has other members or an
event, which would be orphaned: add an owner first, or offboard the client); **404** `user.notFound`, including the
second time.

#### `POST /api/site/accounts/:userId/password-reset`

`{ "locale"?: …, "approvalId"?: string }`. **200**, `Cache-Control: no-store`

| `delivery`        | When                                                                     | What the answer holds                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail`            | the box can mail (either mode)                                           | `expiresAt`. The one-hour link went **to the account's own address and nowhere else**: **no token, no link, no address**                             |
| `pendingApproval` | no relay, `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`, first call   | `approvalId` (an id, not a secret) and `expiresAt`. The request holds no secret anywhere; **another owner of the account's client** is to approve it |
| `link`            | the same box, second call carrying `approvalId`, **after** that approval | `link` and `expiresAt`: the one link this route ever returns, spent once                                                                             |

A box with no relay and the default `OPERATOR_RESET_LINKS=mailOnly` answers **409 `reset.mailerRequired`** and
issues nothing. **409** `reset.mailNotSent` (the relay refused; still no link), `reset.approverUnavailable`
(the account is in no client or in two: whose consent would it be?), `account.disabled`; **404**
`user.notFound`, `reset.requestNotFound` (an `approvalId` that is not this operator's approved request for
this account); **429** `reset.tooManyForAddress` (three an hour to one inbox, however asked for). The
owner's half is `POST /api/client/password-resets/:requestId/approve` (§6).

#### `GET /api/site/client-defaults`

The ceilings a new client is created with when its operator names none: the `NEW_CLIENT_*`
settings of `.env.example`, read once at boot. The console pre-fills the form that provisions a
client with it, so what the form shows is what a form left blank would provision. It is the box's
own configuration and reads no storage: it names no client, no event and no account.

Behind the namespace's gate like everything under `/api/site`: `404 route.notFound` with
`SITE_ADMIN=off`, `401 auth.required`, `403 auth.forbidden` for an account that does not operate the
box, and `403 auth.secondFactorRequired` where a second factor is required and not yet given.

**200**, `Cache-Control: no-store`

```json
{
  "ceilings": {
    "maxEvents": 1,
    "maxEventsPerPeriod": 6,
    "maxTotalBytes": 5000000000,
    "maxEventQuotaBytes": 5000000000,
    "maxRetentionDays": 30,
    "maxLiveDays": 3,
    "clipsAllowed": true
  }
}
```

A number is a ceiling and `null` is none; `clipsAllowed` is `true` unless `NEW_CLIENT_CLIPS_ALLOWED`
says otherwise. A box that set no `NEW_CLIENT_*` answers `null` for the six numbers and `"clipsAllowed": true`,
which is what every client of such a box has. These are seven of
a client's nine ceilings: `liveAllowed` has no default (a new client may open), and the period's
start is the day the client is provisioned.

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

**Every** `429` carries `Retry-After`, in seconds, whichever layer answers it. A limiter that counts
requests says how long until its window turns over. A use case that counts what was done (a guest's
reaction budget, invitations to one address, resets for one inbox) says **the length of its
window**, the longest anyone is asked to wait: the count does not say when the oldest item ages
out, and an upper bound is true. The stream cap below answers `30`. The wait is **also** repeated
as `error.details.retryAfterSeconds` in the body for the stream cap, `429 upload.busy` and the three
use-case refusals (`invitation.tooManyForAddress`, `reset.tooManyForAddress`,
`reaction.rateLimited`), because a client that cannot read response headers can read the body; the
other limiters' bodies carry the header only.

| Endpoint                                                           | Default       | Bucket                     | Code                               |
| ------------------------------------------------------------------ | ------------- | -------------------------- | ---------------------------------- |
| `POST /api/join`                                                   | 20            | client IP                  | `rate.limited`                     |
| `GET /api/join/:code`                                              | 20            | client IP, same as join    | `rate.limited`                     |
| `POST /api/auth/login` †                                           | 10            | client IP                  | `rate.limited`                     |
| `POST /api/auth/password-reset/request` †                          | 10            | client IP, own bucket      | `rate.limited`                     |
| `POST /api/auth/password-reset/confirm`                            | 10            | client IP, own bucket      | `rate.limited`                     |
| `GET /api/invitations/:token`, `POST …/accept`                     | 10            | client IP, own bucket each | `rate.limited`                     |
| `POST /api/auth/login/2fa`, `step-up`, `2fa/enroll`, `2fa/confirm` | 10            | client IP, own bucket each | `rate.limited`                     |
| the same four                                                      | 10 / 15 min   | **account**, failures only | `auth.tooManySecondFactorAttempts` |
| `POST /api/events` (create)                                        | 20 / **hour** | account                    | `event.creationRateLimited`        |
| `POST /api/events/:slug/moderators` (invite)                       | 30 / **hour** | account                    | `rate.limited`                     |
| `POST /api/events/:slug/photos`                                    | 12            | client IP **and** event    | `rate.limited`                     |
| `POST /api/events/:slug/clips`                                     | 12            | client IP **and** event    | `rate.limited`                     |
| `POST /api/events/:slug/photos/:id/reactions`                      | 30            | client IP **and** event    | `reaction.rateLimited`             |
| the five other guest writes ‡                                      | 300           | client IP **and** event    | `rate.limited`                     |
| `GET /api/gallery/:token`, `…/photos`, unlock                      | 120           | client IP                  | `rate.limited`                     |
| `GET /api/gallery-media/…`                                         | 3000          | client IP                  | `rate.limited`                     |
| `POST /api/gallery/:token/unlock`                                  | 10 / 50       | IP / link, per 15 min      | `gallery.tooManyAttempts`          |

‡ **One bucket, five routes**: `PATCH …/photos/:id/caption`, `DELETE …/photos/:id` (a guest taking
their photo back), `DELETE …/photos/:id/reactions/:kind`, `PATCH …/guests/:guestId` (a guest renaming themself) and
`POST …/privacy-notice/acknowledgement` all spend the same allowance, `GUEST_WRITE_RATE_LIMIT_PER_MINUTE`.
The device token costs nothing to get (`POST /api/join` is public), and a caption edit is announced
to every screen that has the wall or a console open, so a guest token is not by itself a reason to
answer. The limiter runs before the token is verified, as the upload and reaction ones do. The
number is a backstop sized for a room, not a tuned figure: a venue shares one address, and what it
legitimately sends is bounded by the upload (12) and join (20) budgets, a few dozen a minute. A
moderator's `DELETE` of the same path is dispatched to §6 first, whatever `es_guest` cookie the
browser also holds, and spends nothing here.

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
mails an hour per address and does not replace it. A browser that has signed in to the account
before presents the `es_device` cookie its last login set and is counted in a bucket of its own,
so a stranger who shares the owner's network no longer delays it; every other limit applies to it
unchanged. See docs/SECURITY.md §5.

The gallery unlock is the one row counted per **quarter hour** and per **failure**: a
successful unlock spends none of that allowance, so a family opening one album on the
morning after is never locked out, and ten wrong passwords from one address — or fifty
against one link, from anywhere — are. Every unlock, right or wrong, also spends one
request of the page budget above, which is what bounds the hash verifications somebody who
knows the password can ask for; a request that budget refuses is not counted as a guess. The archive (`album.zip` under `gallery-media`) is bounded by
concurrency instead, two per client and four for the box, because one request is minutes
of disk reads.

The guest write endpoints (uploads, reactions and the five of the ‡ row) key on IP **and** event on purpose: a whole table of
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
{ "status": "ok", "version": "3.0.0", "uptimeSeconds": 4821 }
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
  "version": "3.0.0",
  "license": "AGPL-3.0-only",
  "sourceUrl": "https://github.com/Irony42/EventSlide/tree/v3.0.0",
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

`allowClips` here is **the host's switch, the client's plan (`clips_allowed`) and the box's capability
together** — it answers
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

### `GET /api/join/:code`

Which event a join code names, **before** the phone commits to it. `POST /api/join` creates a
guest and sets the `es_guest` cookie, so without this lookup the only way to learn which wedding a
printed card belongs to is to join it. Public, like the join: the holder of a printed card has no
credential but the card. The code is normalised exactly as the join's is, so `h7k2-qm` is
`H7K2QM`.

**200**

```json
{
  "slug": "camille-et-sacha",
  "name": "Camille & Sacha",
  "acceptsGuests": true,
  "allowCaptions": true,
  "allowReactions": true
}
```

Everything a guest needs to confirm "yes, this is the wedding I am at", and nothing else: no
owner, quota, count, id, theme or upload limit, and never the code back. `acceptsGuests` is true
whenever this answers at all; it is stated rather than implied, so the page shows its form
because the server said the doors are open. The lookup **creates no guest, sets no cookie and
announces nothing**: looking is not joining (the response sets no `es_guest` cookie). `Cache-Control:
no-store` on **every** answer, because rotating the join code (§6) or opening the event changes
what a code names, and a stored refusal would be as stale as a stored name.

**Errors** — `404 event.notFound` for an unknown code and for an event that is `draft`, `closed`
or `archived`: the answer `POST /api/join` gives, for the reason it gives it (a distinguishable
"not open yet" would let someone enumerate which codes exist). `400 joinCode.wrongLength`,
`400 joinCode.malformed`, `400 request.invalid` (more than 32 characters), `429 rate.limited` with
a `Retry-After`. It spends **the same per-address budget as `POST /api/join`** (§1 "Rate limits"):
looking and joining answer one question, so they get one allowance, and exposing the lookup does
not make codes testable any faster than they were. It also means a client that looks a code up and
then joins spends **two** hits of that budget per guest, which the default (20 a minute for an
address, and a venue is one address) allows for ten guests a minute: size `JOIN_RATE_LIMIT_PER_MINUTE`
for it before a client does.

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
every route here. The host's console is where the reason is shown. A path that cannot be
percent-decoded at all — a link cut in the middle of an escape, `/api/gallery/<token>%E2%80` —
is one more malformed token: the same `404 gallery.notAvailable`, from the gallery's router,
with no lookup behind it. (The page at `/g/<token>%E2%80` is not one of these five routes. It
is the `400 request.invalid` of §1, with the three headers below.)

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
looks exactly like a complete album. The photographs are written one at a time, and a
client that disconnects part-way leaves nothing open on the server. `404 gallery.notAvailable`
otherwise.

---

## 3. Guest

All of these require the `es_guest` cookie, scoped to the event in the path. **A token that names another
event is answered `404 event.notFound`**, exactly as an event that is not there is: a `403` would have told a
guest of any event which slugs exist, drafts and archived events included, where the public wall answers
`404` for all three. The reason (`guest.wrongEvent`) is written to the log and is on no response.

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
invalid token; `404 event.notFound` when the token names another event (see the
introduction of this section); `403 guest.revoked`; `409 event.notAcceptingUploads`; `413 upload.tooLarge` (one file
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

**Errors** — `401 auth.required` / `401 guestToken.*`; `403 guest.revoked`;
`404 event.notFound` (which includes a token for another event).

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

**Errors** — `401 auth.required` / `401 guestToken.*`; `403 guest.revoked`;
`404 event.notFound` (which includes a token for another event).

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
`403 guest.revoked`; `404 event.notFound` (which includes a token for another event);
`429 rate.limited` with a
`Retry-After` (§1 "Rate limits", the guest-write bucket).

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
`403 event.guestSelfDeleteDisabled`, `404 photo.notFound`, `429 rate.limited` with a
`Retry-After` (the guest-write bucket of §1; a moderator's request is dispatched to §6 first and is not
counted in it).

This path is **shared with the moderator endpoint of the same name** in §6. The request
is dispatched on **membership first, then the credential presented**: a session that holds a
moderator-level role in this event is answered as a moderator whatever `es_guest` cookie it
also carries (a host who scanned their own QR code in the browser they moderate from is a
guest of the event for 36 hours, and is still a host), the cookie of another event included.
Otherwise, with an `es_guest` cookie the guest rules above apply, and without one it is
handled as the moderator endpoint — so a caller with neither credential gets
`401 auth.required` from the role check, and a signed-in account with no role here that holds a
guest cookie is a guest.

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
carries it), `429 rate.limited` with a `Retry-After` (the guest-write bucket of §1).

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
`(event, photo, guest, kind)`, so it is not forbidden, it is simply not there;
`429 rate.limited` with a `Retry-After` (the guest-write bucket of §1, not the reaction one).

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

### `PATCH /api/events/:slug/guests/:guestId`

A guest changing the name their photos are signed with. **Their own, and nobody else's**:
`:guestId` must be the guest the `es_guest` token names. The name is projected in front of a room,
so being able to edit another guest's would be a way to put words under somebody else's photo.

```json
{ "displayName": "Léa D." }
```

`displayName` is **required and nullable**, as the caption is: `null` or a blank string takes the
name off the wall, and `{}` is a `400 request.invalid`, because "leave it as it was" is not an
intent this endpoint has. A name follows the join's rules: one line, invisible characters
removed, at most 40 characters once folded. The boundary's own bound is 120, so a name of 41 to
120 characters is `400 displayName.tooLong` (with `details.max`) and one longer is
`400 request.invalid`.

**200**

```json
{ "guestId": "…", "displayName": "Léa D." }
```

`displayName` is the name **as stored**, trimmed and folded: what the wall will print, `null` for
no name. `Cache-Control: no-store`. A rename announces nothing, so a wall or a console that is
already open shows the new name when it next reloads what it shows, not at once. The event's lifecycle is deliberately not consulted: a guest at
a closed party may still correct the spelling of their own name on an album that is still being
viewed.

**Errors** — `403 auth.forbidden` when `:guestId` is not the guest the token names, **and equally
for an id that names nobody**: the comparison is made before any row is read, so the route cannot
be used to learn which guest ids exist. `403 guest.revoked`,
`401 auth.required` / `401 guestToken.*` (a host's or moderator's session is not a guest token, and
there is no host route that renames a guest), `404 event.notFound`, `400 request.invalid`,
`400 displayName.tooLong`, `429 rate.limited` with a `Retry-After` (the guest-write bucket of §1).

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

Each photograph is archived as its stored original (`.jpg`) and each clip as its transcode
(`.mp4`, the transcode: a clip's upload is never kept), the same file the shared gallery's own archive carries; a row whose
file is gone is skipped with a warning rather than aborting the download.

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
an album they do not actually hold. The photographs are written one at a time, and a host
who closes the tab part-way leaves nothing open on the server.

---

## 5. Authentication

Six of these thirteen take no principal, and each for its own reason: a login is where a
principal comes from, a logout can only ever destroy the one it was handed — answering
401 to a client whose session has just expired would leave the stale cookie in the
browser — and `/auth/me` exists to answer whether there is a principal at all. Stated
here so that an absent authorization middleware in `routes/authRoutes.ts` is a
documented decision rather than an omission a reader has to judge. The two password-reset
routes take none for the reason a login does: the person asking has lost the credential. The two
invitation routes (below) take none because the link is the credential.

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

A completed login also sets **`es_device`**: `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS,
`Path=/api/auth`, `Max-Age` 90 days, renewed by every login (and by a password change, below) and
left alone by a logout. It holds an opaque device id, the account id and the
instant, signed; no e-mail address. A login that presents a valid one for the address being tried
is counted in a bucket of its own, per account and device, in place of the network's; one that
is missing, forged, expired, issued for another address or older than the account's last change
of credentials is ignored and answered exactly as a login with no cookie. It grants nothing and
skips no step. See docs/SECURITY.md §5.

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
client must read the CSRF cookie again — and the caller stays signed in. The response also sets a fresh
`es_device` (the sign-in throttle's trusted-device cookie, `POST /api/auth/login`), because the request
has just proved the current password; the previous one is older than the change and no longer counts.
**Errors** — `401 auth.invalidCredentials`, `400 password.*`,
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
and the CSRF codes like every write. Responses are `Cache-Control: no-store`.

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

### Invitations (roadmap §10.3, G2-09 / P3-10)

Two public routes: the link is the credential, so neither takes a principal to authorize. The token
is the last segment of `/invite/<token>`, 256 random bits; the box stores only its SHA-256. A token
that is unknown, malformed, already used, replaced by a newer link, expired, waiting for an
approval, or for an event or client that is gone is **always the same `404 invitation.notFound`**.
Responses are `Cache-Control: no-store`. Each route has a rate-limit bucket of its own (§1).

| Method | Path                             | Principal                                                            |
| ------ | -------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/api/invitations/:token`        | none: the link is the credential                                     |
| `POST` | `/api/invitations/:token/accept` | none to choose a password; the signed-in account whose address it is |

### `GET /api/invitations/:token`

What the link offers, for the page that asks its holder to accept it. **200**

```json
{
  "kind": "event",
  "role": "moderator",
  "targetName": "Camille & Sacha",
  "expiresAt": "2026-06-27T21:00:00.000Z"
}
```

`kind` is `event` (role `moderator`) or `client` (role `owner` or `member`). **Nothing else**: not who
invited, not the address, and not whether the address already has an account — the person holding
a link may be the one who wrote it, and a preview that said "sign in" for some addresses and
"choose a password" for others would be an oracle for who is on the box. It spends nothing, so
a mail client that fetches links to preview them cannot use one up.

On a box that asks for its terms of use (`LEGAL_TERMS_URL` **and** `LEGAL_TERMS_VERSION` both set,
G2-20) the answer has one more key, **present only then**, so a self-hosted box answers the four above
byte for byte:

```json
{ "terms": { "url": "https://hosted.example.org/legal/cgu", "version": "2027-01" } }
```

`url` is an https address or a path on this site. It is the same for every link on the box, so it says
nothing about this one, and a dead link answers the same `404` it always did. **Errors** —
`404 invitation.notFound`, `409 event.immutable` (the event was archived), `429 rate.limited`.

### `POST /api/invitations/:token/accept`

Two forms, one route.

**A person choosing how to sign in**, for an address that has no account:

```json
{ "password": "…", "displayName": "Camille" }
```

Creates the account **at the address the link was written to** (never one from the request), with
the password and name chosen, no authority over the box, and nothing to change on first sign-in;
grants the role; spends the link; and **signs the new account in** with a fresh session (the same
session and CSRF token a login gets). The account's address is marked verified only if the link
came by mail. The password is judged — and a refusal costs nothing, the same link still works —
before the address is looked at.

**The account the link was written to, already signed in**, with an empty body:

```json
{}
```

Attaches that account (from the **session**, never from the request) and spends the link. Its
password, name and authority on the box are not touched, and a role it already holds there is not
lowered.

**The terms of use (G2-20).** Either body may carry `"acceptTerms": true`, the tick of "I accept the
terms of use". It is a boolean and the only key besides the credentials: **no key can name a version**,
because the version recorded is the box's own. It is read only on a box that asks for terms (the
preview above says so): there, anything but `true` is `400 terms.notAccepted`, a form error and
not a dead link; it is judged right after the link is found and before anything about who is accepting,
so it is the same `400` for an address that has an account as for one that has none, and a dead link
is the same `404` with or without it. Nothing is created and nothing is spent by that refusal. When the
acceptance goes through, the audit entry `account.termsAccepted {version}` is written in the same
transaction, as the account that accepted and filed under the invitation's client (or the client that
owns its event), for an existing account's acceptance as for a new one's. On a box that asks for no
terms the key is accepted and ignored, nothing is recorded, and nothing is refused for want of it.

**200**, both forms

```json
{
  "status": "accepted",
  "kind": "event",
  "role": "moderator",
  "targetName": "Camille & Sacha",
  "eventSlug": "camille-et-sacha"
}
```

`eventSlug` is `null` for a client. The answer carries neither the address nor an account id.

**Errors** — `404 invitation.notFound`; `409 invitation.signInRequired` when the address already
has an account and a password was sent: **nothing is created and the link is not spent**, the
person signs in as that account and accepts with the empty body; `403 invitation.wrongAccount`
when the signed-in account is not the one the link was written to; `400 invitation.credentialsRequired`
when the empty body is sent with no session; `400 terms.notAccepted` on a box that asks for its terms,
without the tick; `400 password.*` and `400 accountName.*` for a
password or a name the rules refuse; `400 request.invalid` (an unknown key — no field can name an
account); `409 event.immutable`; `429 rate.limited`; `403 auth.passwordChangeRequired` for a signed-in account that must
first choose a password (§1); and the CSRF codes. A path whose token cannot be decoded
(`/api/invitations/%`) is a `404 invitation.notFound` like any other dead link.

> **Who learns that an address has an account.** Only the holder of a link, and only by sending a
> name and a password the policy accepts, and then not without creating the account when it is free.
> The invitee needs the answer; a link that came by mail is theirs alone. Where the host was handed
> the link (a box with no relay) the host holds it too, and can accept it first: that creates an
> account with a password the host chose, never marked verified (docs/SECURITY.md, "Invitations").

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
second factor. **200** is the same body as the login's, and the response sets `es_device` (see
`POST /api/auth/login`): the sign-in is complete only here, so the password step sets none. The cookie
is a key for the sign-in throttle and skips nothing: the next login from that browser asks for the
password and the code again.

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
as having confirmed the person at the keyboard. Two routes of the account ask for it — `2fa/recovery-codes` and
`2fa/disable`, below — and **so does every route of `/api/site` that changes something** (G2-14, §1), and each
answers **403 `auth.stepUpRequired`** without a fresh stamp. **204**. The code must be of a step **later than
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
| `POST`   | `/api/events/:slug/moderators`             | owner     | 201 | Invite **by link**; `{ "email" }`, no password |
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
| `invitation.tooManyForAddress` | 429    | An address already written to five times in the last hour, by anybody                                                               |
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

On a box that sets `clientMembers`, an account can create an event once it belongs to a client: the operator
opens one (`POST /api/site/clients`, §1) and its owner accepts the invitation; the operator itself is exempt.

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

**`quotaBytes` is the quota the event's uploads are judged against**, not the number it was created
with (G2-16): the stored quota, lowered to the client's `max_event_quota_bytes` when that is smaller, as
`Event.effectiveQuotaBytes` computes it for every write path. An operator can lower the ceiling after an
event was created, and a meter drawn against the stored number would promise room the box refuses. For an
event with no client — every event on a box without clients — it is the stored quota exactly as before.
`liveWindowEnd` (an ISO-8601 instant) is the end of the event's live window, `opened_at + max_live_days`;
it is **absent**, not `null`, when there is none to announce (no client, no `max_live_days`, an event that
has never opened), so a box without clients answers byte for byte as it did.

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
old token names a different event id and still gets `404 event.notFound`.

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
{ "email": "lea@example.test", "locale": "fr" }
```

An **invitation by link** (roadmap §10.3). `locale` is optional (`fr`, `en`, `de`, `es`, `it`;
default `fr`): the language of the host's page, and the language the invitation is written in.
Unknown keys are refused, which is how a client written for 2.x learns what changed (below).

It creates **no account and no role**. It writes a single-use link that lives **seven days**,
and either mails it to the address (when the box has a mail relay, `SMTP_URL`) or hands it back to
the host to pass on (when it has none, or the relay refused). The person makes their account —
or, if the address already has one, signs in — and accepts it (`/api/invitations/:token`,
below). Only then does a membership exist.

**201**, `Cache-Control: no-store`

```json
{ "status": "invited", "expiresAt": "2026-06-27T21:00:00.000Z" }
```

`link` is present **only** when no mail went out:

```json
{
  "status": "invited",
  "expiresAt": "2026-06-27T21:00:00.000Z",
  "link": "https://photos.example.org/invite/AbC…"
}
```

Whether it is there depends on the box and its relay and never on the address: **the answer is the
same for an address that has an account and one that has not**, and nothing in it says which.
Re-inviting an address to the same event revokes the earlier link, so a lost one can be replaced.

A host may write thirty invitations an hour, to any addresses (`429 rate.limited`, per account: another host is not
affected).

**Errors** — `409 membership.alreadyExists` (the address is already a member of this event: the host
can read that list), `429 invitation.tooManyForAddress` (an address is written to at most five
times an hour, by anybody), `400 email.malformed`, `400 email.containsWhitespace`,
`400 email.empty`, `400 request.invalid` (an unknown key, or a locale that is not one),
`409 event.immutable` (an archived event).

#### What changed in 3.0

The 2.x request carried `displayName` and a required `temporaryPassword`, and the response was
`{ "userId": "…", "created": true }`: the box made the account, with the password the host typed
and read out, and answered whether the address was already on the box. **A script written for 2.x
now gets `400 request.invalid`** for either field, and the response has none of the three. See
`docs/UPGRADING.md`, "Upgrading to 3.0".

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

Only photos that are on the wall are ranked, and `limit` counts those: a photo the host has since
hidden or rejected keeps its reactions but neither takes a place nor uses one up, so the panel
asked for three answers the three best photos on the wall (fewer when fewer have reactions).

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

### `POST /api/client/invitations/:invitationId/approve`

An owner of a client lets an operator's invitation into that client in (the operator guard's R1,
docs/SECURITY.md §20). **Only with `SITE_ADMIN=on`**: off, the whole `/api/client` space is unmounted and
every path in it is `404 route.notFound`, status, body and headers exactly as for a path nobody wrote.

An operator's invitation into a client **that has an event or a member** is written as waiting (`pendingApproval`),
and opens nothing, as a link or a mail, until an owner of that client approves it here. Approving
records who approved and when and does nothing else: the link is not spent and no account is created,
so the invitee still has to open it and accept.

- **Auth:** a signed-in, enabled account (`401 auth.required` otherwise) that is an **owner of the
  invitation's client** and **does not operate the box**. The caller is the session's; the request names
  no actor, and a body is ignored.
- **Request:** no body. `:invitationId` is the id the operator's invitation answered with, a UUID shape
  (`400 request.invalid` otherwise). It is an id and not a secret: it opens nothing by itself.
- **Response:** `204`, also when the invitation was already approved (nothing changes and nothing is
  written). The line `invitation.approved` is written to the audit log before the approval is recorded.

| Code                  | Status | When                                                                                                                                                                                                                                                                 |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.forbidden`      | 403    | A member of the client who is not an owner; **an operator**, whether or not the client made them an owner. `details.required: "owner"`                                                                                                                               |
| `invitation.notFound` | 404    | An unknown id; another client's invitation; an invitation to an event, or one that never waited for anyone; a password-reset link; one already spent, revoked or expired; and a caller with no part in the client (an operator included). One answer for all of them |

### `POST /api/client/password-resets/:requestId/approve`

**Another** owner of an account's client lets an operator be handed that account's password-reset link (the
operator guard's R2, docs/SECURITY.md §20). **Only with `SITE_ADMIN=on`**, like the rest of `/api/client`, and
only meaningful on a box with no mail relay and `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`: the request
is the `approvalId` that `POST /api/site/accounts/:userId/password-reset` (§1) answered, and the operator tells
the owner the id by whatever channel they already use. It is an id and not a secret.

Approving hands nobody a link. It records who approved and when, which makes the request redeemable **once, by
the operator who made it**, who is then given a link that did not exist until that moment.

- **Auth:** a signed-in, enabled account (`401 auth.required` otherwise) that is an **owner of the account's
  client**, **does not operate the box** and **is not the account being reset**. The caller is the session's.
- **Request:** no body. `:requestId` is a UUID shape (`400 request.invalid` otherwise).
- **Response:** **204**, also for a request already approved (nothing changes, nothing is written). The line
  `account.resetApproved` is written before the approval is recorded.

| Code                    | Status | When                                                                                                                                                                                                                                               |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.forbidden`        | 403    | A member of the client who is not an owner; **an operator**, whether or not the client made them an owner; the account the reset is for. `details.required: "owner"`                                                                               |
| `reset.requestNotFound` | 404    | An unknown id; an invitation's; a request already spent, revoked or expired; a request for an account of **another client**, of **none** or of **two**; and a caller with no part in the client (an operator included). One answer for all of them |

### `GET /api/me/limits`

What the signed-in account reads of its own clients' ceilings and use (roadmap §10.5, G2-16 / P3-17): what
the operator allows, what has been used against it, and how close that is. **Only with `SITE_ADMIN=on`**:
off, the route is unmounted and answers `404 route.notFound`, status, body and headers exactly as for a path
nobody wrote.

- **Auth:** a signed-in, enabled account (`401 auth.required` otherwise). **Whose limits they are is never
  the request's to say**: the route takes no parameter (`400 request.invalid` for any), and the answer is
  the caller's own memberships and nobody else's.
- **Response:** `200`, `Cache-Control: no-store`.

```json
{
  "clients": [
    {
      "id": "6f1c…",
      "name": "Atelier Alpha",
      "role": "owner",
      "suspended": false,
      "ceilings": {
        "maxEvents": 5,
        "maxTotalBytes": 5000000000,
        "maxEventQuotaBytes": null,
        "maxRetentionDays": 30,
        "clipsAllowed": true,
        "liveAllowed": true,
        "maxLiveDays": 3,
        "maxEventsPerPeriod": 6,
        "periodStartedAt": "2026-01-01T00:00:00.000Z"
      },
      "usage": { "events": 4, "eventsCreatedInPeriod": 4, "usedBytes": 4600000000 },
      "meters": [
        { "kind": "events", "used": 4, "max": 5, "level": "warning" },
        { "kind": "eventsPerPeriod", "used": 4, "max": 6, "level": "ok" },
        { "kind": "storage", "used": 4600000000, "max": 5000000000, "level": "warning" }
      ]
    }
  ]
}
```

`null` is "no ceiling". `clients` is empty, `200`, for an account in no client (the box's operator
included). `usage.events` counts events in every status; `usedBytes` is the admission figure the byte
ceiling is judged against (photographs of every status and the staged source of each clip). A `meters`
entry exists only for a ceiling that has a bound, and its `level` is decided once, by the server:
`ok` below 90 per cent, `warning` from 90 per cent up to the ceiling, `reached` at or past it (past it
is possible: lowering a ceiling never deletes anything). The banner and the client space page show
exactly this and compute nothing.

```
GET /api/me/limits?clientId=… → 400 request.invalid   (no parameter exists to name another client with)
```

### `GET /api/client/audit`

The log of what was done on the owner's own client (roadmap §10.8, rule R5 of the operator guard, G2-16 /
P3-17): **every** entry that carries the client's id — the operator's, an integration's, the system's and the
client's own members' — newest first. Account-level lines written with no client (an operator switching an
account off, a member's own second-factor lines) are not among them yet: docs/SECURITY.md §21. **Only with `SITE_ADMIN=on`**; off, `404 route.notFound` as for a path
nobody wrote.

- **Auth:** a signed-in, enabled account that is an **owner** of the client. `403 client.ownerRequired` for
  a member who is not an owner; `404 client.notFound` for an account with no part in the client.
- **Query (strict; any other key is `400 request.invalid`):** `clientId` (a UUID; needed only by an account
  in **several** clients, who gets `404 client.notFound` without it, as for `POST /api/events`; naming a
  client the caller is not in is the same `404` as naming one that does not exist), `before` (the `next` of
  the previous page, an integer ≥ 1), `limit` (1 to 100, default 50).
- **Response:** `200`, `Cache-Control: no-store`.

```json
{
  "items": [
    {
      "seq": 41,
      "at": "2026-06-21T10:00:00.000Z",
      "action": "invitation.issued",
      "actor": { "kind": "operator", "label": null },
      "subject": { "type": "invitation", "id": "9b2e…" },
      "details": { "pendingApproval": true }
    }
  ],
  "next": 40
}
```

`next` is the `before` for the page after this one, `null` on the last. `action` is the server's
vocabulary (`src/domain/audit/auditAction.ts`); a row written under a name a client does not know is shown
as "an action was recorded", never hidden. **What a line never carries**: the account behind the actor (the
operator is "the operator", a member is "a member", never an id), the id of an **account** subject, an
address, a slug, a join code, a name, a token or a link. `details` is what the action's allow-list admits,
numbers, switches and instants (a ceilings change is `{ before, after }` snapshots). The one string
the log holds besides an instant is the version of the terms in `account.termsAccepted` (G2-20), and
**this door does not pass it**: an owner reads that a person accepted the terms, with `details` empty, and the
version stays in the log. `actor.label` is
present only for an integration (`cloud:stripe-webhook`), a constant a programmer chose.

| Code                   | Status | When                                                                                |
| ---------------------- | ------ | ----------------------------------------------------------------------------------- |
| `client.ownerRequired` | 403    | A member of the client who is not an owner                                          |
| `client.notFound`      | 404    | No part in the client; a client that does not exist; several clients and none named |

### `GET /api/client/invitations`

What waits for the owner's approval (rule R1 of the operator guard): the operator's invitations into the
client that cannot be used until an owner lets them in, and **whom they are for** — the one fact the approve
route's answer withholds. **Only with `SITE_ADMIN=on`**; off, `404 route.notFound`.

- **Auth, query, errors:** as `GET /api/client/audit` (an owner; `clientId` only for an account in several
  clients; no other key). The list is scoped by the client in the query itself: another client's invitation
  is not a row this call can return.
- **Response:** `200`, `Cache-Control: no-store`.

```json
{
  "items": [
    {
      "id": "9b2e…",
      "email": "nouveau@example.org",
      "role": "member",
      "createdAt": "2026-06-20T09:00:00.000Z",
      "expiresAt": "2026-06-27T09:00:00.000Z"
    }
  ]
}
```

Newest first, at most 50, only invitations still waiting (not approved, spent, revoked or expired). The
address is the invitee's, shown to the owners of the account the invitee would join, and appears nowhere
in the audit log. No link, no digest and no operator account is in an item; `id` is what
`POST /api/client/invitations/:invitationId/approve` takes.

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
| Streams open at once per client key     | 12    | `429 rate.limited`, `Retry-After: 30`     |
| Streams open at once across the process | 500   | `503 service.notReady`, `Retry-After: 30` |
| Subscribers per event, in the bus       | 200   | `503 service.notReady`, `Retry-After`     |

An open wall stream is checked again at **every heartbeat** (15 s) with the question that
opened it: an event the host has since **archived**, or whose client has been suspended, ends
the stream with a `retry:` of a minute, and frees its slot. A closed event still serves its
wall, so closing one ends nothing. The moderation stream asks only that the event still exists
and the account still holds a role in it.

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
> do what a reader would expect.
>
> If you are an agent or an integrator: §1–8 is what you may rely on. Treat anything you
> find only in §9 as a bug report, not as a specification.
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
way**. Nothing here is a missing endpoint. The audit found ten divergences; six have
since been fixed and removed, and these four are the places where the code and the intent
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
