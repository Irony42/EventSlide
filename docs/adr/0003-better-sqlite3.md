# ADR 0003 — better-sqlite3 instead of the async `sqlite` / `sqlite3` pair

## Status

Accepted.

## Date

2026-09-09

## Context

1.0 reached SQLite through `sqlite3` (the async C binding) wrapped by `sqlite` (the
promise wrapper). Both problems below are quoted from the 1.0 code, removed on this
branch in `fa6e9bd` and still available on `main`:

**A mutable module-level handle.** `src/database.ts` exports `export let db` and assigns
it inside `initDatabase()`. Every route module does `import { db } from '../database'`
(`src/routes/pictures.ts:3`, `src/routes/user.ts`). Consequences: import order decides
whether `db` is defined, there is no seam to substitute a test database, and the same
file also creates the `admin` / `password` default user on every boot. Nothing in that
file can be tested without a real file on disk — which is one reason 1.0 shipped with
zero tests behind `jest --passWithNoTests`.

**No transactions, and writes ordered wrongly.** `uploadPic` in
`src/routes/pictures.ts:47-75` runs, per uploaded file, inside a `Promise.all`:

```ts
await Promise.all(photosDatas.map(async (photoData) => {
  await db.run(query, [photoData.fileName, photoData.status, partyName]) // row first
  await sharp(originalPath).resize(...).toFile(tempPath)                 // file after
  fs.renameSync(tempPath, originalPath)
}))
```

The `INSERT` commits before `sharp` runs. A `sharp` failure — unsupported input, a
truncated upload, ENOSPC — rejects the request with 500 while the row stays committed,
so the photos table points at a file that does not exist and the moderation queue shows
a broken image forever (CLAUDE.md §9.4). `Promise.all` also interleaves several
statements over one connection with nothing grouping them, so a multi-file upload can
half-commit. The async API offers no honest way to fix this: `BEGIN`/`COMMIT` issued as
loose `db.exec` calls on a shared handle are not scoped to a caller, and any `await` in
the middle of a transaction lets another request's statements land inside it.

2.0 needs the opposite properties: a connection constructed once in
`src/main/container.ts` and injected, repositories behind ports
(`src/application/ports/photoRepository.ts`) that never expose SQL, and ingest ordered
write-file → verify → insert with the insert atomic.

## Decision

Use **`better-sqlite3`** as the only database driver.

| Capability used                                                  | Where                                        |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Synchronous API                                                  | all repositories in `src/infrastructure/db/` |
| `db.transaction(fn)` — real, re-entrant, rolled back on throw    | ingest, bulk moderation, event deletion      |
| Prepared statements cached per repository instance               | `src/infrastructure/db/photoRepository.ts`   |
| `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout` | `src/infrastructure/db/connection.ts`        |
| `new Database(':memory:')`                                       | rings 3 and 4 (CLAUDE.md §5)                 |

The transaction wrapper is what removes the 1.0 defect class — one call site, all rows
or none:

```ts
// src/infrastructure/db/photoRepository.ts
const insertMany = db.transaction((photos: readonly PhotoRow[]) => {
  for (const p of photos) insertPhoto.run(p) // insertPhoto is prepared once
})
```

Verified to install and build on Windows 11 and Linux (x64, Node 22) from the published
prebuilt binaries, so no contributor needs a C++ toolchain for `npm install`.

## Consequences

### Positive

- **Atomic multi-row writes.** A multi-file upload, a bulk approve, and a cascading
  event delete each either land completely or not at all. Migrations get the same
  guarantee: `src/infrastructure/db/migrator.ts` wraps each `up` in a transaction, so a
  schema change plus its backfill cannot half-apply (`eventslide-migration` skill).
- **Repository code reads linearly.** No `await` between `BEGIN` and `COMMIT`, therefore
  no window for another request's statements to interleave. Error handling is a plain
  `try`/`catch` around a synchronous block.
- **Tests open a fully migrated database in about a millisecond.** `:memory:` plus the
  ordered migration array gives every test its own schema with no file, no cleanup, no
  cross-test leakage. That is what makes ring 3 adapter tests and ring 4 supertest
  contract tests cheap enough to run on every save, and it is what lets the shared port
  contract suite (`src/application/testing/contracts/photoRepositoryContract.ts`) run
  against the fake and against SQLite with the same assertions.
- **Prepared statements are reusable objects**, so hot paths (moderation queue, playlist
  build) parse SQL once per process rather than per query.
- **Tenant-isolation tests are meaningful**, because a real database enforces the
  `event_id` foreign key and `ON DELETE CASCADE` that the fake only simulates.

### Negative

- **A native module in the dependency tree.** Prebuilt binaries cover our targets, but
  a new Node major or an unusual platform can force a source build. Mitigation: Node
  version pinned in `package.json` `engines` and in CI; the driver is imported only
  under `src/infrastructure/db/`, so replacing it touches one directory.
- **Synchronous calls block the event loop.** Accepted, and for this product desirable:
  a self-hosted single-venue deployment serves one event, tens of guests, and one
  projector. The relevant comparison is against the work already on the request path:

  | Operation                                                     | Order of magnitude |
  | ------------------------------------------------------------- | ------------------ |
  | Indexed event-scoped read (`idx_photos_event_status_created`) | sub-millisecond    |
  | Single insert in a transaction, WAL                           | sub-millisecond    |
  | `sharp` rotate → strip → resize on a phone JPEG               | 10²ms              |
  | Network round trip from a phone on venue Wi-Fi                | 10²–10³ms          |

  Every query is scoped by `event_id` with an index leading on it (CLAUDE.md §3.5), so
  no read scans the table. The image pipeline dominates a request by two to three orders
  of magnitude, and it is already `await`-ed outside the transaction. These are design
  budgets, not benchmark results — a load check on a realistic album is still to be
  written, and the number to watch is p99 of an SSE-triggered playlist rebuild.

- **No streaming of very large result sets.** `.all()` materialises rows in memory. Not
  a problem for a per-event query, and the one unbounded path — the ZIP export — uses
  `.iterate()` to feed `archiver` a row at a time instead of collecting the album first.
- **Long writes stall reads on the same connection.** Hence `busy_timeout` and WAL, and
  hence no expensive backfill inside a migration: those ship as a resumable
  `npm run db:backfill:<name>` script.

### Neutral

- **Ports stay `Promise`-returning** even though the adapter is synchronous. The
  synchronous result is returned as an already-resolved promise. Use cases and fakes are
  unchanged, the port keeps no storage concept, and a future async driver would not
  ripple outward. The cost is a microtask per call, which is noise next to `sharp`.
- **The SQLite-backed session store** for hosts and moderators uses the same driver and
  the same connection, which is what makes sessions survive a restart — the concrete
  failure of 1.0's `express-session` MemoryStore (CLAUDE.md §9.5). _Design; the store
  adapter lives with the other adapters under `src/infrastructure/db/`._
- Deployment stays "copy one file". `data/eventslide.sqlite` plus its `-wal` and `-shm`
  siblings; a hot backup uses the driver's `db.backup()` rather than `cp`.

## Alternatives considered

### Keep `sqlite3` + `sqlite`

Rejected. It cannot express the guarantee we need. A transaction on a shared async
handle is not scoped to the caller: any `await` inside it admits another request's
statements, which is exactly the bug in `uploadPic`. Keeping it would also keep the
mutable singleton or force a hand-written connection-per-request pool for a single-file
database that does not need one. The migration cost is one directory
(`src/infrastructure/db/`), paid once.

### An ORM — Prisma, Drizzle, TypeORM

Rejected. **The repository layer is already the abstraction.**
`src/application/ports/photoRepository.ts` is expressed in domain types
(`EventId`, `Photo`, `PhotoStatus`) and forbids storage concepts by rule. An ORM adds a
second, weaker abstraction whose types leak: entity classes, relation objects, lazy
proxies, and generated query builders end up in signatures, which is precisely the
inward-pointing dependency `npm run lint` exists to reject (CLAUDE.md §2). Specifically:
Prisma needs a schema file and a generated client as a second source of truth alongside
our append-only migrations, plus a query engine binary; Drizzle is the closest fit but
still puts its column builders in the layer that is meant to hold hand-written SQL;
TypeORM's decorators and entity metadata pull persistence concerns into domain classes.
Hand-written SQL in about a dozen repository files is a cost we can read, index, and
`EXPLAIN QUERY PLAN`.

### PostgreSQL

Rejected on the deployment shape, not on capability. A self-hosted single-venue install
should be **one file you can copy to a USB stick** at the end of the night — no daemon,
no `pg_hba.conf`, no port to secure at a wedding venue, no second container for a host
who runs the wall on a laptop. Postgres would buy concurrent writers and streaming
result sets; there is one writer process and one event. Should a hosted multi-event
variant ever be built, the ports are the seam: a `PostgresPhotoRepository` satisfying
the same contract suite in `src/application/testing/contracts/`.

## Related

- `docs/adr/0001-*`, `docs/adr/0002-*` — hexagonal architecture and its enforcement.
- `.claude/skills/eventslide-migration/SKILL.md` — migration and schema conventions.
- CLAUDE.md §5 (test rings), §9.4 (the `sharp`-after-insert trap), §9.5 (MemoryStore).
