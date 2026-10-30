# Upgrading EventSlide

For the person who runs an EventSlide installation: what a version number promises, how to
move from one version to the next, how to go back, and how a change that will hurt you is
announced. It applies from 2.1.0: earlier builds of `main` do not carry the backup commands in
the image.

## The short version

- **Run a tagged release (`vX.Y.Z`), not the tip of `main`.** A break lands on `main` before
  it is tagged, and the tag is the point where it is written down.
- **Back up first, and take the archive off the machine.** Migrations only go forward, so once
  one has run, a backup is the only way back.
- **Not on the day of an event.** Going back restores the backup and loses whatever was
  uploaded after it.
- **Read the [CHANGELOG](../CHANGELOG.md) from your version to the one you want.** In a major
  release, `BREAKING` lists what stops working. In any release, "Behaviour changes to check
  before upgrading" lists what to look at before you pull.
- Then `git fetch --tags && git checkout vX.Y.Z && docker compose pull && docker compose up -d`.
  The steps are [below](#upgrading-with-docker), and the image they pull is
  [described here](#which-image-tag).

## What a version number promises

Versions are `MAJOR.MINOR.PATCH`.

- **A patch (`3.0.1`) fixes a bug** and changes nothing you could have relied on. Fixes are
  released as the next version, with no maintenance branch for an older minor, so the way to
  get one is to upgrade.
- **A minor (`3.1.0`) adds, and takes nothing away.** It may add settings (off, or at
  today's behaviour, until you set them), endpoints, screens and migrations. It may add a
  warning at boot about something a later major will change. It may mark something
  deprecated. It does not remove or rename anything listed below, and it does not refuse to
  start on a configuration that started before.
- **A major (`4.0.0`) is the only release that may break something.** It may remove or
  rename a thing on the list below, change what a default does to an existing installation,
  or refuse to start on a configuration that used to start. It is never silent: the CHANGELOG
  entry has a `BREAKING` section, [a section of this page](#upgrading-to-a-major) says what to
  change, and the commit that broke it is marked `feat!:` (or `fix!:`).

**What counts as breaking** is measured against what EventSlide promises you, which is:

- **The HTTP API under `/api`**, as [docs/API.md](API.md) §§1–8 writes it, including the
  `code` of every error. A client you wrote against it keeps working through every minor.
- **The settings**: their names, the values they accept and their defaults, as
  [`.env.example`](../.env.example) lists them, and the service and `/data` volume of
  [`compose.yaml`](../compose.yaml).
- **Your data.** Every upgrade carries your database and your photographs forward, and an
  archive taken by an older release restores into a newer one.
- **The operator commands**: `backup` (and its `--verify`), `restore` and `purge`, as
  `node dist/ops/scripts/<name>.js` in the image, and as `npm run backup`, `backup:verify`,
  `restore` and `purge` in a checkout.

**What is not promised**: how the web app looks or how its sentences are worded, the text of
a log line or of an error's `message` (this page quotes a few so that you can recognise them,
and is tested against the code, but their wording may change), and the layout of `src/`.
EventSlide is not published as a library today; the package is private.

### Defaults, refusals and data

A change that makes an existing installation behave differently arrives in two steps.

1. **A minor warns.** The server logs a warning at boot, and the CHANGELOG lists it under
   "Behaviour changes to check before upgrading". 3.0.0 introduced three such warnings, for a
   production box with no `PUBLIC_URL`, for one with a secure cookie and `TRUST_PROXY_HOPS=0`,
   and for `MAIL_FROM` set without `SMTP_URL`: they are warnings, and none stops the boot. A
   fourth says, in any environment, that `GUEST_SELF_DELETE_GRACE_SECONDS` does nothing: it is
   deprecated, and 4.0.0 removes it.
2. **The next major changes it, at the earliest.** A refusal to start is only ever added in a
   major, with its own `BREAKING` entry.

A new limit that can refuse a request which was accepted before is a change of default too:
it ships off, or waits for a major.

A default that **destroys data**, such as a retention period that deletes albums, goes one
step further. It starts as an opt-in, becomes the default only in a later major, and then
only for what is created after that: events that exist keep what they have.

**Deprecation.** Something that will be removed is first marked `### Deprecated` in the
CHANGELOG and, where the code can, logs a warning when it is used. It stays for at least one
minor release and 90 days, whichever is longer, and is removed only in a major.

**Security is the exception to the waiting, not to the numbering.** If keeping the old
behaviour keeps a vulnerability, it is not kept for a deprecation period. A fix that breaks
something on the list above is still a major, and its `BREAKING` entry says why there was no
warning first.

**This policy applies to every release after 2.1.0.** 2.1.0 and what came before were not held
to it, and its entry lists what it changed under "Behaviour changes to check before
upgrading": the error code `event.slugTaken` is gone, and an unset NODE_ENV now means
production, which refuses a boot without real secrets. A major would have carried both. 3.0.0
is the first release held to it.

## Migrations

A schema change is a numbered migration in `src/infrastructure/db/migrations/`.

- **They run at boot.** The server applies every pending migration, in order, each in its own
  transaction, before it opens its port. There is no migration command to run in the image.
  A release that carries migrations says so in its CHANGELOG entry. In a checkout,
  `npm run db:status` lists what is applied and what is pending, and `npm run db:migrate`
  applies them with readable output instead of waiting for `npm start`. `restore --dry-run`,
  run by the new version against the archive you have just taken, lists as a note the
  migrations it would have to apply to that database ("the archive predates this build").
- **They are append-only.** A migration that has been released is never edited and never
  renumbered. Each one is checksummed in the `schema_migrations` table, and the server
  refuses to start if a recorded migration differs from the code ("has changed since it was
  applied"). That matters to you only if you maintain a fork.
- **They are SQL, and only SQL.** The migrator runs the text of a migration and never any
  program code, so whatever happens to the rows you already have is what one SQL statement
  can compute. Where a feature needs a value those rows cannot be given, they keep a default
  or `NULL` and the feature treats that as "not set": photographs uploaded before missions
  existed are filed under no mission, for example.
- **They only go forward.** There is no `down`. Undoing a schema change on a live album is a
  data-loss operation, so the way back is a backup ([Going back](#going-back)).

Skipping minors is fine: a database two minors behind receives both sets of migrations in one
boot. **Do not skip a major.** Upgrade to the newest release of the major you are on first and
run it: its boot log and its "Behaviour changes to check before upgrading" entries are where a
change coming in the next major is flagged first. Then move to the next major, and read its
section below.

## Upgrading with Docker

From the directory holding `compose.yaml`. The checkout is what chooses the version:
`compose.yaml` of a release names the image of that release, `ghcr.io/irony42/eventslide:X.Y.Z`,
and `docker compose pull` fetches it. Nothing is built on your machine. To build the image from
the checkout anyway (a modified copy, a commit no release names), see
[Building the image yourself](#building-the-image-yourself), which changes step 4 and nothing else.

1. **Choose the moment**: between events, with nobody about to upload.
2. **Read the CHANGELOG** for every release between yours and the target. Your version is
   `version` in `GET /api/health`, except on 2.1.0, which reports `2.0.0` (see
   [Upgrading to 3.0](#upgrading-to-30)).
3. **Back up, verify, and take it off the volume.** The server stays up while you do.
   [README](../README.md#backups) has the reasoning and the variants. Keep the archive
   **outside the checkout**: it is the one directory you are about to `git checkout` in, and
   building the image from it ([below](#building-the-image-yourself)) would send an album-sized
   archive to Docker along with the source.

   ```bash
   mkdir -p "$HOME/eventslide-backups"
   docker compose exec eventslide node dist/ops/scripts/backup.js
   A=eventslide-2026-09-12T08-00-00Z   # the name it printed
   docker compose cp "eventslide:/data/backups/$A" "$HOME/eventslide-backups/" &&
     docker compose run --rm -v "$HOME/eventslide-backups/$A:/restore:ro" eventslide \
       node dist/ops/scripts/backup.js --verify /restore
   ```

   Keep your `.env` with the archive: the secrets are not in it.

4. **Get the new version and start it.**

   ```bash
   git fetch --tags && git checkout vX.Y.Z
   docker compose pull
   docker compose up -d
   ```

   `pull` fetches the image that `compose.yaml` of that release names; `up -d` then recreates
   the container on it, and keeps the data volume. To check that the image is the one this
   repository published, see [Checking the signature](IMAGE-SOURCES.md#checking-the-signature).

   If `git checkout` refuses because you edited `compose.yaml`, `git stash` the edit, check
   out, and apply it again by hand. A `compose.override.yaml` avoids this next time, with one
   catch: Compose adds to a list such as `ports:` and does not replace it. The data volume
   survives the recreation. Never add `-v` to a `docker compose down`: that deletes it.

5. **Watch the first boot.** `docker compose logs --tail 100 eventslide` shows an
   `applied migrations` line with their ids when there were any, and then the listening
   line. A refused configuration exits with code 78 and lists every problem at once. A
   migration that fails says `failed and was rolled back`, and that is only the one that
   failed: the ones before it in the same boot stay applied. Either way the container
   restarts and fails again until you fix it or go back.
6. **Check it.** `GET /api/health` answers with the new `version`, `GET /api/ready` answers
   200, and `/admin` signs you in. Open a test event's wall before you rely on it.

Once the upgrade has held, delete the copy on the volume, naming the archive again so that an
empty variable cannot widen the command, and keep the one off the machine:

```bash
A=eventslide-2026-09-12T08-00-00Z
docker compose exec eventslide rm -r "/data/backups/${A:?name the archive}"
```

### Without Docker

`npm run` does not read `.env`, so `backup`, `restore` and `db:migrate` need `DATABASE_PATH`
and `MEDIA_ROOT` in the environment, as the server has them.

```bash
npm run backup                 # then copy the archive somewhere that is not this machine
# stop the server, then:
git fetch --tags && git checkout vX.Y.Z
npm ci && npm run build
npm start                      # applies the migrations, like the image does
```

## Going back

What you can do depends on how far the new version got.

- **It never booted**: the image would not pull, or it stopped on a refused configuration
  before it reached the database. Nothing on disk changed. `git checkout <old-tag>` and
  `docker compose up -d`, after `docker compose pull` if the old image is no longer on the
  machine. An old tag before 3.0.0 names an image that was never published: its `compose.yaml`
  builds it, so `docker compose up -d --build` is what it takes.
- **It booted, or began to.** Check out the old tag and start the old version on the data
  (`git checkout <old-tag>`, then the same as above). It tells you which case you are in:
  - **It refuses with "downgrading is not supported."** The new version applied a migration,
    including when it applied some and then failed, and the old one will not run on a database
    that holds a migration it does not know. It refuses before it changes your data. The way
    back is the archive from step 3, restored **by the version that took it**, with the
    server stopped:

    ```bash
    git checkout <old-tag>              # the version you came from
    docker compose pull                 # before 3.0.0, `docker compose build` instead
    docker compose stop eventslide
    A=eventslide-2026-09-12T08-00-00Z   # the archive from step 3
    docker compose run --rm -v "$HOME/eventslide-backups/$A:/restore:ro" eventslide \
      node dist/ops/scripts/restore.js /restore --dry-run
    docker compose run --rm -v "$HOME/eventslide-backups/$A:/restore:ro" eventslide \
      node dist/ops/scripts/restore.js /restore --force
    docker compose up -d
    ```

    **Everything uploaded since the backup is gone**, and `--force` overwrites what is there
    now. Without Docker, the same is `git checkout <old-tag> && npm ci && npm run build`, then
    `npm run restore -- <archive> --force` with the server stopped, then `npm start`.

  - **It starts.** No migration was applied, and the schema is as the old version knows it.
    That is all that is promised: the new version may have written values the old one handles
    badly, so if anything looks wrong, restore the archive anyway.

The version that restores has to be the one that took the archive, or a newer one: an older
version refuses an archive taken by a newer release ("Restore it with the version that
produced it"). Restoring an old archive with the **new** version does something different. It
brings the restored database forward to the new version, which is how you move an installation
to a new machine, and is not a way back.

## Which image tag

`compose.yaml` runs `ghcr.io/irony42/eventslide:X.Y.Z` for the release you have checked out.
Each release is published under these tags, for `linux/amd64` and `linux/arm64`:

| Tag          | Follows                                                    | Use it                                         |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| `3.0.1`      | that release, and nothing else                             | **by default**: it is what `compose.yaml` says |
| `3.0`        | the newest patch of 3.0                                    | if you want fixes without choosing the moment  |
| `3`          | the newest minor and patch of 3, **never the next major**  | the same, wider                                |
| `3.1.0-rc.1` | that release candidate, and no other tag ever points at it | to try a release before it is one              |

There is no `latest`, on purpose: it would cross a major, and a major is the release that may
break something, so it is one you choose. A floating tag (`3.0`, `3`) moves under you the next
time you `docker compose pull`, **and the migrations of the release it moved to run at the next
start, in one direction only**: it is a way to upgrade without deciding when, so keep it out of
the days around an event, and take the backup of step 3 first all the same.

To change the tag without editing `compose.yaml` (which `git checkout` would then refuse to
move), put it in a `compose.override.yaml` next to it:

```yaml
services:
  eventslide:
    image: ghcr.io/irony42/eventslide:3.0
```

A tag names a release. The thing that cannot change under you is the **digest**:
`image: ghcr.io/irony42/eventslide:3.0.1@sha256:…` runs exactly that image or nothing, and it
is what the signature belongs to ([IMAGE-SOURCES.md](IMAGE-SOURCES.md#checking-the-signature)). The
release workflow can be run again for a tag whose release failed half way, which pushes that
tag again; a release that completed is not pushed twice.

## Building the image yourself

For a copy you modified, a commit that no release names, or a machine that cannot reach
`ghcr.io`. `compose.build.yaml` swaps the published image for a build of the checkout, and every
other line of `compose.yaml` (the ports, the volume, the hardening, the settings) stays what it is:

```bash
git fetch --tags && git checkout vX.Y.Z   # or any commit
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Give both files to every later command as well (`logs`, `exec`, `down`, `run`), or Compose reads
`compose.yaml` alone and looks for the published image. What you build is named
`eventslide:X.Y.Z`, so that it is never taken for the signed one, and it is not signed. If you
changed the code and other people use your copy, the AGPL asks you to offer them your source:
set `SOURCE_CODE_URL` ([licensing FAQ](LICENSING-FAQ.md)).

## How a break is announced

In the order you meet it:

1. **Before, where it can be.** A minor logs a warning at boot and lists the change under
   "Behaviour changes to check before upgrading", or marks the thing `### Deprecated`. That is
   how a default, a refusal or a removal is flagged. It is not everything: a break to the HTTP
   API has no warning at boot and is first announced in the release that makes it.
2. **At the release.** The CHANGELOG entry has a `### BREAKING` section,
   [this page](#upgrading-to-a-major) gets a section for the major, and the release notes on
   GitHub link to both. Read the `BREAKING` section before you upgrade to a major, whether or
   not anything warned you.
3. **Where to hear.** Watch the repository's releases on GitHub (Watch, Custom, Releases).

A minor or a patch never has a `BREAKING` section, and a major always does.
`scripts/changelogPolicy.test.ts` holds the CHANGELOG to that.

## Upgrading to a major

Each major gets a section after this one, titled `Upgrading to N.0`, written in the pull
request that breaks something and kept afterwards. It says who is affected, what to change and
in which order, and how to tell it worked.

## Upgrading to 3.0

3.0.0 is the AGPL release and the first major held to this policy. If you run EventSlide
unmodified the licence asks nothing more of you ([licensing FAQ](LICENSING-FAQ.md)); what can
stop an existing installation is the `BREAKING` section of the [CHANGELOG](../CHANGELOG.md), and
the steps below are that list in the order you meet it. Read it once before you start: it says
why each change was made and what there was no warning for.

**Who is affected.** Everyone who upgrades from 2.x. Go in this order.

1. **Be on 2.1.0, and back up with it.** The newest release of the 2.x line carries the Docker
   backup commands the steps [above](#upgrading-with-docker) use, and it is the version that
   can restore the archive if you go back: 3.0.0 applies migrations 008, 009, 010, 011, 012, 013 and 014, and
   2.1.0 refuses a database that holds them ("downgrading is not supported"). Migrations 013 and 014
   build indexes, which takes a moment on a large database: the first boot is not instant. A build of
   2.1.0 reports `2.0.0` in `GET /api/health`, in its image tag and in its backup manifest,
   because the tag was cut before `package.json` was bumped: `git describe --tags --match 'v*'`
   in your checkout says which release you are on.
   - **From 2.0.0, make the hop to 2.1.0 first, and treat it as an upgrade of its own.** The
     2.0.0 image has no backup command, and 2.1.0 applies migrations 002 to 007, which 2.0.0
     refuses to run on. Stop the container and copy the data volume (or run `npm run backup`
     from a checkout, [below](#without-docker)) before you start 2.1.0, and take the Docker
     backup again once it runs.
2. **Read your `.env`, and check Docker Compose.** `compose.yaml` now needs Docker Compose
   2.24 or later (`docker compose version`), and passes every key of `.env` to the container,
   where it used to pass only the few the file names. Remove each line you did not mean to
   apply. Look first at `DATABASE_PATH` and `MEDIA_ROOT`: the values in `.env.example`
   (`./data/eventslide.sqlite`, `./media`) override the `/data` paths the image sets, and
   point the server away from your volume. `PORT` too: `compose.yaml` publishes `${PORT:-4300}:4300`
   and the server now listens on the `PORT` of `.env` inside the container, so a `PORT=8080` that only
   meant "publish on 8080" leaves the mapping pointing at a port nothing listens on. Leave it out of
   `.env`, or change the mapping. If you copied the file before 3.0.0, it also sets
   `GUEST_SELF_DELETE_GRACE_SECONDS`, which nothing ever read (the grace is a setting of each
   event): it is deprecated, 3.0.0 warns at boot that it does nothing, and you can remove it.
3. **Check `PUBLIC_URL`.** It is the address in every join link, QR code and mail, and four
   checks of it are new. In production, a plain `http` address is refused whatever the case of
   its scheme (`HTTP://photos.example.com`); the one exemption is the host `localhost`, and
   nothing that starts with it (`http://localhost.example.com` is refused). Whatever the
   environment, a value is refused if it ends in a space or a tab, has a tab or a line break
   inside it, carries a user name or a password, or has a `?` or a `#` anywhere, even a bare
   one: write a `?` or a `#` that belongs in a path prefix as `%3F` or `%23`. The boot exits
   with code 78, names `PUBLIC_URL` and never repeats the value. What boots is handed on
   in its canonical form: `HTTPS://Photos.Example.com:443/` becomes `https://photos.example.com`,
   and a path prefix is kept. With no `PUBLIC_URL` in production the box still boots, with a
   warning.
4. **Look at the settings.** The server checks the new ones at boot and exits with code 78 on a
   value that does not fit, naming the variable, so if your environment already sets one of these
   names for another purpose, change or remove it first. An empty value counts as not set, except
   for `REQUIRE_OPERATOR_2FA` and the eight numeric limits (the rows of the table below from
   `MIN_FREE_DISK_BYTES` to `RETENTION_CAP_NOTICE_DAYS`), which it stops. [`.env.example`](../.env.example) says
   what each is for.

   | Setting                                                                                 | Default      | Accepts                                                                                                 |
   | --------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
   | `SUPPORT_URL`, `REPORT_URL`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL` | none         | an `https` URL without credentials, or a path that starts with one `/`                                  |
   | `LEGAL_TERMS_VERSION`                                                                   | none         | at most 32 letters, digits, `.`, `_` or `-`, starting with a letter or a digit; needs `LEGAL_TERMS_URL` |
   | `SOURCE_CODE_URL`, `DONATION_URL`, `BUDGET_URL`                                         | none         | an `https` URL without credentials                                                                      |
   | `SOURCE_REF`                                                                            | none         | a git tag, branch or commit (the image's build argument, for an unmodified upstream tag)                |
   | `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`                                               | none         | a name of at most 100 characters; one address, which needs the name                                     |
   | `SMTP_URL`, `MAIL_FROM`                                                                 | none         | the forms `.env.example` shows; `SMTP_URL` needs `MAIL_FROM`                                            |
   | `EVENT_CREATION`                                                                        | `anyAccount` | `anyAccount` or `clientMembers` (which needs `SITE_ADMIN=on`)                                           |
   | `OPERATOR_RESET_LINKS`                                                                  | `mailOnly`   | `mailOnly` or `copyLinkWithOwnerApproval` (which needs `SITE_ADMIN=on`); case matters                   |
   | `AUDIT_RETENTION_DAYS`                                                                  | `365`        | a whole number of days, 365 to 3650                                                                     |
   | `MFA_ENCRYPTION_KEY`                                                                    | none         | the form `.env.example` shows; never equal to `SESSION_SECRET` or `GUEST_TOKEN_SECRET`                  |
   | `REQUIRE_OPERATOR_2FA`                                                                  | `false`      | `true`, `false`, `1` or `0`; `true` needs a valid `MFA_ENCRYPTION_KEY` and `SITE_ADMIN=on`              |
   | `MIN_FREE_DISK_BYTES`                                                                   | `1000000000` | a positive whole number                                                                                 |
   | `MAX_CONCURRENT_UPLOAD_REQUESTS`                                                        | `4`          | a whole number, 1 to 1000                                                                               |
   | `MAX_QUEUED_CLIPS_PER_EVENT`                                                            | `20`         | a whole number, 1 to 500                                                                                |
   | `GUEST_WRITE_RATE_LIMIT_PER_MINUTE`                                                     | `300`        | a whole number, 1 to 6000                                                                               |
   | `MAX_STREAMS_PER_CLIENT`, `MAX_STREAMS_TOTAL`, `MAX_SUBSCRIBERS_PER_EVENT`              | 12, 500, 200 | whole numbers, up to 10000, 100000 and 10000                                                            |
   | `RETENTION_CAP_NOTICE_DAYS`                                                             | `30`         | a whole number, 1 to 365                                                                                |
   | `SQLITE_SHUTDOWN_CHECKPOINT`                                                            | `truncate`   | `truncate`, `passive` or `none`                                                                         |
   | `NEW_CLIENT_MAX_EVENTS`, `NEW_CLIENT_MAX_EVENTS_PER_PERIOD`                             | none         | a positive whole number; needs `SITE_ADMIN=on`                                                          |
   | `NEW_CLIENT_MAX_TOTAL_BYTES`, `NEW_CLIENT_MAX_EVENT_QUOTA_BYTES`                        | none         | a positive whole number; needs `SITE_ADMIN=on`; the second is at most `MAX_EVENT_QUOTA_BYTES`           |
   | `NEW_CLIENT_MAX_RETENTION_DAYS`, `NEW_CLIENT_MAX_LIVE_DAYS`                             | none         | a whole number, 1 to 3650 and 1 to 365; needs `SITE_ADMIN=on`                                           |
   | `NEW_CLIENT_CLIPS_ALLOWED`                                                              | none         | `true`, `false`, `1` or `0`; needs `SITE_ADMIN=on`                                                      |

   Three more things stop the boot. A whole number above 9007199254740991 (2^53 - 1) is refused
   for every setting that takes one, where it used to be rounded: `MAX_EVENT_QUOTA_BYTES=99999999999999999999`,
   written to mean "no limit", booted before. Leave it empty instead. Any other name that starts with
   `NEW_CLIENT_` is refused, because a misspelt ceiling would leave every new client with none. And
   the pairs in the table (a version without its address, a contact address without its name, `SMTP_URL`
   without `MAIL_FROM`, a client ceiling or `clientMembers` or a second factor required without
   `SITE_ADMIN=on`) are named together in one list.

   Four things only warn: a production box with no `PUBLIC_URL`, one with a secure cookie and
   `TRUST_PROXY_HOPS=0`, one with `MAIL_FROM` and no `SMTP_URL`, and any box that still sets the
   deprecated `GUEST_SELF_DELETE_GRACE_SECONDS`.

5. **Check the scripts and clients that call the API.**
   - An account that must change its password gets `403 auth.passwordChangeRequired` on every
     route but the three that let it see who it is, change the password and sign out.
   - After `POST /api/auth/password`, the other sessions of the account are signed out and
     the caller's `es_csrf` cookie is new: read it again, or the next write gets
     `403 request.csrfMismatch`.
   - An upload can now get `413 storage.boxFull` (less than `MIN_FREE_DISK_BYTES` free, or
     the free space cannot be read) or `429 upload.busy` (more than
     `MAX_CONCURRENT_UPLOAD_REQUESTS` in flight). A video clip can get `429 clip.queueFull`
     once its event has `MAX_QUEUED_CLIPS_PER_EVENT` clips queued, which is 20 whatever
     `MAX_QUEUED_CLIPS` says.
   - Signing in is throttled per account: after five failures from one network the next
     attempt gets `429 rate.limited` with a `Retry-After`, up to 15 minutes. Back off on a
     wrong password instead of retrying at once. A browser that has signed in before presents the
     `es_device` cookie the sign-in sets and is counted on its own.
   - **A moderator is invited by link.** `POST /api/events/:slug/moderators` takes `{ "email" }`
     and answers `201` with `status`, `expiresAt` and, when no mail went out (the box has no relay, or
     the relay refused it), a `link`; it creates no account. An account may write 30 invitations an hour
     (`429 rate.limited`). A script that sent `temporaryPassword` or `displayName` now gets
     `400 request.invalid`, and one that read `created` or `userId` finds neither. Stop typing a
     password, give the person the `link` (or let the mail carry it) and they make their own account
     when they open it. Sending a name and a password for an address that already has an account is
     `409 invitation.signInRequired`: that account signs in and accepts with an empty body; a dead one is `404 invitation.notFound`. An address is written
     to at most five times an hour: the sixth gets `429 invitation.tooManyForAddress`. Your own
     reverse proxy must not log `/invite/*`, `/api/invitations/*` or `/password/reset/*`, which carry a
     token.
   - **The server runs on Express 5.** A path with a doubled slash no longer reaches a route:
     a request for `/api//health` answers 404, so a base URL that ends in `/api/` joined to a path that starts with
     `/` breaks, in a script or in a probe. A body with a number above 9007199254740991 (a quota,
     a link lifetime) is `400 request.invalid`. The other differences a client or a proxy can see are
     listed in the CHANGELOG, under "Behaviour changes to check before upgrading".
6. **If the box runs for other people (`SITE_ADMIN=on`), decide three things.** `/api/site/*`, which
   answered nothing past its gate in 2.1.0, now carries the operator's API, and `/api/client/*` and
   `GET /api/me/limits` are mounted beside it: the CHANGELOG lists what they do, and every change an
   operator makes asks for a fresh confirmation of the person (`403 auth.stepUpRequired`). The operator
   is the first account the box ever had: 2.1.0 gave it the role, and it grants nothing inside an event.
   It works from the console, `/admin/site`.
   - **Password resets.** An operator's reset is mailed to the account and never shown to the
     operator, so a box with no `SMTP_URL` cannot reset one (`409 reset.mailerRequired`). Set the relay
     (`SMTP_URL` and `MAIL_FROM`), or choose `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`, which
     hands the operator a link only after another owner of the account's client approved that request.
   - **A second factor for the operator.** Set `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`; a value of
     its own, kept in `.env` or a secrets manager, with a copy beside your backups: the archive does not hold it), restart, enrol the
     operator on `/admin/security`, and only then set `REQUIRE_OPERATOR_2FA=true`, so that the operator
     has a factor before the gate asks for one. Lose the key and an enrolled operator can sign in only
     with a recovery code.
   - **What a new client starts with.** `EVENT_CREATION` and the `NEW_CLIENT_*` ceilings are optional and
     off until you set them; a client that exists is never changed by them.
7. **Decide about the licence.** If you modify EventSlide and other people use your version
   over a network, publish your source and set `SOURCE_CODE_URL` to it. Unmodified, there is
   nothing to do.

Then take the steps of [Upgrading with Docker](#upgrading-with-docker), or
[without](#without-docker), with `vX.Y.Z` as `v3.0.0`.

**The image comes from the registry now.** Up to 2.1.0, `docker compose up -d --build` built it on
your machine and named it `eventslide:2.0.0`. From 3.0.0, `compose.yaml` pulls
`ghcr.io/irony42/eventslide:3.0.0`, so step 4 is `pull` and `up -d`; the data volume is the same
one. The old local image stays on disk until you remove it (`docker image rm eventslide:2.0.0`),
and you will need it only to go back to 2.1.0.

**How to tell it worked.** The first boot logs `applied migrations` with the ids 8 to 14
(only the ones your database lacked) and then the listening line; `GET /api/health` answers
`"version": "3.0.0"` and `GET /api/ready` answers 200. If the boot exits with code 78, the log
names the setting to fix. If anything else looks wrong, go back as [described above](#going-back):
restore the archive you took before the upgrade, with 2.1.0.

## Upgrading to 3.1

3.1.0 is a minor release: it adds and breaks nothing the policy above promises to keep, so there
is no `BREAKING` section and nothing to change in `.env`. This section is here because it changes
how every screen looks, and you will want to see that before an event rather than during one.

**Who is affected.** Everyone who upgrades from 3.0.x.

1. **Back up with the version you run now**, as always ([above](#upgrading-with-docker)). 3.1.0
   adds no migration: your database keeps the schema of 3.0.0, and the new data (an event's
   ambiance, the host's own venue photograph) lives in fields of the settings JSON that the older
   build does not read.
2. **Take the steps of [Upgrading with Docker](#upgrading-with-docker)**, or
   [without](#without-docker), with `vX.Y.Z` as `v3.1.0`. The image is
   `ghcr.io/irony42/eventslide:3.1.0`.
3. **Open an event you care about** on a phone, on the wall and in the console. Every event now wears
   an ambiance, and an event that never chose one wears the Guinguette, which is also the new look of
   the console and the sign-in page. An event that had the default accent shows the ambiance's own
   accent where it showed violet. The host can choose another ambiance in the event's settings.
4. **If a script writes an event's theme** (`PATCH /api/events/:slug/settings` with a `theme`), it must
   now send `ambiance` too; a theme without it is refused with `400 request.invalid`.
5. **If you restore a backup,** the host's venue photographs are in it with the media. A backup taken
   by 3.0.x has none, which is not an error.

**How to tell it worked.** The first boot logs no migration, and `GET /api/health` answers
`"version": "3.1.0"` and `GET /api/ready` answers 200. If anything looks wrong, go back as
[described above](#going-back): restore the archive you took before the upgrade.

## Upgrading to 3.2

3.2.0 is a minor release: it breaks nothing the policy above promises to keep, so there
is no `BREAKING` section and nothing has to change in `.env`. This section is here because it changes
what the guest upload and reaction limits count, and adds four settings.

**Who is affected.** Anyone who set `UPLOAD_RATE_LIMIT_PER_MINUTE`, `REACTION_RATE_LIMIT_PER_MINUTE`,
`JOIN_RATE_LIMIT_PER_MINUTE` or `MAX_CONCURRENT_UPLOAD_REQUESTS`, and everyone who hosts a room behind
one Wi-Fi network.

1. **Back up with the version you run now**, as always ([above](#upgrading-with-docker)). 3.2.0
   adds no migration: your database keeps the schema of 3.0.0.
2. **Take the steps of [Upgrading with Docker](#upgrading-with-docker)**, or
   [without](#without-docker), with `vX.Y.Z` as `v3.2.0`. The image is
   `ghcr.io/irony42/eventslide:3.2.0`.
3. **`UPLOAD_RATE_LIMIT_PER_MINUTE` (12) and `REACTION_RATE_LIMIT_PER_MINUTE` (30) now count per
   guest and event, not per client address and event.** Through 3.1 a whole venue behind one public
   address shared twelve sends and thirty reactions a minute. The default figures are unchanged; what
   they bound is one guest.
4. **Two new settings bound the address instead**, as a flood ceiling checked before the guest is
   identified: `UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE` (default 300) and
   `REACTION_RATE_LIMIT_PER_IP_PER_MINUTE` (default 600), each a whole number from 1 to 6000. Left unset,
   each is raised to the per-guest figure if you set that higher, so a box that raised the old
   per-address figure is never tightened by the upgrade.
5. **`JOIN_RATE_LIMIT_PER_MINUTE` defaults to 200** (it was 20). Each guest costs two requests (the lookup
   and the join). At 200 a minute one address still needs about ten years to try every code of the
   default length. A value you set yourself is kept: an override of `JOIN_RATE_LIMIT_PER_MINUTE=20`
   copied from `.env.example` is worth removing before an event with more than ten guests arriving
   together.
6. **Upload slots are counted per event, after the guest is identified.** `MAX_CONCURRENT_UPLOAD_REQUESTS`
   (default 4) still bounds the whole box, because every upload in flight holds memory. A request
   with no valid guest token no longer takes a slot, and one event can hold all but one of them: the
   new `MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT` defaults to one less than the box-wide figure (3 of
   4), at least 1, and the boot refuses a value above `MAX_CONCURRENT_UPLOAD_REQUESTS`. An event that
   asks for a fourth slot while its three are busy gets the same `429 upload.busy` as before.
7. **A body that does not finish arriving gives its slot back.** The new `UPLOAD_BODY_TIMEOUT_SECONDS`
   (default 600, a whole number from 1 to 86400) ends a photo or clip upload whose body is not fully
   received in time with `408 upload.timedOut` and closes the connection; the guest sends it again. If
   a reverse proxy sits in front, give it a body read timeout above this figure, so that the app
   answers first.

No rate limit became tighter. Items 6 and 7 are the only ones that can refuse a request 3.1 accepted:
an event alone on a box now gets three upload slots instead of four, and an upload still arriving
after ten minutes is refused. Neither needs a change in `.env`; raise either setting if your events
need more.

**How to tell it worked.** The first boot logs no migration, and `GET /api/health` answers
`"version": "3.2.0"` and `GET /api/ready` answers 200. If the boot exits with code 78, the log names
the setting to fix (a `MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT` above `MAX_CONCURRENT_UPLOAD_REQUESTS`,
for instance). If anything else looks wrong, go back as [described above](#going-back): restore the
archive you took before the upgrade.

## Upgrading to 3.3

3.3.0 is a minor release: it breaks nothing the policy above promises to keep, so there is no
`BREAKING` section and nothing has to change in `.env`. This section is here because it adds two
migrations, changes a default, and because the host of a suspended client now sees less than it did.

**Who is affected.** Everyone who upgrades from 3.2.x (the migrations), anyone who never set
`AUDIT_RETENTION_DAYS`, and every box with `SITE_ADMIN=on` (the new operator routes, the suspension change
and the account self-erasure).

1. **Back up with the version you run now**, as always ([above](#upgrading-with-docker)). 3.3.0
   applies **migration 015**, which adds three nullable columns (`photos.taken_down_at`,
   `events.taken_down_at`, `events.purge_held_at`) and two partial indexes. No row changes. A 3.2.x
   build still reads the database, and ignores the columns, which means it would **serve again**
   whatever the operator had taken down: restore the archive you took, rather than running 3.2.x on
   a migrated database, if you go back.
2. **Take the steps of [Upgrading with Docker](#upgrading-with-docker)**, or
   [without](#without-docker), with `vX.Y.Z` as `v3.3.0`. The image is
   `ghcr.io/irony42/eventslide:3.3.0`.
3. **New operator routes** (`SITE_ADMIN=on` only, behind the operator's second factor and a fresh
   step-up, [API.md §1](API.md)): take a photograph or a whole event down by its id, put it back,
   hold an event's purge and release the hold. Each needs a written reason and writes one line in
   the audit log that is not in the client's own trail. A held event is skipped by the retention
   sweep and is not purged, nor has a photograph deleted, by its host or its guests.
4. **A suspended client's members no longer read photographs.** Until 3.2 the owner and moderators of
   a suspended client kept reading their photographs (the grid, the moderation queue, the album
   download and the media route); they now get `403 client.suspended` on those. They keep the
   dashboard, the settings, the counts and the audit trail. Resuming the client restores everything.
5. **Migration 016 adds the proof that an account accepted the terms of use**: `users.terms_version` and
   `users.terms_accepted_at`, and copies into them the latest acceptance still present in the audit log.
   Nothing is lost and no setting is needed; a box that sets no `LEGAL_TERMS_URL` records nothing and keeps
   the columns empty.
6. **`AUDIT_RETENTION_DAYS` now defaults to 365** (it was 1095). The value was already the floor, and it is
   what the hosted instance runs. **A box that never set it will, at the first retention sweep after the
   upgrade, delete audit lines older than a year.** If you need to keep them longer (the privacy policy you
   publish must then say so), set `AUDIT_RETENTION_DAYS=1095` in `.env` before you upgrade. A value you set
   yourself is kept. A box that left it unset and holds older rows logs one warning naming
   `AUDIT_RETENTION_DAYS` at boot, before the first sweep.
7. **With `SITE_ADMIN=on`, an account can delete itself**: `POST /api/auth/account/delete` and an entry
   "Supprimer mon compte" in the account menu, behind the password (and the authenticator's code when there
   is one), with the same refusals as the operator's route (an account that still owns an event is refused).
8. **Nothing else changes for a self-hosted box with `SITE_ADMIN=off`**: the routes are not mounted and no
   client is ever suspended.

**How to tell it worked.** The first boot logs migrations 015 and 016 and `GET /api/health` answers
`"version": "3.3.0"`, and `GET /api/ready` answers 200. If anything looks wrong, go back as
[described above](#going-back): restore the archive you took before the upgrade.
