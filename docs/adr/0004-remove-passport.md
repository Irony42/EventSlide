# ADR 0004 — Remove Passport; introduce guest device tokens

## Status

Accepted. Supersedes the 1.0 authentication stack in `src/passport.ts`.

2.0 is a rewrite in progress: the paths below are the target layout of CLAUDE.md §4.
Anything not yet on disk is marked _(planned)_.

## Date

2026-09-09

## Context

1.0 authentication is `passport@^0.6.0` + `passport-local@1.0.0` wired in
`src/passport.ts` and `src/index.ts`. Four concrete problems, all verifiable in that
code:

| Problem                                                    | Where                                                                                                                                    | Effect                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Strategy reads the mutable `db` singleton                  | `src/passport.ts` (`db.get<User>` inside `LocalStrategy`)                                                                                | Credential checking cannot run without `initDatabase()` having assigned `db` first. Ring-2 testing is impossible.             |
| `serializeUser` / `deserializeUser` hit the same singleton | `src/passport.ts` (`SELECT * FROM users WHERE id = ?`)                                                                                   | Every authenticated request does an untyped `SELECT *` and puts the whole row — including the bcrypt hash — on `req.user`.    |
| Two login paths with different contracts                   | `POST /login` (`failureRedirect`, then `res.redirect('/admin')`) and `POST /api/login` (custom callback + `req.logIn`) in `src/index.ts` | Two authorization guards (`isAuthenticated` redirects, `isAuthenticatedApi` returns 401) and two failure shapes for one rule. |
| Session id never regenerated                               | `req.logIn` is called without `req.session.regenerate`                                                                                   | Session fixation: a pre-login id handed to a victim stays valid after they authenticate.                                      |

Guests had no identity at all. `POST /api/upload` and `POST /upload` are registered
with no guard, and the target event comes from `req.query.partyname`
(`parsePartyName` in `src/pictureStorage.ts`) — any string matching
`/^[a-zA-Z0-9_-]{1,64}$/` creates `photos/<name>/` and `thumbnails/<name>/` on the
first request. Uploads are therefore unattributable, unrevocable, and impossible to
rate-limit per uploader. Passport is irrelevant to that half of the product: it has no
notion of an anonymous but identified principal.

Additional 1.0 facts this ADR must not preserve: bcrypt cost 10
(`src/routes/user.ts`), and a default `admin` / `password` row re-inserted on every
boot (`src/database.ts`).

## Decision

**Delete Passport.** Remove `src/passport.ts`, the `passport` / `passport-local` /
`@types/passport` / `@types/passport-local` dependencies, and every
`req.isAuthenticated()` / `req.user` read in `src/index.ts` and `src/routes/user.ts`.

Two principals replace it, each with its own mechanism.

### Host / moderator: a use case behind a port

```ts
// src/application/usecases/auth/authenticateUser.ts  (planned)
export interface AuthenticateUserDeps {
  readonly users: UserRepository // src/application/ports/userRepository.ts
  readonly hasher: PasswordHasher // src/application/ports/passwordHasher.ts
  readonly clock: Clock
}
export type AuthenticateUser = (input: {
  email: string
  password: string
}) => Promise<Result<Principal, DomainError>>
```

- `PasswordHasher` has two methods, `hash` and `verify`. `BcryptPasswordHasher`
  (`src/infrastructure/crypto/`) is the only place a bcrypt cost exists; it is 12, not
  1.0's 10.
- The controller in `src/interface/http/routes/authRoutes.ts` _(planned)_ is the only
  login path. It parses with zod, calls `authenticateUser`, then on success
  `req.session.regenerate(...)` and stores a **minimal principal** — `{ userId, roles:
Record<EventId, Role> }` — never the user row and never the hash.
- Failure returns `{ error: { code: 'auth.invalidCredentials' } }` with 401 for both a
  missing user and a wrong password; no redirect variant exists. Per-route
  authorization is `requireRole('owner' | 'moderator')`, which resolves the event from
  `:eventSlug` and checks membership **of that event**.
- Sessions live in `express-session` with the SQLite store, so the 1.0 MemoryStore
  leak and restart amnesia are gone. That store is its own decision; see `docs/adr/`.

### Guest: an HMAC-signed, event-scoped device token

Issued by `joinEvent` _(planned,_ `src/application/usecases/guests/joinEvent.ts`_)_
when a valid join code is presented, signed through a `TokenService` port implemented
by `src/infrastructure/crypto/hmacGuestTokenService.ts`.

| Property  | Value                                                                     | Why                                                                                                                                          |
| --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload   | `{ v, eventId, guestId, issuedAt }`, base64url                            | No claims beyond what the two rights below need.                                                                                             |
| Signature | HMAC-SHA256 over the payload, key from `src/infrastructure/config/env.ts` | Stateless verification; the key is the only secret, and only `env.ts` reads it.                                                              |
| Transport | Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`      | `HttpOnly` keeps it away from XSS; `Lax` survives the QR-code navigation that a `Strict` cookie would drop.                                  |
| Grant 1   | Upload to the `eventId` in the payload, and nothing else                  | `requireGuest()` compares the token's `eventId` to the event resolved from the path. A token for event A on event B is 403.                  |
| Grant 2   | Delete a photo whose `guestId` matches, inside a grace window             | `requireGuestOwnsPhoto()`; the window itself is a domain rule in `src/domain/photos/`, derived from event settings, not from the middleware. |

The token confers no read of the moderation queue, no publish, and no cross-event
capability. Revocation is by `guestId` in the `guests` table (an event-scoped row), so
a host can cut off one device without rotating the signing key or the join code.

Two named security tests hold this in place, per
`.claude/skills/eventslide-testing/`: _session id changes on login_ and _a guest token
grants upload to exactly one event and nothing else_, both at ring 4.

## Consequences

### Positive

- `authenticateUser` is a ring-2 test with `FakePasswordHasher` and
  `FakeUserRepository`: sub-millisecond, no Express, no SQLite file, no bcrypt cost.
  In 1.0 the same assertion needed a booted app and a real database.
- One login path, one failure shape, one guard family. `isAuthenticated` versus
  `isAuthenticatedApi` disappears with the duplicated legacy HTML routes.
- Guest uploads become attributable (`photos.guest_id`), revocable (`guests` row), and
  rate-limitable per device rather than only per IP — which matters when 80 phones sit
  behind one venue NAT.
- The session holds a minimal principal, so no password hash is ever deserialised onto
  a request object.

### Negative

- We own the session and token plumbing: roughly 150 lines across `authRoutes.ts`,
  `middleware/authn.ts`, `middleware/authz.ts`, and `hmacTokenService.ts`. It needs
  careful review — constant-time signature comparison, payload version handling, and
  cookie flags are the kind of code that fails silently.
- We lose Passport's ready-made strategies. If a future version wants Google sign-in
  for hosts, we write an OIDC flow by hand or re-introduce a dependency for that
  purpose only. Accepted: 2.0 has no OAuth requirement, and the port seam means the
  flow would land in `src/infrastructure/` without touching use cases.
- Anyone who knows Passport must now read our code instead of its docs.

### Neutral

- bcrypt stays; only the cost (12) and its location (one adapter) change.
- `express-session` stays. The decision removes Passport, not sessions.
- Existing 1.0 password hashes are `$2b$10$`; they verify fine under bcrypt and are
  re-hashed at cost 12 on next successful login _(planned)_.

## Alternatives considered

### Keep Passport and wrap it in a port

Rejected: the untestable seam is the problem, not the strategy. Wrapping still leaves
`serializeUser` / `deserializeUser` inside the request lifecycle, so the port would
have to be exercised through a live Express app — exactly the cost we are removing. The
wrapper would also be about as much code as the direct implementation, plus the
dependency.

### JWTs for hosts

Rejected: no server-side revocation. The projector surface (`/e/:slug/display`) is
signed in for eight hours; a host who fires a moderator mid-event must invalidate that
access immediately, and with a stateless bearer token the only options are a very
short expiry (re-login during the event — unacceptable on a projector) or a
server-side denylist, which is a session table with extra steps.

### Give guests accounts

Rejected on product grounds. The guest non-negotiable is "no account, no app, one
thumb, bad venue Wi-Fi" (CLAUDE.md §1). A signup form between the QR code and the
first photo kills the upload rate the product exists to create.

### Unsigned random cookie for guests, looked up in `guests`

Rejected as strictly worse than HMAC for the same effort: it costs a database read on
every upload attempt, including forged ones, which turns a cheap 403 into a
denial-of-service lever on the public endpoint. HMAC rejects a bad token before any
I/O, and `guestId` is still checked against the `guests` row for revocation on the
requests that pass.
