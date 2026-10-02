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
- Then `git fetch --tags && git checkout vX.Y.Z && docker compose up -d --build`. The steps are
  [below](#upgrading-with-docker).

## What a version number promises

Versions are `MAJOR.MINOR.PATCH`.

- **A patch (`2.1.1`) fixes a bug** and changes nothing you could have relied on. Fixes are
  released as the next version, with no maintenance branch for an older minor, so the way to
  get one is to upgrade.
- **A minor (`2.2.0`) adds, and takes nothing away.** It may add settings (off, or at
  today's behaviour, until you set them), endpoints, screens and migrations. It may add a
  warning at boot about something a later major will change. It may mark something
  deprecated. It does not remove or rename anything listed below, and it does not refuse to
  start on a configuration that started before.
- **A major (`3.0.0`) is the only release that may break something.** It may remove or
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
   "Behaviour changes to check before upgrading". 3.0.0 introduced two such warnings, for a
   production box with no `PUBLIC_URL`, and for one with a secure cookie and
   `TRUST_PROXY_HOPS=0`: both are warnings, and neither stops the boot.
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

From the directory holding `compose.yaml`. Today the image is built from the tag you check
out; no prebuilt image is published.

1. **Choose the moment**: between events, with nobody about to upload.
2. **Read the CHANGELOG** for every release between yours and the target. Your version is
   `version` in `GET /api/health`.
3. **Back up, verify, and take it off the volume.** The server stays up while you do.
   [README](../README.md#backups) has the reasoning and the variants. Keep the archive
   **outside the checkout**: the next step builds from that directory, and Docker would send
   an album-sized archive along with the source.

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
   docker compose up -d --build
   ```

   If `git checkout` refuses because you edited `compose.yaml`, `git stash` the edit, check
   out, and apply it again by hand. A `compose.override.yaml` avoids this next time, with one
   catch: Compose adds to a list such as `ports:` and does not replace it. The data volume
   survives the rebuild. Never add `-v` to a `docker compose down`: that deletes it.

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

- **It never booted**: the build failed, or it stopped on a refused configuration before it
  reached the database. Nothing on disk changed. `git checkout <old-tag>` and
  `docker compose up -d --build`.
- **It booted, or began to.** Check out the old tag and start the old version on the data
  (`git checkout <old-tag>`, then `docker compose up -d --build`). It tells you which case you
  are in:
  - **It refuses with "downgrading is not supported."** The new version applied a migration,
    including when it applied some and then failed, and the old one will not run on a database
    that holds a migration it does not know. It refuses before it changes your data. The way
    back is the archive from step 3, restored **by the version that took it**, with the
    server stopped:

    ```bash
    git checkout <old-tag>              # the version you came from
    docker compose build                # skip if `docker image ls eventslide` lists its tag
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
stop an existing installation is the `BREAKING` section of the [CHANGELOG](../CHANGELOG.md).

**Who is affected.** Everyone who upgrades from 2.x. Go in this order.

1. **Be on 2.1.0, and back up with it.** From 2.0.0, upgrade to 2.1.0 first and run it: it is
   the newest release of the 2.x line, it carries the Docker backup commands the steps
   [above](#upgrading-with-docker) use, and it is the version that can restore the archive if
   you go back. 3.0.0 applies migrations 008, 009 and 010, and 2.1.0 refuses a database that
   holds them ("downgrading is not supported"). A build of 2.1.0 reports `2.0.0` in
   `GET /api/health`, in the image tag and in its backup manifest, because the tag was cut
   before `package.json` was bumped: `git describe --tags` in your checkout says which release
   you are on.
2. **Read your `.env`.** With Docker, `compose.yaml` now passes every key of it to the
   container, where it used to pass only the few the file names. Remove each line you did not
   mean to apply. Look first at `DATABASE_PATH` and `MEDIA_ROOT`: the values in
   `.env.example` (`./data/eventslide.sqlite`, `./media`) override the `/data` paths the image
   sets, and point the server away from your volume.
3. **Look for the names of the new settings.** The server now checks them at boot and exits
   with code 78 on a value that does not fit, naming the variable. If your environment already
   sets one of them for another purpose, change or remove it: `SUPPORT_URL`, `REPORT_URL`,
   `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SOURCE_CODE_URL`,
   `DONATION_URL`, `BUDGET_URL`, `SOURCE_REF`, `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`,
   `SMTP_URL`, `MAIL_FROM`, `EVENT_CREATION` and `AUDIT_RETENTION_DAYS`. The CHANGELOG says
   what each accepts.
4. **Check the scripts and clients that call the API.**
   - An account that must change its password gets `403 auth.passwordChangeRequired` on every
     route but the three that let it change the password and leave.
   - After `POST /api/auth/password`, the other sessions of the account are signed out and
     the caller's `es_csrf` cookie is new: read it again, or the next write gets
     `403 request.csrfMismatch`.
   - An upload can now get `413 storage.boxFull` (less than `MIN_FREE_DISK_BYTES` free) or
     `429 upload.busy` (more than `MAX_CONCURRENT_UPLOAD_REQUESTS` in flight).
   - Signing in is throttled per account: after five failures from one network the next
     attempt gets `429 rate.limited` with a `Retry-After`, up to 15 minutes. Back off on a
     wrong password instead of retrying at once.
5. **Decide about the licence.** If you modify EventSlide and other people use your version
   over a network, publish your source and set `SOURCE_CODE_URL` to it. Unmodified, there is
   nothing to do.

Then take the steps of [Upgrading with Docker](#upgrading-with-docker), or
[without](#without-docker), with `vX.Y.Z` as `v3.0.0`.

**How to tell it worked.** The first boot logs `applied migrations` with the ids 8, 9 and 10
(only the ones your database lacked) and then the listening line; `GET /api/health` answers
`"version": "3.0.0"` and `GET /api/ready` answers 200. If the boot exits with code 78, the log
names the setting to fix. If anything else looks wrong, go back as [described above](#going-back):
restore the archive of step 1 with 2.1.0.
