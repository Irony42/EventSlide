# Changelog

What changed in each tagged release, newest first. This file is written by hand until
releases are automated: the pull request that prepares a release writes its entry, and the
pull requests before it do not touch this file. The entries of 2.0.0 and 2.1.0 were written
after those releases were published, from their release notes.

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

Everything merged to `main` from pull request #104 on, plus this release's own preparation.
The work before it is in the 2.1.0 entry, the last release under the GPL-3.0. This is a major
release: it changes the licence, and it breaks things for an existing installation, which
`### BREAKING` lists. [docs/UPGRADING.md](docs/UPGRADING.md#upgrading-to-30) says in which
order to do what.

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
  `/data` paths and point the server away from your volume. Read your `.env` before you pull,
  and remove what you did not mean to apply.
- **New settings are checked at boot, and a value that does not fit stops it** (exit 78,
  naming the variable) (#114, #117, #118, #119, #120, #123). If your environment or `.env`
  already sets one of these names for another purpose, change or remove it before you
  upgrade. A blank value counts as not set.
  - `SUPPORT_URL`, `REPORT_URL`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL` and
    `LEGAL_NOTICE_URL` take an `https` URL without credentials, or a path starting with one
    `/`.
  - `SOURCE_CODE_URL`, `DONATION_URL` and `BUDGET_URL` take an `https` URL without
    credentials.
  - `SOURCE_REF` takes a git tag, branch or commit; `OPERATOR_NAME`,
    `OPERATOR_CONTACT_EMAIL`, `SMTP_URL` and `MAIL_FROM` take the form `.env.example` shows;
    `EVENT_CREATION` takes `anyAccount` or `clientMembers`; `AUDIT_RETENTION_DAYS` takes a
    number from 365 to 3650.
  - Three combinations are refused too: `SMTP_URL` without `MAIL_FROM`,
    `EVENT_CREATION=clientMembers` without `SITE_ADMIN=on`, and `OPERATOR_CONTACT_EMAIL`
    without `OPERATOR_NAME`.
- **An account that must change its password is stopped by the server** (#108), with
  `403 auth.passwordChangeRequired` on every `/api` route except `GET /api/auth/me`,
  `POST /api/auth/password` and `POST /api/auth/logout`. Only the web app stopped it before,
  so a script that signed in as such an account and went straight to its work is refused
  until it has changed the password.
- **Changing a password ends the account's other sessions** (#125). `POST /api/auth/password`
  signs out every other session of the account and replaces the caller's own `es_session` and
  `es_csrf` cookies. A client that keeps the CSRF value it read at sign-in sends a stale
  `X-CSRF-Token` and gets `403 request.csrfMismatch`: read the cookie again.
- **Uploads can be refused for two new reasons** (#105). With less than 1 GB free
  (`MIN_FREE_DISK_BYTES`) on the database or media volume, an upload gets
  `413 storage.boxFull`. With more than four uploads in flight at once
  (`MAX_CONCURRENT_UPLOAD_REQUESTS`), the next gets `429 upload.busy` and a `Retry-After`.
- **Signing in is throttled per account** (#128). After five failed sign-ins for one address
  from one network, the next attempt gets `429 rate.limited` with a `Retry-After` that starts
  at one second, doubles with each further failure and stops at 15 minutes; the right
  password is refused during that wait too. Nobody is locked out: the owner of the address
  signs in from another network with no wait. Beyond 100 failures an hour across every
  network, each attempt is held for two seconds and never refused. A script that retries a
  wrong password must back off.

### Behaviour changes to check before upgrading

- **New migrations run at the first boot**, with any earlier one your database has not seen:
  008 (clients, and `events.client_id` and `events.opened_at`), 009 (the audit log) and 010
  (account tokens, and the `credentials_changed_at` and `email_verified_at` columns of
  `users`). Migrations are not reversed, and 2.1.0 refuses a database that holds them
  ("downgrading is not supported"), so back up first.
- **The container's memory limit in `compose.yaml` goes from 1 GB to 2 GB** (#105), because
  up to four uploads are now decoded at once. `GET /api/ready` reports the disk margin under
  `checks.disk` and never fails on it.
- **The host dashboard's `usedBytes` now counts the clip sources still waiting in the queue**
  as well as the photographs (#117), so it can read higher than before while clips are queued.
  It is the figure an upload is checked against.
- **The server logs one line per request** (#104): the route pattern, never the raw URL,
  with status, duration and a request id. An unhandled error's stack trace is now logged in
  production too. On `SIGTERM` or `SIGINT`, `GET /api/ready` answers 503 at once and open
  event streams are told to reconnect in 2 seconds.
- **Three boot warnings, never refusals** (#109, #120): production with no `PUBLIC_URL`,
  production with a secure cookie and `TRUST_PROXY_HOPS=0`, and `MAIL_FROM` set without
  `SMTP_URL`.

### Added

- **Password reset, and sign out everywhere** (#125). `POST /api/auth/password-reset/request`
  and `POST /api/auth/password-reset/confirm`, by a mailed link that lasts an hour (at most
  three mails per address per hour), and `POST /api/auth/sessions/revoke-others`, which ends
  every session of the account but the caller's. With no mail relay, the reset answers
  `404 feature.unavailable` and `GET /api/about` reports `features.forgotPassword: false`.
  Behind them: a credentials epoch on each account (`users.credentials_changed_at`), which a
  password change or reset, a sign out everywhere and disabling the account all raise, and
  single-use account tokens stored as their SHA-256 only (`account_tokens`).
- **Operator groundwork, not reachable yet.** Behind `SITE_ADMIN=on`: clients as records,
  with ceilings (#113); events attached to a client, and
  `EVENT_CREATION=anyAccount|clientMembers` to say who may create one (#117); every ceiling
  enforced on every write path, a live window that closes an event, and a purge that is safe
  when a ceiling is unset (#121); an append-only audit log, with `AUDIT_RETENTION_DAYS`
  (default 1095, never below 365) (#118); and a content-free overview of a box, shapes and
  sizes and never what guests made (#126). No HTTP route reaches the clients, the audit log or
  the overview yet. `GET /api/auth/me` reports `canOperateSite`, whatever `SITE_ADMIN` says.
- **Mail, optional** (#120). A `Mailer` port, a `NullMailer` that sends nothing and is the
  default, and an SMTP adapter on `nodemailer` (a new dependency) switched on by `SMTP_URL`
  and `MAIL_FROM`. The password reset is the first thing that sends mail.
- **Operator identity and legal links** (#123). `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`,
  `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SUPPORT_URL` and `REPORT_URL`,
  all empty by default. When set they appear on `/about` and in the footers, the guest
  privacy notice names the operator, and guests get a link to report a content. A box that
  sets none of them looks as before.
- **Support links, optional** (#119). `DONATION_URL` and `BUDGET_URL`, empty by default: a
  link in the host footer and on `/about`, and a closable card on the page of a closed event.
- **Settings whose default is today's behaviour**: `MAX_QUEUED_CLIPS_PER_EVENT`,
  `MAX_STREAMS_PER_CLIENT`, `MAX_STREAMS_TOTAL`, `MAX_SUBSCRIBERS_PER_EVENT` and
  `SQLITE_SHUTDOWN_CHECKPOINT` (#109); `RETENTION_CAP_NOTICE_DAYS`, which only matters to a box
  with clients (#121). A test now fails when `env.ts` reads a key that `.env.example` does
  not document; its first run found `LOGIN_RATE_LIMIT_PER_MINUTE` and
  `REACTION_RATE_LIMIT_PER_MINUTE`.

### Security

- **A stolen session no longer survives a password change** (#125): the credentials epoch ends
  every session minted before it.
- **Guessing a password is slowed per account, without locking anyone out** (#128), and the
  password reset request is throttled the same way.

### Documentation, tests and dependencies

- The upgrade policy for self-hosters, `docs/UPGRADING.md`, and the CHANGELOG conventions it
  relies on, held by tests (#127); ADR 0007 on the licence and the maintainer's own use (#111).
- Dependencies: vite 8.3.1 (#106), ip-address 10.7.3 (#112), and the development group
  (#116).

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
