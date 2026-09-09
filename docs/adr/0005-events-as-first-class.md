# ADR 0005 — Model the event as a first-class aggregate

## Status

Accepted. Supersedes the `partyId` string of 1.0. Paths refer to the 2.0 layout
([CLAUDE.md](../../CLAUDE.md) §4); items marked **(planned)** are designed here, not built.

## Date

2026-09-09

## Context

In 1.0 an "event" was a free-text string. No record of it existed anywhere.

| 1.0 fact                                                                                                             | Where                                 | Consequence                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `partyId TEXT NOT NULL` on `users` and `photos`, no `events` table                                                   | `src/database.ts`                     | No owner, no settings, no lifecycle, no quota, nothing to query                                    |
| `parsePartyName` accepts any `/^[a-zA-Z0-9_-]{1,64}$/`, and multer's `destination` then `mkdirSync`s `photos/<name>` | `src/pictureStorage.ts`               | Any string is a valid event, and one POST creates a directory pair on disk                         |
| `app.post('/api/upload', upload.array('photos', 50), uploadPic)` — no auth, no rate limit                            | `src/index.ts`                        | Unbounded public write against an invented event name                                              |
| QR emits `/upload?partyname=…`, upload page reads `useQueryParam('party') ?? 'myParty'`                              | `QRCodePage.tsx`, `UploadPage.tsx:12` | Producer/consumer mismatch: every guest silently uploaded to the default event, and nothing failed |
| SSE filter: `req.query.partyname \|\| req.user?.partyId \|\| 'myParty'`                                              | `src/index.ts`                        | A third spelling of the same concept, with a third default                                         |
| `partyId` read off `req.user` in every query                                                                         | `src/routes/pictures.ts`              | A host account belongs to one party forever — no second event, no moderator sharing                |
| Seeded `admin` / `password` with `partyId = 'myParty'`                                                               | `src/database.ts`                     | The default event is also the default credential                                                   |

The string did four unrelated jobs: tenant key, filesystem directory name, URL parameter,
and account attribute. Being only a string, it had no place to hang an owner, a moderation
mode, a retention period or a byte budget — and no way to express _this event does not
exist_, which is why an upload to a typo created one instead of failing.

## Decision

An `events` table and an `Event` aggregate in `src/domain/events/`. The event is the unit
of tenancy, authorization, lifecycle, and storage accounting.

```sql
-- src/infrastructure/db/migrations/001_initial_schema.ts
CREATE TABLE events (
  id          TEXT PRIMARY KEY,   -- opaque, application-generated
  slug        TEXT NOT NULL,      -- normalised, human-facing in URLs
  name        TEXT NOT NULL,      -- free text, display only
  join_code   TEXT NOT NULL,      -- rotatable, uppercase
  status      TEXT NOT NULL CHECK (status IN ('draft','live','closed','archived')),
  settings    TEXT NOT NULL,      -- JSON, zod-parsed in the repository
  quota_bytes INTEGER NOT NULL,
  created_at  TEXT NOT NULL,      -- ISO-8601 UTC
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_events_slug      ON events (slug);
CREATE UNIQUE INDEX idx_events_join_code ON events (join_code);

CREATE TABLE event_memberships (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('host','moderator')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
```

Identity splits into three values with three jobs:

| Value       | Shape                                | Job                                      | Changeable       |
| ----------- | ------------------------------------ | ---------------------------------------- | ---------------- |
| `id`        | opaque `TEXT`, never `AUTOINCREMENT` | foreign keys, device tokens, media paths | never            |
| `slug`      | lowercase `[a-z0-9-]{3,48}`          | `/e/:slug/upload`, `/e/:slug/display`    | yes, by the host |
| `join_code` | uppercase, no `I`/`L`/`O`/`U`        | `/join/:code`, printed on the QR card    | yes, rotatable   |

- `Slug.create` (`src/domain/events/slug.ts`) normalises, then rejects the reserved first
  segments `admin`, `api`, `join`, `e`, `assets`, `health`: slugs share a URL namespace
  with those routes, so the rejection belongs in the value object.
- The join-code alphabet drops `I`/`L`/`O`/`U` because guests read the code off a card in
  dim light, and because it stops the generator emitting a word.
- Lifecycle is an explicit transition table in `src/domain/events/eventStatus.ts`, not
  `if`s in a handler:

  | From       | Allowed next       | Uploads  | Display               | Moderation |
  | ---------- | ------------------ | -------- | --------------------- | ---------- |
  | `draft`    | `live`, `archived` | rejected | members only          | allowed    |
  | `live`     | `closed`           | accepted | public                | allowed    |
  | `closed`   | `live`, `archived` | rejected | public, keeps playing | allowed    |
  | `archived` | — terminal         | rejected | members only          | read-only  |

- `settings`: `moderationMode` (`preModerated` \| `postModerated`), `allowCaptions`,
  `allowReactions`, `retentionDays`. One JSON column, zod-parsed on the way out of
  `SqliteEventRepository` — a database row is an untrusted boundary input like any other.
- `quota_bytes` is checked in the upload use case against `PhotoRepository.countBytes(eventId)`
  and fails as `event.quotaExceeded` → HTTP 413, so a full event stops instead of filling the disk.
- Guests join by path. `GET /join/:code` resolves the code server-side, 404 when no event
  matches or its status refuses uploads; `POST /api/join/:code` mints the HMAC device token
  carrying the immutable `id`, so rotating the code or renaming the slug does not evict
  guests already in the room.
- Every event-scoped table (`photos`, `guests`, `reactions`, `event_memberships`) carries
  `event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE` plus an index leading
  with `event_id`. The cascade fires only because `connection.ts` sets
  `PRAGMA foreign_keys = ON` on the connection.

## Consequences

### Positive

- Tenant isolation is expressible and therefore testable: every repository method takes
  `eventId` first, and the cross-event case is a required test at rings 2, 4 and 6.
- An upload to a non-existent event is `404 event.notFound`. An unauthenticated request
  creates nothing on disk, removing the 1.0 mkdir-per-POST amplification.
- The join link cannot silently point at the wrong event — there is no query parameter to
  mistype, and one resolver serves QR, link, and typed code.
- Quota, retention, purge, moderation mode and "close the event" now have somewhere to
  live. Deleting an event is one cascading statement plus a media-tree unlink.
- One host can own several events and invite a moderator to exactly one of them, because
  the role lives on the membership row, not on the user.

### Negative

- 1.0 data needs an importer: per distinct `partyId`, create an `archived` event with
  `slug = normalise(partyId)`, attach its `users` rows as `host` memberships, and re-ingest
  `photos/<partyId>/*` through the sharp pipeline so EXIF is stripped and content hashes
  exist. A one-shot `npm run import:v1` script, not a migration (migrations never touch the
  filesystem). **(planned)**
- A host must create an event before the first photo can arrive; 1.0 accepted one from a
  cold boot. Mitigated by a one-screen create flow — name in, slug and join code proposed,
  settings defaulted — ending on the printable QR page.
- Joining costs one extra round-trip versus reading a query parameter.
- Unique indexes mean creation and rotation must catch `SQLITE_CONSTRAINT` and retry with a
  fresh code rather than surfacing a 500.
- Rotating a join code invalidates every printed card for that event. That is the feature,
  but it is a footgun mid-party, so the admin UI has to say so before confirming.

### Neutral

- Every request resolves an event first. One indexed lookup in `resolveEvent`/`requireRole`
  middleware, passed down; no use case re-reads it.
- `settings` as JSON trades queryability for schema churn — fine while settings are read one
  event at a time. A setting needing cross-event filtering becomes a column in a later migration.

## Alternatives considered

### Keep `partyId` as a string, add a whitelist table

Validate the name against a table of allowed values. Rejected: it fixes only "any string is
accepted". The name stays tenant key, directory name and URL parameter at once, so a rename
still orphans photos, there is still no owner/status/settings/quota to attach, and the join
link stays a query parameter — the exact shape of the 1.0 QR bug.

### One SQLite file per event

Isolation by construction and a trivial purge. Rejected: no cross-event admin (no "all my
events", no shared accounts, no total storage figure without opening N databases), backups
become a directory of files with independent WAL state, migrations must be applied N times
with partial-failure states, and it conflicts with the single pragma-configured connection in
`src/infrastructure/db/connection.ts`.

### Infer the event from a subdomain (`mariage.example.org`)

Clean isolation, no path prefix. Rejected: EventSlide is self-hosted, so the operator would
need wildcard DNS and a wildcard TLS certificate before the first guest could upload. It also
breaks `http://localhost:4300` development and the path-addressed e2e harness, and cookies
scoped to a parent domain would weaken the per-event device token this design relies on.

## Related

- `docs/adr/0004-remove-passport.md` — the event-scoped guest device token that `/join/:code`
  mints, and per-event role checks instead of an ambient "logged in".
- `docs/adr/0003-better-sqlite3.md` — the connection whose `PRAGMA foreign_keys = ON` makes
  the `ON DELETE CASCADE` above real.
- `.claude/skills/eventslide-migration/SKILL.md` — schema conventions, `event_id` indexes,
  the upgrade-path test the importer must satisfy.
- CLAUDE.md §3.5 (every query scoped by `eventId`), §9.1 (the 1.0 QR bug).
