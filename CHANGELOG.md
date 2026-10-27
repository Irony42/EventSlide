# Changelog

What changed in each tagged release, newest first. This file is written by hand until
releases are automated: the pull request that prepares a release writes its entry, and the
pull requests before it do not touch this file. The entries of 2.0.0 and 2.1.0 were written
after those releases were published, from their release notes, and are dated by the commit
each release was cut on.

Versions are tagged `vX.Y.Z` and mean what [docs/UPGRADING.md](docs/UPGRADING.md) says they
mean: a patch fixes, a minor adds, and only a major breaks something. The tag `gpl-final` is
not a version: it marks the last commit published under the GPL (see
[docs/LICENSING-FAQ.md](docs/LICENSING-FAQ.md)).

In an entry:

- `### BREAKING` lists what stops working and what to change. It is in a major and in no
  other release, and every major has one.
- `### Behaviour changes to check before upgrading` lists what an existing installation will
  notice without being broken by it: a migration (by number), a new limit that is off unless
  you set it, a new warning at boot, a default that is opt-in for now.
- `### Deprecated` lists what a later major will remove.

## [3.0.0] - 2026-10-02

Everything merged to `main` after 2.1.0: pull request #104 on, and three older ones that were
merged after it (#52, #93 and #94), plus this release's own preparation. The work before it
is in the 2.1.0 entry, the last release under the GPL-3.0. This is a major release: it changes
the licence, and it breaks things for an existing installation, which `### BREAKING` lists.
[docs/UPGRADING.md](docs/UPGRADING.md#upgrading-to-30) says in which order to do what.

### Licence

- **EventSlide is now licensed under AGPL-3.0-only**, where it was GPL-3.0 (#110).
  3.0.0 is the first release under it. `LICENSE` is the Free Software Foundation's text,
  unmodified. `package.json`, the lockfile root and the image's
  `org.opencontainers.image.licenses` label all say `AGPL-3.0-only`. A new `NOTICE` carries the
  copyright line and names sharp, libvips and ffmpeg as components that stay under their own
  licences.
- **Nothing published before stays anything but GPL-3.0.** Every commit up to and including
  `5c2607380ebb18045a14cae979bb54e6fa2def76` stays available under the GPL-3.0 for good: the
  GPL's grant is irrevocable. That commit is the one the release 2.1.0 and the tag `gpl-final`
  were cut on, so 2.1.0 is the last release under the GPL-3.0 and `gpl-final` the last commit.
  It is named in `.github/gpl-boundary`. A CI job, `licenseHistory`, checks that every commit
  after it on the first-parent line of `main` carries the AGPL text.
- **What it asks of you.** Running EventSlide unmodified asks nothing more than the GPL did.
  If you modify it and let other people use your version over a network, AGPL section 13
  asks you to offer them its source. [docs/LICENSING-FAQ.md](docs/LICENSING-FAQ.md) answers
  this for someone who runs it unmodified, modifies it, or forks it.
- **Dependency licences are audited, and the bundle carries its notices** (#122). A test refuses
  any locked dependency whose licence is outside a permissive allow-list (MIT, MIT-0, ISC,
  BSD, 0BSD, Apache-2.0, BlueOak-1.0.0), unless a named exception with its reason covers it:
  sharp's libvips builds, and a few development tools. The build writes
  `third-party-licenses.txt` beside the bundle, with the licence files of the libraries the
  JavaScript contains, and `/about` links it.
- **The source offer** (#114). `GET /api/about`, a "Source code (AGPL-3.0)" link on the guest
  and host screens (translated into the interface language; the projected wall carries none),
  a `/about` page, and two settings, `SOURCE_CODE_URL` and `SOURCE_REF`. Left unset, the link
  points at the tag of the running version, `https://github.com/Irony42/EventSlide/tree/v3.0.0`
  for this release. That is the source of exactly your build only when you run an unmodified
  copy of the tagged release: anything else (a modified build, a fork, a commit no tag names)
  must set `SOURCE_CODE_URL`. No setting hides the link. The version is now read from
  `package.json` alone, so `/api/health`, `/api/about` and the backup manifest cannot
  disagree.

### BREAKING

Read these before you upgrade, and back up with the version you run now.

- **`.env` now reaches the container** (`env_file`, optional, which needs Docker Compose 2.24
  or later) (#109). Until now Compose used `.env` only to fill the `${VAR}` references in
  `compose.yaml`, so a setting that the file does not name under `environment:` (upload
  limits, rate limits, clip limits, and so on) never reached the container, even though
  `.env.example` told you to set it there. Every key in `.env` reaches it now, and a value
  that was silently ignored takes effect. A line copied from `.env.example` can do harm:
  `DATABASE_PATH=./data/eventslide.sqlite` and `MEDIA_ROOT=./media` override the image's
  `/data` paths and point the server away from your volume, and `PORT` is both the host port
  `compose.yaml` publishes (`${PORT:-4300}:4300`) and the port the server now listens on inside, so
  a `PORT=8080` that only meant "publish on 8080" leaves the mapping pointing at a port nothing
  listens on. Read your `.env` before you pull, and remove what you did not mean to apply.
- **New settings are checked at boot, and a value that does not fit stops it** (exit 78,
  naming the variable) (#105, #109, #114, #117, #118, #119, #120, #121, #123, #130, #145, #148, #159). If your
  environment or `.env` already sets one of these names for another purpose, change or remove
  it before you upgrade. An empty value counts as not set, except where a line below says it stops
  the boot.
  - `SUPPORT_URL`, `REPORT_URL`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL` and
    `LEGAL_NOTICE_URL` take an `https` URL without credentials, or a path starting with one
    `/`.
  - `LEGAL_TERMS_VERSION` takes at most 32 characters of letters, digits, `.`, `_` and `-`,
    starting with a letter or a digit (such as `2027-01`).
  - `SOURCE_CODE_URL`, `DONATION_URL` and `BUDGET_URL` take an `https` URL without
    credentials.
  - `SOURCE_REF` takes a git tag, branch or commit; `OPERATOR_NAME`,
    `OPERATOR_CONTACT_EMAIL`, `SMTP_URL` and `MAIL_FROM` take the form `.env.example` shows;
    `EVENT_CREATION` takes `anyAccount` or `clientMembers`; `OPERATOR_RESET_LINKS` takes
    `mailOnly` or `copyLinkWithOwnerApproval` (case matters); `AUDIT_RETENTION_DAYS` takes a
    number from 365 to 3650.
  - `MFA_ENCRYPTION_KEY` takes the form `.env.example` shows; `REQUIRE_OPERATOR_2FA` takes
    `true`, `false`, `1` or `0`, and an empty value stops the boot instead of counting as not set.
  - The new limits take positive whole numbers, and an empty value stops the boot: `MIN_FREE_DISK_BYTES`,
    `MAX_CONCURRENT_UPLOAD_REQUESTS`, `MAX_QUEUED_CLIPS_PER_EVENT`, `MAX_STREAMS_PER_CLIENT`,
    `MAX_STREAMS_TOTAL`, `MAX_SUBSCRIBERS_PER_EVENT` and `RETENTION_CAP_NOTICE_DAYS`. Each has an upper
    bound except `MIN_FREE_DISK_BYTES`; the table in
    [docs/UPGRADING.md](docs/UPGRADING.md#upgrading-to-30) gives them. `SQLITE_SHUTDOWN_CHECKPOINT`
    takes `truncate`, `passive` or `none`.
  - The ceilings a new client starts with, all optional and all for a box that has clients
    (`SITE_ADMIN=on`): `NEW_CLIENT_MAX_EVENTS`, `NEW_CLIENT_MAX_EVENTS_PER_PERIOD`,
    `NEW_CLIENT_MAX_TOTAL_BYTES` and `NEW_CLIENT_MAX_EVENT_QUOTA_BYTES` take positive whole
    numbers, `NEW_CLIENT_MAX_RETENTION_DAYS` a whole number from 1 to 3650,
    `NEW_CLIENT_MAX_LIVE_DAYS` one from 1 to 365, and `NEW_CLIENT_CLIPS_ALLOWED` `true`, `false`,
    `1` or `0`.
  - These combinations are refused too: `SMTP_URL` without `MAIL_FROM`,
    `EVENT_CREATION=clientMembers` without `SITE_ADMIN=on`,
    `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval` without `SITE_ADMIN=on`,
    `OPERATOR_CONTACT_EMAIL` without `OPERATOR_NAME`,
    `LEGAL_TERMS_VERSION` without `LEGAL_TERMS_URL`, `REQUIRE_OPERATOR_2FA=true` without a valid
    `MFA_ENCRYPTION_KEY` or without `SITE_ADMIN=on`, an `MFA_ENCRYPTION_KEY` equal to
    `SESSION_SECRET` or `GUEST_TOKEN_SECRET`, any `NEW_CLIENT_*` setting without
    `SITE_ADMIN=on` (which is the default), any other name that starts with `NEW_CLIENT_`, and
    `NEW_CLIENT_MAX_EVENT_QUOTA_BYTES` above `MAX_EVENT_QUOTA_BYTES`.
- **A whole number above 9007199254740991 (2^53 - 1) is refused** (#52, #154), where it was
  rounded and accepted. In the environment that is one more boot refusal on a configuration
  that used to start: `MAX_EVENT_QUOTA_BYTES=99999999999999999999`, written to mean "no limit",
  booted before and now stops it (exit 78, naming the variable). Leave the variable empty for no
  ceiling. In a request, a quota or a link lifetime above that number is `400 request.invalid`
  instead of being stored as another number.
- **A plain-`http` `PUBLIC_URL` is refused in production whatever the case of its scheme**
  (#146). `PUBLIC_URL=HTTP://photos.example.com` used to boot and hand guests join links that
  the `Secure` session cookie is never sent over; it now stops the boot like
  `http://photos.example.com`. The `localhost` exemption is read from the host as well, and it
  is the host `localhost` and nothing that merely starts with it: `http://localhost.example.com`
  and `http://localhost6` are refused. There was no warning first, because keeping the old
  behaviour kept the hole.
- **`PUBLIC_URL` is judged and spelled as the URL it is** (#150). A value that ends in a space
  or a tab, that has a tab or a line break inside it, or that carries a user name or a password
  (`https://user:pw@photos.example.com`, `http://user:pw@localhost`), now stops the boot (exit 78,
  naming `PUBLIC_URL`; the message never repeats the value). What boots reaches join links, QR
  codes and mail in its canonical form: `HTTPS://Photos.Example.com:443/` becomes
  `https://photos.example.com`, a trailing slash is still dropped and a path prefix is kept,
  spelled as a browser would (`/my event` is `/my%20event`, its case is kept). There was no
  warning first, because the old behaviour put a stray character, or a password, into every link.
- **A `PUBLIC_URL` with a query string or a fragment is refused** (#158). Every link is made by
  appending a path to it, so `PUBLIC_URL=https://photos.example.com/?ref=x` used to boot and give
  every guest `https://photos.example.com/?ref=x/join/ABC123`: a QR code that opens the wrong page,
  with no error anywhere. A `?` or a `#` anywhere in the value, even a bare one
  (`https://photos.example.com/?`), now stops the boot (exit 78, naming `PUBLIC_URL`; the message
  never repeats the value). Remove it from the address; a `?` or `#` that belongs in a path prefix
  is written `%3F` or `%23` and boots. There was no warning first, because the old behaviour broke
  the join link of every guest.
- **An account that must change its password is stopped by the server** (#108), with
  `403 auth.passwordChangeRequired` on every `/api` route except `GET /api/auth/me`,
  `POST /api/auth/password` and `POST /api/auth/logout` (and the health and readiness
  probes, which take no account). Only the web app stopped it before, so a script that signed
  in as such an account and went straight to its work is refused until it has changed the
  password.
- **Changing a password ends the account's other sessions** (#125). `POST /api/auth/password`
  signs out every other session of the account and replaces the caller's own `es_session` and
  `es_csrf` cookies. A client that keeps the CSRF value it read at sign-in sends a stale
  `X-CSRF-Token` and gets `403 request.csrfMismatch`: read the cookie again.
- **Uploads can be refused for two new reasons** (#105). With less than 1 GB free
  (`MIN_FREE_DISK_BYTES`) on the database or media volume, or when the free space cannot be
  read, an upload gets `413 storage.boxFull`. With more than four uploads in flight at once
  (`MAX_CONCURRENT_UPLOAD_REQUESTS`), the next gets `429 upload.busy` and a `Retry-After`.
- **A video clip queue has a cap per event as well** (#109). `MAX_QUEUED_CLIPS_PER_EVENT`
  defaults to 20 whatever `MAX_QUEUED_CLIPS` is. If you raised `MAX_QUEUED_CLIPS` above 20,
  one event can no longer queue more than 20 clips: the next gets `429 clip.queueFull`
  while the box-wide limit is far off. Raise `MAX_QUEUED_CLIPS_PER_EVENT` to match.
- **Signing in is throttled per account** (#128). After five failed sign-ins for one address
  from one network, the next attempt gets `429 rate.limited` with a `Retry-After` that starts
  at one second, doubles with each further failure and stops at 15 minutes; the right
  password is refused during that wait too. No account is locked: the wait belongs to one
  network, and the owner of the address signs in from another with no wait. A browser that has
  signed in to the account before presents `es_device`, a signed cookie the sign-in sets
  (`HttpOnly`, `SameSite=Strict`, `Secure` behind TLS, `Path=/api/auth`, 90 days) and is counted on its own, so a
  stranger on the owner's network no longer holds them off (#131); the cookie grants nothing and
  skips no step. Beyond 100 failures an hour across every network, each attempt is held for two
  seconds and never refused. A script that retries a wrong password must back off.
- **A moderator is invited by a link, and the box no longer makes an account for them**
  (#139, #141). `POST /api/events/:slug/moderators` takes `{ "email" }` (and an optional
  `locale`) and answers `201 { "status": "invited", "expiresAt", "link"? }`. It no longer takes
  `temporaryPassword` or `displayName`: a client that sends either gets `400 request.invalid`. It no
  longer answers `created` or `userId`, which said whether the address was already on the box, and it
  creates no account and no role: the person opens the link (`GET /api/invitations/:token`,
  `POST /api/invitations/:token/accept`), chooses a name and a password, and the account exists from
  that moment. The link works once and lives seven days. With a mail relay (`SMTP_URL`) it is mailed
  and the answer has no `link`; with none, or when the relay refused the mail, `link` is in the answer for
  the host to pass on. An account may write at most 30 invitations an hour (`429 rate.limited`). A script
  that invited moderators must stop sending a password, read `link` when it is there, and give it to the
  person. An address that already has an account is never given a second one and is never attached by
  someone who only holds the link: that account signs in and accepts as itself.
- **The server runs on Express 5, and a path with a doubled slash no longer reaches a route**
  (#93). A request for `/api//health` or `/api//events/gala/wall` was handed to the router as
  `/health` or `/events/gala/wall`; it answers 404 now. A script or a probe that builds its
  address by joining a base ending in `/api/` to a path that starts with `/` breaks, and so does a
  reverse-proxy rule that rewrites a path into that shape. The other differences a client or a
  proxy can see are under "Behaviour changes to check before upgrading".

### Behaviour changes to check before upgrading

- **New migrations run at the first boot**, with any earlier one your database has not seen:
  008 (clients, and `events.client_id` and `events.opened_at`), 009 (the audit log), 010
  (account tokens, and the `credentials_changed_at` and `email_verified_at` columns of
  `users`), 011 (an operator's second factor: `user_totp` and `user_recovery_codes`), 012
  (`account_tokens.client_id` and `client_role`, the client an invitation is for), 013
  (five indexes on the foreign keys that deleting a guest, a mission or an event follows, so
  that purging an event no longer reads every photograph of the box once per guest: 320 ms
  became 5 ms on a box of thirty events of a hundred guests and a thousand photographs, and the
  server answers nothing else while it runs; building them takes a moment on a large database)
  (#162) and 014 (eight indexes on the foreign keys that point at `users`, so that deleting an
  account, which the operator now does for an erasure request and the retention sweep does for a
  client whose engagement has ended, does not read the whole audit log once per account; they
  take a moment on a large database too) (#169).
  Migrations are not reversed, and 2.1.0 refuses a database that holds them
  ("downgrading is not supported"), so back up first.
- **A box that runs with `SITE_ADMIN=on` now has an operator API behind that switch** (#160,
  #164, #169). In 2.1.0 the namespace was mounted and answered nothing past its gate;
  `/api/site/*` now carries the routes of "Added" below, for the account whose site role is
  `operator`, which is the first account the box ever had (2.1.0 gave it the role). Every route that
  changes something asks that account to confirm itself again (`403 auth.stepUpRequired`).
  `/api/client/*` and `GET /api/me/limits` are mounted under the same switch, and the web app gains
  `/admin/site` for the operator (below). Off, which is the default, every one of those paths answers
  exactly as a path nobody wrote.
- **On a box with clients, an event reports the limits that bind it** (#153). `quotaBytes` is the
  quota that applies (a client's ceiling can lower it), `liveWindowEnd` is when the client's live
  window closes the event and is absent when there is none, and what the join answers as
  `allowClips` is the host's switch, the client's plan and the box's capability together. The
  first and the last used to show the event's own setting. A box with no client reads exactly as before.
- **What Express 5 changes that a client or a proxy can see** (#93; each was measured against
  the previous version on 265 requests):
  - A request body with `Content-Encoding: br` (brotli) is accepted; it was a 400. The 64 kB
    limit applies to the inflated body, as it already did for gzip and deflate.
  - A query key with brackets (`?cursor[a]=1`) is one flat key instead of a nested one. A route
    still refuses a key it does not know with `400 request.invalid`; only `details.fields` can
    differ, because the unknown key is now named at the root.
  - The files of the client app: a dot-directory inside the client folder (`/.well-known/x`) is
    no longer served and falls through to the app's shell; `/index.html/` and `/dir/file.txt/` no
    longer serve the file; `.js` is `text/javascript` (it was `application/javascript`) and
    `.webmanifest` carries `charset=utf-8`; an `OPTIONS` request on a page answers
    `Allow: GET, HEAD` as `text/plain` (it was `GET,HEAD` as `text/html`). A proxy rule that
    matches on one of these needs a second look.
  - If you maintain a fork: a route path written in Express 4's regular-expression spellings
    (`(`, `)`, `[`, `]`, `?`, `+`, `!` or a bare `*`) no longer compiles, and the client app's
    fallback is `/{*splat}`.
- **zod 4 words some refusals differently** (#52, #154). A boot refusal still names the variable
  and lists every problem at once, but an unknown word for a closed set (`SITE_ADMIN=ON`) is no
  longer followed by what was typed, and a number that is not one reads
  `expected number, received NaN`. A non-integer for a whole-number setting
  (`JOIN_CODE_LENGTH=6.5`) now stops the boot's cross-field checks, so another problem in the
  same file is named on the next boot and not in the same list. `details.fields` of a
  `400 request.invalid` names each path once. The text of an error is not promised
  ([docs/UPGRADING.md](docs/UPGRADING.md#what-a-version-number-promises)), but a log search for
  the old wording will miss.
- **The container's memory limit in `compose.yaml` goes from 1 GB to 2 GB** (#105), because
  up to four uploads are now decoded at once. `GET /api/ready` reports whether the disk margin is
  sufficient under `checks.disk` and never fails on it (the exact free bytes are in the log, #197).
- **A guest can no longer rename themself once the event is closed** (#196). `PATCH /api/events/:slug/guests/:guestId`
  (#190) answers `409 event.notAcceptingUploads` for a closed or archived event, the answer an upload gets: the
  name is printed on the wall of a closed event, unmoderated, so it could otherwise change under photographs the
  host had approved after the host had closed it. Reopening the event allows it again.
- **The host dashboard's `usedBytes` now counts the clip sources still waiting in the queue**
  as well as the photographs (#117), so it can read higher than before while clips are queued.
  It is the figure an upload is checked against.
- **A guest token for another event is answered `404 event.notFound`, no longer a `403` with the code `guest.wrongEvent`** (#194).
  The 403 told a guest of any event which slugs exist, drafts and archived events included, where the public
  wall answers `404` for all three. A client that branched on `guest.wrongEvent` now sees `event.notFound`;
  the reason is in the log, as a warning with the two event ids. The web app's outbox keeps a queued photo
  on that answer, as it did on the 403.
- **Three small answers changed** (#191). A moderator whose browser also holds a guest cookie (a host
  who scanned their own QR code) is now answered as a moderator by
  `DELETE /api/events/:slug/photos/:photoId`, where it was refused as a guest. A wall stream that is
  open when the host archives the event now ends at its next heartbeat and frees its slot, where it
  stayed open. `HttpDeps.guests` and `HttpDeps.guestTokens` no longer exist, which only matters to
  code that builds the server itself.
- **The server logs one line per request** (#104): the route pattern, never the raw URL,
  with status, duration and a request id. An unhandled error's stack trace is now logged in
  production too. On `SIGTERM` or `SIGINT`, `GET /api/ready` answers 503 at once and open
  event streams are told to reconnect in 2 seconds.
- **Every `429` carries a `Retry-After`, and `/api` is `no-store` by default** (#192). The per-client
  stream cap, a guest's reaction budget, invitations to one address and an operator's resets to one
  inbox answered `429` with no wait; they now say one (30 s, the budget's window, an hour, an hour)
  and repeat it as `details.retryAfterSeconds` in the body, as `upload.busy` now does (2 s). Every
  answer under `/api` is `Cache-Control: no-store` unless its route sets its own, which the host's
  event list, the event, its guests, its moderators (with their e-mail addresses) and its missions
  did not: a browser or a proxy can no longer store them, or revalidate them with `If-None-Match`.
  Media, `/api/about` and the event streams keep their own headers.
- **The access log writes each key once per line** (#192). A routed request's line carried
  its `service`, `version`, `requestId` and `route` keys twice, the first `route` being
  `(unmatched)`: a collector that kept the first duplicate read the wrong route for every request.
  `route` now sits after `duration`.
- **`GET /api/ready` no longer says how many bytes are free** (#197). It is unauthenticated, and the exact free
  space of the volume the albums live on let anyone watch an event fill the box. `checks.disk` is now
  `{ "sufficient": true }`, without `freeBytes`, in the 200 and the 503 alike; each probe writes the number to the
  log as `readiness: free disk space`, as a warning when the margin is too thin or could not be read. A
  monitor that read `freeBytes` from the body should read the log, or alert on `sufficient`.
- **Three boot warnings, never refusals** (#109, #120): production with no `PUBLIC_URL`,
  production with a secure cookie and `TRUST_PROXY_HOPS=0`, and, in production, `MAIL_FROM` set
  without `SMTP_URL`. A fourth, in every environment, is for the deprecated setting below (#172).

### Deprecated

- **`GUEST_SELF_DELETE_GRACE_SECONDS`** is read by nothing and will be removed in 4.0.0 (#172).
  How long a guest may take a photo back is a setting of each event
  (`guestSelfDeleteGraceSeconds`, chosen by its host), and this variable never reached it: a box
  that set it saw no change. It is still validated, so a box that sets it boots as before, and
  3.0.0 logs a warning at boot that it does nothing. Remove it from your `.env`; `.env.example`
  no longer sets it.

### Added

- **A guest can react to their published photos** (#188) when the host has reactions on: five
  buttons under each photo in "my photos", one tap to react, a second to take it back, and the heart
  reaches the wall live. Reacting to the rest of the room comes with the guest feed.
- **A guest can rename themself, and a phone can check a join code before joining** (#190):
  `PATCH /api/events/:slug/guests/:guestId` changes the name a guest's photos are signed with, their
  own and nobody else's, and `GET /api/join/:code` says which event a code names, with the same
  answer and the same per-address budget as `POST /api/join`. A join code in a request path is now
  written to the log as `/api/join/:token`.
- **The pages for the account flows** (G2-10, #143). `/invite/:token` opens a mailed or copied
  invitation: it says what the link is for and when it ends, takes a name and a password, or accepts
  as the account that is already signed in, and says one sentence for every dead link. A person whose
  address already has an account is sent to sign in and brought back to the same link.
  `/password/forgot` and `/password/reset/:token` are the two halves of a forgotten password: the
  sign-in page links to the first only when `features.forgotPassword` is true. Every screen on
  `/admin/**` has an account menu with _Sign out_ (nothing in the app called `logout` before),
  _Sign out everywhere_ behind a confirmation, and _Change password_. The two pages that
  carry a token (`/invite/:token`, `/password/reset/:token`) are served with
  `Cache-Control: no-store`, `X-Robots-Tag: noindex` and no referrer, because the token is in their
  address; all the screens are in the five languages.
- **Password reset, and sign out everywhere** (#125). `POST /api/auth/password-reset/request`
  and `POST /api/auth/password-reset/confirm`, by a mailed link that lasts an hour (at most
  three mails per address per hour), and `POST /api/auth/sessions/revoke-others`, which ends
  every session of the account but the caller's. With no mail relay, the reset answers
  `404 feature.unavailable` and `GET /api/about` reports `features.forgotPassword: false`.
  Behind them: a credentials epoch on each account (`users.credentials_changed_at`), which a
  password change or reset, a sign out everywhere and disabling the account all raise, and
  single-use account tokens stored as their SHA-256 only (`account_tokens`).
- **Invitations by link** (#139, #141). A moderator is invited by a single-use link that lives
  seven days, mailed when the box has a relay and otherwise (or when the relay refused it) handed to the host. The account is made by
  the invitee, with a password they choose, when they accept it; an account that already uses the
  address signs in and accepts as itself. Writing an invitation to the same address and event replaces
  the earlier link, and one address is written to at most five times an hour. The address is marked
  verified only when the link came by mail. The operator invites into a client's account the same
  way (below).
- **Accepting an invitation can also accept the terms of use**, when the operator asks for it (#159). With
  `LEGAL_TERMS_URL` and `LEGAL_TERMS_VERSION` both set, the invitation page shows a required,
  unticked box with a link to the terms, `POST /api/invitations/:token/accept` takes
  `acceptTerms: true` and answers `400 terms.notAccepted` without it, and the acceptance writes the
  audit entry `account.termsAccepted` with the version, in the transaction that spends the link. A
  box that sets neither, or only the address, looks and behaves as before.
- **Mail, optional** (#120). A `Mailer` port, a `NullMailer` that sends nothing and is the
  default, and an SMTP adapter on `nodemailer` (a new dependency) switched on by `SMTP_URL`
  and `MAIL_FROM`. The password reset and the invitations are what send mail.
- **Operator identity and legal links** (#123). `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`,
  `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SUPPORT_URL` and `REPORT_URL`,
  all empty by default. When set they appear on `/about` and in the footers, the guest
  privacy notice names the operator, and guests get a link to report a content. A box that
  sets none of them looks as before.
- **Support links, optional** (#119). `DONATION_URL` and `BUDGET_URL`, empty by default: a
  link in the host footer and on `/about`, and a closable card on the page of a closed event.
- **Clients, ceilings and an audit log, for a box run for other people**, behind `SITE_ADMIN=on`
  (off by default). Clients as records, with nine ceilings (#113); events attached to a client, and
  `EVENT_CREATION=anyAccount|clientMembers` to say who may create one (#117); every ceiling
  enforced on every write path, a live window that closes an event, and a purge that is safe
  when a ceiling is unset (#121); an append-only audit log, with `AUDIT_RETENTION_DAYS`
  (default 1095, never below 365) (#118); a content-free overview of a box, shapes and
  sizes and never what guests made (#126); and the ceilings a new client starts with (#145),
  `NEW_CLIENT_*` (unset means no ceiling), applied when the operator provisions one and recorded
  in the audit log. `GET /api/auth/me` reports `canOperateSite`, whatever `SITE_ADMIN` says. The
  next entries are what reaches all this over HTTP.
- **The operator's API** (#160, #164, #169). With `SITE_ADMIN=on`, the account whose site role is
  `operator` manages the box's clients over `/api/site/*`; [docs/API.md](docs/API.md) §1 lists
  every route. It reads the clients (with what each uses), a client's events, the accounts, the audit
  log and the defaults a new client starts with: shapes and sizes, never an event's name, a
  photograph, a caption or a guest. It opens a client and invites its owner, renames it, changes its
  ceilings (a reason of one line is required and goes to the audit log, which the client's owner is
  not shown), suspends and resumes it, invites someone into its account, resets an account's
  password, ends an engagement (`offboard`), switches an account off or on, and deletes one for an
  erasure request. Every change asks for a confirmation of the person within the last five minutes
  (`403 auth.stepUpRequired`) and writes its audit line before it acts. Suspending a client touches
  nothing it holds: its guests, its wall and its gallery links answer as an event that does not
  exist, its members keep their reads and every write is `403 client.suspended`, and resuming it
  gives everything back (not a client that is being offboarded). Offboarding closes its live events,
  archives its drafts, suspends it and sets a purge date, 1 to 365 days away, that the operator
  chooses; the retention sweep that already runs then purges its albums and removes the accounts
  that were only its own. That is the sweep's work: with `RETENTION_SWEEP_INTERVAL_MINUTES=off` and
  `npm run purge` run by cron, the albums go, but neither the clients nor the audit log are finished
  or pruned. Deleting an account is refused (`409`) while it owns an event, wrote photographs or
  clips, reviewed photographs, or is the only owner of a client that still has other members or an
  event; an operator's account can be neither switched off nor deleted (`403 account.operatorProtected`).
- **The operator's console** (#181, #185). `/admin/site` presents that API to the person it is for: the
  clients (their standing, events, members and storage against their ceiling, and opening a client
  with the box's defaults pre-filled), one client (its usage, renaming, suspending and lifting, its
  nine ceilings with the required reason, an invitation into its account, its events as ids,
  statuses and sizes, and ending its engagement), the accounts (a password reset, by mail, or as a
  link where none could go; switching an account off, back on, or away for an erasure request) and
  the audit log. A change that meets `403 auth.stepUpRequired` opens one prompt for the
  password, and for the code or a recovery code where the account has an authenticator, then sends
  the same change again once. The routes exist only when `features.siteAdmin` is true and only for the
  account that `canOperateSite`: anybody else gets the not-found page and the server is not asked,
  and a session that has not passed a required second factor is sent to enrol or to sign in again.
  It draws shapes and sizes, never what a client or a guest made. In the five languages.
- **An operator cannot hand itself access to a client** (#148,
  [ADR 0009](docs/adr/0009-operator-cannot-grant-itself-access.md)). An operator's invitation into
  a client that already has an event, a member or another invitation waiting is written as waiting and opens nothing, by link or
  by mail, until one of that client's owners approves it
  (`POST /api/client/invitations/:invitationId/approve`). A password reset the operator starts is
  mailed to the account's own address and never shown to the operator; on a box with no mail relay
  it issues nothing (`409 reset.mailerRequired`), unless `OPERATOR_RESET_LINKS` says
  `copyLinkWithOwnerApproval`, which hands the operator the link once, after another owner of the
  account's client approved that very request
  (`POST /api/client/password-resets/:requestId/approve`, by the API only). `OPERATOR_RESET_LINKS` is
  `mailOnly` unless you set it, and the other word needs `SITE_ADMIN=on`. No operator action grants a
  role in an event, opens a session or impersonates an account.
- **A second factor for the operator** (#130). An account that operates the box can enrol a TOTP
  authenticator (RFC 6238, six digits every thirty seconds) and gets ten single-use recovery codes,
  shown once. It needs `MFA_ENCRYPTION_KEY`, the key the authenticator's secret is stored under
  (AES-256-GCM); with none, enrolment is not offered (`404 feature.unavailable`) and signing in is as
  it was. Once enrolled, a right password starts no session: `POST /api/auth/login` answers
  `{ "secondFactorRequired": true }` and `POST /api/auth/login/2fa` finishes the sign-in with a code or
  a recovery code (five minutes, five wrong codes), and a code is accepted once. `REQUIRE_OPERATOR_2FA=true`
  makes `/api/site/*` answer `403 auth.secondFactorRequired` to an operator whose session has not
  passed the factor; it needs the key and `SITE_ADMIN=on`. `POST /api/auth/step-up` confirms the person
  again for five minutes, which renewing the recovery codes, removing the factor and every change
  under `/api/site` ask for. **Lose `MFA_ENCRYPTION_KEY` and every enrolled operator can only sign in
  with a recovery code**: keep it apart from `SESSION_SECRET` and back it up with the database, somewhere
  else. The page is `/admin/security`, in the five languages.
- **The client's own space** (#153), only with `SITE_ADMIN=on`. A member reads their client's limits
  and how close each is (`GET /api/me/limits`: the nine ceilings, what is used, and a level per meter,
  `ok`, `warning` from 90 per cent or `reached`, decided by the server). An owner reads the audit log of
  their own client (`GET /api/client/audit`) and what waits for their approval
  (`GET /api/client/invitations`); a line of that log never carries an account, an address, a slug or
  a name. The web app gets a ceilings banner, a page at `/admin/client`, a screen that says an account
  is suspended (reading and export keep working), a three-step list on an empty dashboard and the live
  window on an event's page. Off, those routes answer as a path nobody wrote and the app has no
  `/admin/client`.
- **Settings whose default is today's behaviour**: `MAX_STREAMS_PER_CLIENT`,
  `MAX_STREAMS_TOTAL`, `MAX_SUBSCRIBERS_PER_EVENT` and `SQLITE_SHUTDOWN_CHECKPOINT` (#109);
  `RETENTION_CAP_NOTICE_DAYS`, which only matters to a box with clients (#121). A test now fails when
  the configuration module reads a key that `.env.example` does not document; its first run found
  `LOGIN_RATE_LIMIT_PER_MINUTE` and `REACTION_RATE_LIMIT_PER_MINUTE`.

### Fixed

- **The host's album ZIP carries the video clips** (#173). It asked the media store for the original
  of every row, a clip has none, and every clip of the event was skipped with a warning: a host who
  exported and then purged lost them. A clip is archived as its transcode, an `.mp4`, numbered with
  the photographs, so the ZIP is as large as the clips it now holds.
- **An upload that loses a race to an identical one no longer deletes the winner's media** (#167).
  Two guests sending the same photograph at the same moment both missed the duplicate check, one
  insert won, and the other's cleanup deleted the files the winner's row names: the album kept a
  photograph with no file, a tile that is a 404 on the wall. The second upload is answered
  `duplicate`, with the first one's photograph, as is a guest at their photo limit who double-tapped.
- **A guest keeps the thumbnails of their own photos when a refresh fails, and a failure on a guest's screen is boxed** (#193).
  One moment of bad venue Wi-Fi replaced the list of "your uploads" with an empty one, taking away the proof that the
  photos had arrived; the list now stays, with the failure above it and a retry, and a photograph the guest has just
  deleted leaves it at once. The failures on the join page's welcome step, on the shared gallery and on that list are
  framed like the host's forms instead of a bare red line.
- **"N guests here" counts the guests who are still uploading** (#170). Presence was written when a
  guest joined and never again, so the host's console counted who had joined in the last five minutes.
  A guest's requests refresh it, at most every 30 seconds, and a write that fails is logged and never
  fails the request.
- **The photo of the night counts the photographs that are shown** (#175).
  `GET /api/events/:slug/top-photos` cut the ranking at `limit` and then dropped what is no longer
  on the wall, so a hidden or rejected favourite took a place and the panel could come back empty
  while a published photograph had a reaction. It walks the ranking until it has `limit` photographs
  on the wall.
- **An album download that is abandoned no longer leaves its sources open** (#144). A client that
  closed the tab in the middle of an `album.zip` left one open file per queued photograph, on the
  host's route and on a gallery link's. The next photograph is opened only when the one before has
  been written, and the host's listing is read in pages of 200, so a slow download no longer blocks
  the uploads of other events.
- **A link cut in the middle of an escape is a 400, not a 500** (#147).
  `/api/events/%E0%A4%A/wall` answered `500 server.unexpected` and logged a stack that, on a gallery,
  invitation or reset address, held the token. It answers `400 request.invalid`; a gallery address
  answers its usual `404 gallery.notAvailable` and the invitation API `404 invitation.notFound`.
- **A moderator who had to change their password was sent back to the form after saving it** (#168).
  The app kept the old answer; the host app also asks for the session and for `GET /api/about` once
  per page load instead of up to three and eight times.
- **The projected wall stops showing an album the server no longer serves** (#213). A wall that was
  already open kept cycling its photos after the host archived the event or the operator suspended the
  client, behind a small "connection lost" notice, because it took the server's `404` for a network drop.
  A lost live feed now makes the wall read once, and the answer `404 event.notFound` clears it to "this
  gallery is not on display"; a real network drop still keeps the photos and the notice. The wall of a draft,
  archived or suspended event no longer tells the host to check the venue's network, in the five languages,
  and it comes back by itself if the event is served again. A wall with no live feed re-reads every 30 seconds.
- **A newer error replaces a stale one** (#223). On the change-password, reset-password and accept-invitation
  forms, the server's verdict on one attempt ("too common") stayed on screen beside the browser's own sentence
  about the next ("the two passwords do not match"); on the operator's accounts page, two refused acts left two
  pinned refusals up. The newest finding is the only one shown.
- **Password prompts say "wrong password", not "wrong address or password"** (F02). Changing the password,
  confirming oneself (step-up) and setting up the second factor have no address field, yet a refused password
  read like a sign-in refusal. The sign-in form keeps its deliberately neutral sentence.
- **The new-event button is disabled, with the reason, at the events ceiling** (F19). The form used to
  stay usable at "3 of 3" and the refusal appeared under the template list, below the fold. When every
  client the host belongs to has reached its events limit (total or per period), the button is disabled and
  the sentence sits beside it.
- **A guest of a closed event is told so, instead of being offered the upload form** (F18).
  `GET /api/events/:slug/photos/mine` now carries `acceptingUploads` (the upload rule's own answer); the
  upload screen shows "this gallery no longer accepts photos" and no picker when it is `false`, and keeps
  the guest's own photos listed. Before, the form stayed and the refusal came after the send.
- **`/password/forgot` on a box with no mail relay says so** (F20). The sign-in page already hid the link,
  but the address still served a form whose every answer was a refusal; it now shows "this server cannot
  send e-mail" once `/api/about` has said so, and the form is unchanged on a box that can.
- **A moderator is shown an event's settings read-only, with the reason** (F15). The form was fully
  editable and every save answered "you do not have the rights for this action". The controls are now
  disabled under "only the event's owner can change its settings", in the five languages.
- **Every page names itself in the browser tab** (#163), in the five languages: three tabs of one
  event were all "EventSlide". The client space's loaders no longer say they are loading your
  events, and the gallery viewer no longer reads a caption twice to a screen reader.
- **The web app's files are cached for a year, as intended** (#224). The rule that marks a content-hashed
  file `immutable` looked for a name Vite never produces, so every script and stylesheet was
  revalidated at each page load; it now matches the names the build emits. `index.html`, the service
  worker and the manifest are still revalidated.

### Security

- **A guest can no longer write without limit** (#187): editing a caption, deleting a photo,
  withdrawing a reaction, acknowledging the privacy notice and renaming oneself (#190) share one allowance per client and
  event, `GUEST_WRITE_RATE_LIMIT_PER_MINUTE` (default 300, at most 6000), and are answered `429`
  above it. Before, one guest could send these as fast as the network allowed.
- **Five wrong second-factor codes end a sign-in even when they arrive at the same moment** (#200).
  The count of wrong codes was a number in the session, and every request carries its own copy of
  the session, so ten codes sent together each counted as the first and none ended the sign-in. They
  are now counted as they are tried, in one place: the sixth to start, and every one after it, is
  refused unread as `401 auth.secondFactorExpired`, and the password is asked again. Typing one code
  at a time changes nothing. The count is kept in memory, like the sign-in limits: a restart of the
  box starts it again.
- **Every response asks the browser for cross-origin isolation** (#226): `Cross-Origin-Embedder-Policy:
require-corp` joins the opener and resource policies that were already sent. The app embeds nothing
  from another origin, so nothing changes on a page; a cross-origin image or frame added later would be refused.
- **A stolen session no longer survives a password change** (#125): the credentials epoch ends
  every session minted before it.
- **Guessing a password is slowed per account, without locking anyone out** (#128), and the
  password reset request is throttled the same way. A browser that has signed in before is counted
  on its own, so a stranger on the owner's network cannot hold them off (#131).
- **The operator is held to a second factor and to a guard** (#130, #148, #160): a code that cannot
  be replayed, a confirmation before every change, and no way for the operator to hand itself an
  account, a role or a link that was not approved by the people it concerns.
- **An account that is switched off, deleted or removed from an event loses its open moderation feed** (#169):
  the feed re-reads the account's role at every heartbeat and ends within one beat.
- **A credential in a link stays out of the log** (#147, #156, #157). A link cut in the middle of an
  escape wrote its token to the error log; the `path` of a log line now hides a gallery, invitation
  or reset token however the address is spelled (escaped letters, dot segments, doubled slashes).
- **A critical advisory leaves the production dependencies** (#93): `proxy-addr`
  (GHSA-jqcg-44mw-7w3h, IP spoofing through an IPv4-mapped IPv6 trust subnet), which Express 5 pulls at
  2.0.8. It was not reachable here, because `TRUST_PROXY_HOPS` is a hop count and never a subnet.

### Documentation, tests and dependencies

- The upgrade policy for self-hosters, `docs/UPGRADING.md`, and the CHANGELOG conventions it
  relies on, held by tests (#127); ADR 0007 on the licence and the maintainer's own use (#111)
  and ADR 0009 on what an operator cannot grant itself (#148); the licensing FAQ and the 2.1.0
  entry (#124); this entry and "Upgrading to 3.0" (#129); the ports catalogue, which lists all 32
  ports (#174).
- Tests that change nothing in the product: a flaky shared-gallery-link test (#149), the repository contract of keyset
  paging over photographs that share a timestamp (#161), the contract suites of the media store and
  the event bus (#165), the architecture lint's `process.env` ban in every spelling (#166), an end-to-end
  server that takes no configuration from the shell (#176), rules found by a mutation sweep (#177) and
  one logger double (#178).
- Refactors and deletions with no change of behaviour: code nothing called (#155, #180), one guarded
  job and one repeater for the background sweeps (#171), shared helpers in the web app (#179), and
  `env.ts` split into the pieces of its schema (#182): the settings are declared in
  `src/infrastructure/config/` now.
- Dead code and stale documents in the web app, and the tests that keep them out (#211): three
  client methods and fourteen sentences of the copy table that nothing used, a test seam in
  production code, the focus ring drawn four times over and two unused design tokens; the
  design-system document and the UI recipe stop describing a `Grid` and a helper that do not
  exist. The address preview of the new-event form agrees with what the form sends when the
  address box holds only a space.
- Continuous integration: the end-to-end job is bounded and retries a hung browser download (#140),
  and `apt` waits for the runner's own lock (#142).
- Dependencies: Express 4.22 to 5.3 (#93, see `### BREAKING`), zod 3.25 to 4.6 (#52, #154), archiver 7
  to 8 (#94: it is ESM-only, so the server loads it with a dynamic import; the ZIPs are unchanged),
  vite 8.3.5 (#106, #136), ip-address 10.7.4 (#112, #151), the production group (#137:
  express-rate-limit 8.7.1, nodemailer 10.1.7, pino 10.4.0, react and react-dom 19.3.1, sharp 0.35.5)
  and the development group (#116, #138).

## [2.1.0] - 2026-10-02

The last release under the GPL-3.0: everything merged to `main` after 2.0.0, from pull request
#10 to pull request #103, up to the commit `5c2607380ebb18045a14cae979bb54e6fa2def76`. The tag
`gpl-final` is on the same commit. The next release, 3.0.0, is licensed AGPL-3.0-only. This
entry is the [GitHub release](https://github.com/Irony42/EventSlide/releases/tag/v2.1.0) in
short. `package.json` at this tag still reads `2.0.0`, so a build of it reports `2.0.0`.

### Added

- **Guests**: an offline upload queue (#10) and an installable PWA (#11); short video clips,
  transcoded on the server (#18, #19); the app in the guest's own language (#25), and the
  whole interface translated into French, English, German, Spanish and Italian (#78); a
  privacy notice when a guest joins (#83).
- **The room**: four more wall layouts (#14); per-event theming (#27) and the "liquid glass"
  look (#63); photo missions, a prompt the host writes and a tag the guest taps (#77).
- **Hosts**: moderation from a phone (#13); an event that opens and closes on a schedule
  (#15); event templates (#28); a shared gallery link after the event (#84).
- **Running it**: fixes to the documented Docker install (#30), Docker backups (#90) and
  Node 24 (#67). `MAX_EVENT_QUOTA_BYTES` caps any event's quota (#98). `EVENT_SLUG_SUFFIX`,
  `ALLOW_CUSTOM_SLUGS` and `JOIN_CODE_LENGTH` (#103). An optional `SITE_ADMIN=off|on` switch
  for an operator namespace, `/api/site`, off by default; when `off`, every path under it
  answers exactly as a path nobody wrote (#95).

### Behaviour changes to check before upgrading

2.1.0 was cut before the upgrade policy: these are changes a major would have carried.

- **New migrations run at the first boot**: 002 to 007, on a database that holds only 001.
  Migrations are not reversed, and 2.0.0 refuses a database that holds them, so back up
  first.
- **`NODE_ENV` defaults to `production`**, and the server refuses to boot without real
  secrets. A disabled account loses access on its next request (#57).
- **A taken slug answers `409 event.slugUnavailable`** and no longer echoes the slug;
  `event.slugTaken` is gone (#103). An API client that matched the old code must change.
  Event creation is also limited to 20 per account per hour
  (`EVENT_CREATION_RATE_LIMIT_PER_HOUR`).

### Security

- ffmpeg and ffprobe no longer inherit the server's environment (#100): they get `PATH` and a
  pinned `LANG`, and on Windows the few system variables the OS needs, so a crafted media file
  that compromises a decoder finds no `SESSION_SECRET` or `GUEST_TOKEN_SECRET`.
- Dependency advisories closed (#47, #54).

### Documentation, tests and dependencies

- Documentation drift fixed against the code, and the empty `ssl/` directory removed (#101).
- A CI check on the assignment of migration ids (#97).
- Dependabot updates.

## [2.0.0] - 2026-09-12

The rework of 1.0 (#9, the `deuxpointzero` branch): TypeScript throughout, on a hexagonal
architecture enforced by lint, with Node, Express, SQLite and a React front end. Licence:
GPL-3.0. This entry is the
[GitHub release](https://github.com/Irony42/EventSlide/releases/tag/v2.0.0) in short.

- Guests join by scanning a QR code or typing a six-character code, with no account, no app
  and no email.
- Nothing reaches the screen until a host approves it in the moderation queue.
- The wall is made to be watched: full-bleed photos with a slow zoom, a mosaic layout, captions
  and the sender's name, and the join code in a corner. Uploads retry, and the wall keeps
  playing when the network drops.
- Location data and device identifiers are stripped from every photo on arrival.
- The album exports as one full-resolution ZIP, with an automatic purge when you choose.
- It installs with `docker compose up -d`, and the photos stay on your machine.
