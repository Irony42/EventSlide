# Changelog

What changed in each tagged release, newest first. This file is written by hand until
releases are automated.

Versions are tagged `vX.Y.Z`. The tag `gpl-final` is not a version: it marks the last
commit published under the GPL (see [docs/LICENSING-FAQ.md](docs/LICENSING-FAQ.md)).

## [2.1.0] - 2026-10-02

Everything merged to `main` from pull request #95 to pull request #123, plus this release's
own preparation. Earlier work is not listed: `2.0.0` was never tagged, and its history is in
git.

### Licence

- **EventSlide is now licensed under AGPL-3.0-only**, where it was GPL-3.0 (#110).
  `LICENSE` is the Free Software Foundation's text, unmodified. `package.json`, the lockfile
  root and the image's `org.opencontainers.image.licenses` label all say `AGPL-3.0-only`.
  A new `NOTICE` carries the copyright line and names sharp, libvips and ffmpeg as
  components that stay under their own licences.
- **Nothing published before stays anything but GPL-3.0.** Every commit up to and including
  `5c2607380ebb18045a14cae979bb54e6fa2def76` stays available under the GPL-3.0 for good: the
  GPL's grant is irrevocable. That commit is named in `.github/gpl-boundary` and is the one the
  tag `gpl-final` is cut on. A CI job, `licenseHistory`, checks that every commit after it on
  the first-parent line of `main` carries the AGPL text.
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
  points at the tag of the running version, `https://github.com/Irony42/EventSlide/tree/v2.1.0`
  for this release. That is the source of exactly your build only when you run an unmodified
  copy of the tagged release: anything else (a modified build, a fork, a commit no tag names)
  must set `SOURCE_CODE_URL`. No setting hides the link. The version is now read from
  `package.json` alone, so `/api/health`, `/api/about` and the backup manifest cannot
  disagree.

### Behaviour changes to check before upgrading

- **`compose.yaml` now reads `.env`** (`env_file`, optional, which needs Docker Compose 2.24 or
  later) (#109). Until now Compose used `.env` only to fill the `${VAR}` references in the
  file, so a setting that `compose.yaml` does not name under `environment:` (upload limits,
  rate limits, clip limits, and so on) never reached the container, even though
  `.env.example` told you to set it there. Every key in `.env` reaches it now. If your `.env`
  holds a value that was silently ignored, it takes effect after this upgrade: read your
  `.env` before you pull.
- **`SUPPORT_URL` and `REPORT_URL` are now read and checked** (#123). Each must be an `https`
  URL without credentials, or a path starting with one `/`, or the server refuses to boot
  (exit 78) and names the variable. If your environment or `.env` already sets either for
  another purpose, change or remove it before you upgrade.
- **New migrations run at the first boot**, with any earlier one your database has not seen:
  008 (clients, and `events.client_id` and `events.opened_at`) and 009 (the audit log).
  Migrations are not reversed, so back up first.
- **Uploads can be refused for two new reasons** (#105). With less than 1 GB free
  (`MIN_FREE_DISK_BYTES`) on the database or media volume, an upload gets
  `413 storage.boxFull`. With more than four uploads in flight at once
  (`MAX_CONCURRENT_UPLOAD_REQUESTS`), the next gets `429 upload.busy` and a `Retry-After`.
  `GET /api/ready` reports the disk margin under `checks.disk` and never fails on it.
- **An account that must change its password is stopped by the server** (#108), with
  `403 auth.passwordChangeRequired` on every `/api` route except `GET /api/auth/me`,
  `POST /api/auth/password` and `POST /api/auth/logout`. Only the web app stopped it before.
- **A taken slug answers `409 event.slugUnavailable`** and no longer echoes the slug;
  `event.slugTaken` is gone (#103). An API client that matched the old code must change.
  Event creation is also limited to 20 per account per hour
  (`EVENT_CREATION_RATE_LIMIT_PER_HOUR`).
- **The host dashboard's `usedBytes` now counts the clip sources still waiting in the queue**
  as well as the photographs (#117), so it can read higher than before while clips are queued.
  It is the figure an upload is checked against.
- **The server logs one line per request** (#104): the route pattern, never the raw URL,
  with status, duration and a request id. An unhandled error's stack trace is now logged in
  production too. On `SIGTERM` or `SIGINT`, `GET /api/ready` answers 503 at once and open
  event streams are told to reconnect in 2 seconds.
- **Two boot warnings, never refusals** (#109): production with no `PUBLIC_URL`, and
  production with a secure cookie and `TRUST_PROXY_HOPS=0`.

### Added

- **Operator groundwork, not reachable yet.** `SITE_ADMIN=off|on` (#95) switches on an
  operator namespace, `/api/site`; when `off`, every path under it answers exactly as a path
  nobody wrote. Behind it: clients as records, with ceilings (#113); events attached to a
  client, and `EVENT_CREATION=anyAccount|clientMembers` to say who may create one (#117);
  every ceiling enforced on every write path, a live window that closes an event, and a purge
  that is safe when a ceiling is unset (#121); and an append-only audit log, with
  `AUDIT_RETENTION_DAYS` (default 1095, never below 365) (#118). No HTTP route reaches the
  clients or the audit log yet.
- **Mail, optional** (#120). A `Mailer` port, a `NullMailer` that sends nothing and is the
  default, and an SMTP adapter on `nodemailer` (a new dependency) switched on by `SMTP_URL`
  and `MAIL_FROM`. No feature sends mail yet.
- **Operator identity and legal links** (#123). `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`,
  `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SUPPORT_URL` and `REPORT_URL`,
  all empty by default. When set they appear on `/about` and in the footers, the guest
  privacy notice names the operator, and guests get a link to report a content. A box that
  sets none of them looks as before.
- **Support links, optional** (#119). `DONATION_URL` and `BUDGET_URL`, empty by default: a
  link in the host footer and on `/about`, and a closable card on the page of a closed event.
- **Settings whose default is today's behaviour**: `MAX_EVENT_QUOTA_BYTES` (a ceiling on
  one event's quota, none by default) (#98); `EVENT_SLUG_SUFFIX`, `ALLOW_CUSTOM_SLUGS` and
  `JOIN_CODE_LENGTH` (#103); `MAX_QUEUED_CLIPS_PER_EVENT`, `MAX_STREAMS_PER_CLIENT`,
  `MAX_STREAMS_TOTAL`, `MAX_SUBSCRIBERS_PER_EVENT` and `SQLITE_SHUTDOWN_CHECKPOINT` (#109);
  `RETENTION_CAP_NOTICE_DAYS`, which only matters to a box with clients (#121). A test now
  fails when `env.ts` reads a key that `.env.example` does not document; its first run found
  `LOGIN_RATE_LIMIT_PER_MINUTE` and `REACTION_RATE_LIMIT_PER_MINUTE`.

### Security

- **ffmpeg and ffprobe no longer inherit the server's environment** (#100). They get `PATH`
  and a pinned `LANG`, and on Windows the few system variables the OS needs, so a crafted
  media file that compromises a decoder finds no `SESSION_SECRET`, `GUEST_TOKEN_SECRET` or
  `SMTP_URL`.

### Documentation, tests and dependencies

- Documentation drift fixed against the code, and the empty `ssl/` directory removed (#101).
- A CI check on the assignment of migration ids (#97).
- Dependencies: vite 8.3.1 (#106), ip-address 10.7.3 (#112), and the development group
  (#116).

## 2.0.0 (never tagged)

The rewrite of 1.0 on a hexagonal architecture, and everything merged before pull request
#95. Its history is in git.
