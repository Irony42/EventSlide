# ADR 0001 — Adopt hexagonal (ports and adapters) architecture

## Status

Accepted. Binding for all of `src/`; summarised in [CLAUDE.md](../../CLAUDE.md) §2 and
[AGENTS.md](../../AGENTS.md). Supersedes the 1.0 layout, which is deleted once the 2.0
tree passes `npm run verify`.

> As of this date the 2.0 tree is the **target** layout. Only the 1.0 files quoted below
> exist on disk in `src/`. Every path under §Decision is a commitment, not a claim that
> the file is already written; the eslint zones in §Enforcement are not in
> `eslint.config.js` yet.

## Date

2026-09-09

## Context

1.0 had no seam between a business rule and the machinery around it. Two files caused it.

```ts
// src/database.ts (1.0) — a mutable module-level binding, assigned at boot
export let db: Database<sqlite3.Database, sqlite3.Statement>

export const initDatabase = async () => {
  db = await open({ filename: 'database/database.sqlite', driver: sqlite3.Database })
  // ... CREATE TABLE users/photos, plus an admin/password row re-inserted every boot
}
```

Importing anything that touched data therefore imported a global that was `undefined`
until `initDatabase()` had run against a real file at `database/database.sqlite`. There
was no way to hand a test a different database, and no way to construct the same code
twice in one process.

```ts
// src/routes/pictures.ts (1.0) — uploadPic: five concerns, one function
const partyName = parsePartyName(req.query.partyname)          // transport
await db.run('INSERT INTO photos (fileName, status, partyId)…') // storage, via the global
await sharp(originalPath).resize(…).jpeg({ quality: 80 })       // media — after the INSERT
picturesEmitter.emit('update', partyName)                       // realtime
res.redirect('/upload/confirmation')                            // transport again
```

Every consequence in the table below follows from those two facts.

| Symptom in 1.0                                   | Where                                                                                                                                        | Why it was unavoidable                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Zero test files in the repo                      | whole tree                                                                                                                                   | Testing "a photo starts pending and may be published" required Express, a real SQLite file, `photos/<party>/` on disk, and a real JPEG. |
| CI green while testing nothing                   | `.github/workflows/ci.yml` runs `npm run test:ci` = `jest --runInBand --passWithNoTests`                                                     | The only honest way to keep the pipeline green given the above.                                                                         |
| Two disagreeing definitions of photo status      | `src/models.ts` declares `'accepted' \| 'rejected'`; `src/routes/pictures.ts` writes `'pending'` and keeps its own `pictureStatusValues` Set | No layer owned the lifecycle, so it was re-declared per file — and `(req.files as any)` erased the type error between them.             |
| Rows pointing at no usable file                  | `uploadPic`                                                                                                                                  | `db.run` committed before `sharp` ran; a `sharp` throw left the row. Ordering is a business rule with nowhere to live.                  |
| Authorization expressed as `req.user as any`     | `getPics`, `deletePic`, `changePicsStatus`, `downloadArchive`                                                                                | Event scoping was a `partyId` read off the session inside each handler, repeated six times, with no single place to test it.            |
| Client MIME type trusted                         | `src/pictureStorage.ts` `fileFilter`                                                                                                         | An ingest policy living in a multer callback cannot be unit tested at all.                                                              |
| The QR bug: `?partyname=` emitted, `?party` read | QR page vs. upload page                                                                                                                      | A silent cross-event write. A parsed, typed boundary would have caught it; there was no boundary.                                       |
| Duplicate legacy HTML + `/api` route pairs       | `src/index.ts` (`/upload` and `/api/upload`, six `/admin/*` and `/api/admin/*` pairs)                                                        | Handlers branched on `req.path.startsWith('/api/')`, so presentation and rules were interleaved.                                        |

## Decision

Adopt hexagonal architecture with four layers plus a composition root, and enforce the
dependency direction mechanically.

| Layer                 | Contents                                                                                                                                                                                                                                | May import                            | Never imports                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `src/domain/`         | Entities, value objects, status machines, `Result`, error taxonomy, branded ids                                                                                                                                                         | `src/domain` only                     | Express, better-sqlite3, `fs`, `sharp`, `zod`, `react`, `node:crypto` |
| `src/application/`    | Use cases (`usecases/`), port interfaces (`ports/`), in-memory fakes (`testing/`)                                                                                                                                                       | `src/domain`, `src/application/ports` | anything doing I/O                                                    |
| `src/infrastructure/` | Adapters: `db/` (better-sqlite3 repositories, migrator), `media/` (filesystem store, sharp pipeline, `magicBytes.ts`), `crypto/` (bcrypt, HMAC, ids), `realtime/` (SSE hub), `logging/` (pino), `time/` (system clock), `config/env.ts` | domain, ports                         | `src/interface`, other adapters' internals                            |
| `src/interface/http/` | `server.ts`, `routes/`, `middleware/`, `schemas/` (zod), presenters                                                                                                                                                                     | domain, application, ports            | `src/infrastructure` concretions                                      |
| `src/main/`           | `container.ts` (the only place an adapter is constructed), `index.ts` (listen + graceful shutdown)                                                                                                                                      | everything                            | —                                                                     |

```
interface/http ──┐
                 ├──> application ──> domain
infrastructure ──┘
main ──> everything (composition only)
```

Load-bearing corollaries:

1. **Ports speak domain, not storage.** `PhotoRepository.findById(eventId, photoId)`
   returns a `Photo`, not a row. No `Statement`, no SQL fragment, no `Request` in a port
   signature.
2. **`eventId` is the first parameter of every event-scoped port method.** Tenant
   isolation becomes visible in an interface instead of buried in a SQL string.
3. **`buildServer(deps)` never calls `listen()`.** `src/main/index.ts` listens. Every
   route is reachable from supertest with no open port.
4. **Fakes are production code.** `src/application/testing/` holds real in-memory
   implementations of each port, and one shared contract suite runs against both the fake
   and the SQLite adapter so they cannot drift.

### Enforcement

Review does not scale to this rule, so `npm run lint` fails the build instead.

| Mechanism                                           | Forbids                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `import/no-restricted-paths` zones, one per layer   | `domain → *`, `application → infrastructure\|interface`, `infrastructure → interface`, `* → main`     |
| `no-restricted-imports`, scoped by `files:` glob    | `express`, `better-sqlite3`, `fs`, `sharp`, `react` inside `src/domain` and `src/application`         |
| `@typescript-eslint/no-explicit-any` set to `error` | the `as any` casts that hid the 1.0 status contradiction — the current config turns this rule **off** |

Do not add an `eslint-disable` for a boundary rule. A domain object that appears to need
I/O is a modelling error: declare a port in `src/application/ports/` instead.

## Consequences

### Positive

- **Domain tests run in microseconds with no doubles.** Ring 1 (`src/domain/**/*.test.ts`)
  needs no server, no file, no JPEG — which is what makes the 100 % branch gate on
  `src/domain` and `src/application` affordable rather than aspirational.
- **The 1.0 ordering bug becomes a testable rule.** Write file → verify → insert lives in
  a use case, driven by fake `MediaStore` and `PhotoRepository`; a fake that throws on
  write proves no orphan row is created, in under a millisecond and with no `sharp`.
- **Adapters are swappable at the composition root.** Tests build the container with
  SQLite `:memory:` and a temp media root; production uses a WAL file and a real
  directory. Replacing the filesystem media store later touches `src/infrastructure/media/`
  and `container.ts`, and nothing else.
- **The whole HTTP surface is testable.** `buildServer(deps)` + supertest gives ring 4
  coverage of authorization, zod rejection, magic-byte rejection, and quota responses
  without binding a socket — the class of check 1.0 could not perform at all.
- **Status vocabulary has exactly one home.** `src/domain/photos/photoStatus.ts` is the
  only definition; zod schemas and presenters derive from it instead of re-listing it.

### Negative

- **More files per behaviour.** Publishing a photo is an entity method, a port, a use case,
  a fake, a SQLite adapter method, a zod schema, a controller, a presenter, and their
  tests. 1.0 did it in one exported function. This is the price, paid deliberately.
- **Mapping code between rows and entities.** SQLite gives `TEXT`/`INTEGER`; entities hold
  branded ids, `Date`, and value objects. Each repository owns `toDomain`/`toRow`, and
  that code is where ISO-8601 and null-handling bugs will appear. Mitigation: the shared
  port contract suite, plus round-trip tests at ring 3.
- **Learning curve.** "Which layer does this go in?" is a real cost on every change.
  Mitigation: `.claude/skills/eventslide-{domain,usecase,http-endpoint,migration}/`
  encode the answer as recipes, including the litmus test for domain vs. application.
- **Ports leak storage concepts if unwatched.** `orderBy`, `cursor`, `joinTable`, or a
  `WHERE` fragment appearing in a port means the abstraction has inverted. Review test:
  _if renaming a SQLite column changes a port signature, the port is wrong._
- **Deeper stack traces.** A single request crosses controller → use case → entity →
  adapter. Structured pino logs with a request id are the compensation.

### Neutral

- Runtime shape is unchanged: one Node 22 process, one SQLite file, self-hosted on a
  laptop or a small VPS. Hexagonal is a source-layout decision, not a deployment one.
- It does not dictate a modelling style. Entities with methods returning `Result` are what
  we chose; aggregates and event sourcing were rejected below.
- `web/src/` sits outside the hexagon and talks to the API over HTTP. The "no business
  rules in a component" rule holds there too, but it is enforced by review and
  CLAUDE.md §3.1, not by the boundary zones.

## Alternatives considered

### Keep the layered MVC and add tests

Rejected. The blocker was not missing tests, it was that `export let db` made tests
impossible to write cheaply: every test would have needed a real SQLite file, a real
`photos/` directory, and an Express app, so the suite would be slow, order-dependent, and
would still not isolate a rule. Retrofitting dependency injection into
`src/routes/pictures.ts` _is_ this decision, with a worse folder layout.

### Full DDD with aggregates, repositories per aggregate, domain events, and an event store

Rejected as disproportionate. The invariants here are small and local — a photo status
machine, a byte quota per event, join-code uniqueness, playlist ordering — and one SQLite
row per photo already models them. An event store adds projections, replay, and eventual
consistency to a product whose hardest requirement is "runs unattended on a projector for
eight hours". We keep the parts that pay: entities that own their invariants, `Result`
instead of exceptions, and invalidation signals on the bus. Revisit if multi-node ever
becomes a requirement.

### A framework with opinions, such as NestJS

Rejected. NestJS would supply the DI container that `container.ts` provides in ~100 lines,
and in exchange couples the domain to decorators and to `@nestjs/*` in `package.json`. The
purity rule — `src/domain` imports nothing outside `src/domain` — is the asset here, and a
framework whose idiom is annotating classes is in permanent tension with it. Self-hosting
also argues for a small dependency tree: fewer packages to audit, faster cold start,
simpler `npm ci` for someone deploying this on a home server.

### Serverless rewrite (functions plus managed object storage and a hosted database)

Rejected on product grounds. EventSlide is self-hosted by definition; the target operator
runs it on a venue laptop or a €5 VPS, often on unreliable venue Wi-Fi, and owns the
photos. Serverless breaks the three things the product needs most: long-lived per-event
SSE connections, synchronous better-sqlite3 in one process, and a local media root the
host can copy off a disk. It would also add a cloud bill and a data-processor relationship
to a wedding photo wall.
