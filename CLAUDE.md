# CLAUDE.md — EventSlide 2.0

Guide for AI agents working in this repository. Read this before touching code.
Vendor-neutral copy: [AGENTS.md](AGENTS.md). Deeper references live in [docs/](docs/).

---

## 1. What this product is

EventSlide is a self-hosted **live photo wall for events** (weddings, parties, conferences).

Three audiences, three completely different needs:

| Audience             | Surface                          | Non-negotiable                                                 |
| -------------------- | -------------------------------- | -------------------------------------------------------------- |
| **Guest**            | `/join/:code`, `/e/:slug/upload` | Zero friction. No account, no app, one thumb, bad venue Wi-Fi. |
| **Host / moderator** | `/admin/**`                      | Control. Nothing reaches the screen unless they allow it.      |
| **The room**         | `/e/:slug/display`               | Beautiful. Runs unattended for 8 hours on a projector.         |

Every change must state which of the three it serves. A change that makes the guest
flow slower to serve an admin convenience is a regression.

---

## 2. Architecture: hexagonal, and enforced

The single most important rule in this repo:

> **Business logic never imports Express, SQLite, `fs`, `sharp`, or `react`.**

```
web/src/            React app. Views + view-state only. No business rules.
  design-system/    Tokens and primitives. The ONLY place raw colours/spacing exist.
  features/         One folder per user journey. Hooks hold view-state, not rules.
  lib/              Transport, small utilities.

src/domain/         Pure TypeScript. No imports outside src/domain. 100% unit tested.
src/application/    Use cases + ports (interfaces). Imports domain + ports only.
src/infrastructure/ Adapters that implement ports. The only place I/O exists.
src/interface/http/ Express wiring: routers, middleware, zod schemas, presenters.
src/main/           Composition root. The only file allowed to `new` an adapter.
```

Dependency rule — arrows point inward, never outward:

```
interface/http ──┐
                 ├──> application ──> domain
infrastructure ──┘
main ──> everything (composition only)
```

This is checked mechanically, not by review: `npm run lint` fails the build on a
violating import. The rule is **`no-restricted-imports`** — core ESLint, configured with
`patterns` — applied per layer in `eslint.config.mjs`: search for `DOMAIN_FORBIDDEN` and
`APPLICATION_FORBIDDEN`, and for the `files: ['src/infrastructure/**/*.ts']` block. There
is no `eslint-plugin-import` in this project and no `import/no-restricted-paths`; if you
went looking for that string you were reading an older version of this file. The
companion rule is `no-restricted-syntax`, which is what bans `process.env` outside
`env.ts` and `new Date()` / `Date.now()` / `Math.random()` inside domain and application.

If you need domain code to do I/O, you have modelled it wrong — define a **port** in
`src/application/ports/` instead.

### Why it is worth the ceremony

`src/domain/photos/photo.ts` decides whether a photo may be published. Testing that
required a running Express server, a SQLite file, and a real JPEG in 1.0. It now takes
a plain function call. That is the whole point.

Rationale and rejected alternatives: [docs/adr/](docs/adr/).

---

## 3. Non-negotiable rules

1. **No business logic in a React component or an Express handler.** Handlers parse,
   call one use case, and present. Components render and dispatch.
2. **No new hex colour, font size, radius, shadow, or spacing value outside
   `web/src/design-system/tokens.css`.** Use `var(--...)`. See
   [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).
3. **Every boundary input is parsed with zod** before it reaches a use case.
   `req.body`, `req.query`, `req.params`, env vars, and SSE payloads are all untrusted.
4. **Never trust a client-supplied MIME type or filename.** Uploads are identified by
   magic bytes (`src/infrastructure/media/magicBytes.ts`) and stored under a
   server-generated name. Original filenames are metadata, never paths.
5. **Every photo query is scoped by `eventId`.** A repository method that can return
   another event's photo is a security bug, not a feature gap. Tenant isolation has
   dedicated tests — keep them passing.
6. **EXIF is stripped on ingest, orientation is baked in.** Guest photos carry GPS and
   device serials. `sharp(...).rotate()` before resize, and never copy metadata across.
7. **No `any`.** Not in tests either. Use `unknown` and narrow.
8. **A new use case ships with its unit tests in the same commit.** Not the next one.
9. **Migrations are append-only.** Never edit a migration that exists on `main`.
10. **Secrets come from the environment**, validated once in
    `src/infrastructure/config/env.ts`. Nothing else reads `process.env`.

---

## 4. Layout you will actually touch

```
src/
  domain/
    shared/        Result, error taxonomy, branded ids, Clock type, slug, join codes
    events/        Event entity, settings, lifecycle
    guests/        Guest identity, display names
    photos/        Photo entity, status machine, captions, quotas
    moderation/    Queue ordering and decisions (pure)
    slideshow/     Playlist building, layouts, transitions (pure)
    reactions/     Reaction rules
  application/
    ports/         Interfaces. One file per port. No implementations.
    usecases/      One file, one exported factory, one responsibility.
  infrastructure/
    config/        Zod-validated env
    db/            Connection, migrator, migrations/, SQLite repositories
    media/         Filesystem store, sharp pipeline, magic bytes
    crypto/        Hashing, HMAC tokens, id generation
    realtime/      Event bus + SSE hub
    logging/       pino
    time/          System clock
  interface/http/  server.ts (pure builder), middleware/, routes/, schemas/
  main/            container.ts, index.ts
web/src/           React app (see §2)
docs/              Architecture, security, API, design system, roadmap, ADRs
```

`src/interface/http/server.ts` exports `buildServer(deps)` and **never calls
`listen()`**. That is what makes the whole HTTP surface testable with supertest and no
open ports. `src/main/index.ts` listens.

---

## 5. Test strategy

Six rings, each with a different job. Full detail:
[docs/TESTING.md](docs/TESTING.md), `.claude/skills/eventslide-testing/` and
`.claude/skills/eventslide-e2e/`.

| Ring                  | Location                          | Doubles                                         | Speed        |
| --------------------- | --------------------------------- | ----------------------------------------------- | ------------ |
| 1 Domain unit         | `src/domain/**/*.test.ts`         | none needed — it is pure                        | microseconds |
| 2 Use case            | `src/application/**/*.test.ts`    | in-memory fakes from `src/application/testing/` | sub-ms       |
| 3 Adapter integration | `src/infrastructure/**/*.test.ts` | real SQLite `:memory:`, real temp dirs          | ms           |
| 4 HTTP contract       | `src/interface/http/**/*.test.ts` | supertest against `buildServer()`               | ms           |
| 5 Component           | `web/src/**/*.test.tsx`           | Testing Library + fake transport                | ms           |
| 6 End-to-end          | `tests/e2e/**/*.spec.ts`          | none — real server, real SQLite, real browsers  | seconds      |

Rules:

- **Fakes, not mocks.** `src/application/testing/` holds real in-memory
  implementations of every port. They are production-quality code with their own
  tests. `vi.mock` of an internal module is a smell — inject a fake instead.
- **Test behaviour through the public surface.** Assert on what a caller observes.
  Never assert that a private helper was called.
- **One clear reason to fail per test.** The name states the rule being protected
  (`rejects a photo when the event has already been archived`), not the mechanics.
- **Time and randomness are injected.** `Clock` and `IdGenerator` are ports. A test
  that depends on `Date.now()` is a flaky test.
- **Security invariants get named tests.** Tenant isolation, authz on every route,
  magic-byte rejection, EXIF stripping, quota enforcement — at ring 4 _and_ ring 6.
- **E2E covers journeys, not units.** A ring-6 test earns its seconds only by crossing
  surfaces (guest phone → host laptop → projector) or by exercising something only real
  infrastructure can break: EXIF rotation through `sharp`, SSE propagation, a real
  multipart upload. Everything else is cheaper one ring down. Real server, throwaway
  SQLite file and media root, no network stubbing, no `waitForTimeout`.

Coverage gates are in `vitest.config.ts` and CI fails below them. `src/domain` and
`src/application` are held at 100% branches; adapters lower, by design. Coverage is a
floor, never the goal — a test that asserts nothing still covers lines.

```bash
npm test              # watch
npm run test:run      # once, all vitest projects
npm run test:unit     # domain + application only — the fastest loop
npm run test:coverage # with gates
npm run test:e2e      # Playwright, real server, real browsers
npm run verify        # lint + typecheck + test:coverage + build  <- run before committing
npm run verify:full   # verify + test:e2e                         <- before opening a PR
```

---

## 6. Working agreements for agents

- **Run `npm run verify` before you claim a task is done.** Report real output. A
  failing test reported as passing is the worst possible outcome here.
- **Read the skill first.** `.claude/skills/` contains step-by-step recipes for the
  five things you will be asked to do most. They encode decisions you cannot infer
  from the code.
- **Small, typed commits.** Conventional Commits, one concern each. `feat(domain):`,
  `feat(web):`, `fix(http):`, `test(application):`, `docs:`, `chore:`.
- **Never commit** `photos/`, `thumbnails/`, `data/*.sqlite*`, `.env`, `dist/`,
  `coverage/`. They are gitignored; do not force them in.
- **Do not weaken a test to make it pass.** Fix the code, or say plainly that the
  requirement itself is wrong.
- **Prefer deleting to adding.** 1.0 carried duplicate legacy HTML routes alongside
  the JSON API. If you find dead code, remove it in its own commit.
- **French is the UI language, English is the code language.** Identifiers, comments,
  commit messages, and docs in English. User-facing strings live in
  `web/src/lib/i18n/` and are French — with correct accents.

---

## 7. Commands

```bash
npm install

npm run dev            # API (4300) + web (5173) together
npm run dev:api
npm run dev:web

npm run verify         # the gate: lint + typecheck + coverage + build
npm run lint           # eslint, includes the architecture boundary rules
npm run typecheck      # all five tsconfig projects: domain, server, web, sw, tools
npm run build          # web bundle + API to dist/
npm start              # run the built server

npm run db:migrate     # apply pending migrations
npm run db:status      # show applied/pending
```

---

## 8. Security posture

Read [docs/SECURITY.md](docs/SECURITY.md) before touching auth, uploads, or anything
that renders guest-supplied content. The short version:

- Guests are **anonymous but identified** — an HMAC-signed, event-scoped device token
  in an `HttpOnly` cookie. It grants upload rights to exactly one event and lets a
  guest delete their own photo within a grace window. It grants nothing else.
- Hosts and moderators are **session-authenticated** with a SQLite-backed session
  store, session regeneration on login, and role checks per route.
- Public write endpoints are rate-limited per IP **and** per event, with a byte quota.
  An event that hits its quota stops accepting uploads instead of filling the disk.
- Media is served through the application, never by `express.static`, so authorization
  and event scoping apply to every byte.
- `helmet` sets a strict CSP. There is **no CDN** — Bootstrap is gone; fonts and CSS
  are bundled. Do not reintroduce a remote `<script>` or `<link>`.

---

## 9. Traps in this codebase

Learned the hard way. Do not rediscover them.

1. **The 1.0 QR bug.** The QR page emitted `?partyname=`; the upload page read
   `?party`. Every guest silently uploaded to the default event. Lesson: the join link
   is now a **path** (`/join/:code`) resolved server-side, and it has a test.
2. **Mobile photos arrive rotated.** Orientation lives in EXIF. `sharp` must
   `.rotate()` before `.resize()`, and stripping metadata after rotating is what makes
   both correct.
3. **SSE dies silently** behind proxies without a heartbeat. The hub sends a comment
   frame on an interval and supports `Last-Event-ID` resume. Do not remove either.
4. **`sharp` failing after the DB insert** left rows with no file in 1.0. Ingest is now
   write-file → verify → insert, and a failed ingest cleans up after itself.
5. **`express-session` MemoryStore leaks** and drops every session on restart. The
   SQLite store exists for a reason.
6. **Ken Burns vs. slide interval.** If the zoom animation is longer than the slide
   duration the image visibly jumps. They are derived from one value in
   `src/domain/slideshow/`.
7. **`sessionStorage` slideshow index** meant two projectors disagreed. Playlist
   position is now derived from the playlist itself.
8. **`eslint.config.mjs` is `.mjs` on purpose, and `package.json` has no `"type"`.**
   The tempting one-line "cleanup" is `"type": "module"`, which is a repository-wide
   change wearing a one-line disguise: `tsconfig.build.json` and `tsconfig.server.json`
   use `module: node16`, where that field decides the module format of everything under
   `src/`. Declaring the package ESM makes Node16 demand an explicit `.js` extension on
   every relative import — measured on this tree, `tsc -p tsconfig.server.json` goes
   from clean to **1 940 errors across 264 files** and `npm run build:api` exits 2. It
   is real work (F15 in [docs/REVIEW-2.0.md](docs/REVIEW-2.0.md)), not a tidy-up. The
   `.mjs` extension says "this one file is ESM" and costs nothing.
9. **A config-file rename is never local.** That same rename of `eslint.config.js` to
   `eslint.config.mjs` took two further rounds to finish. `tsconfig.tools.json` went on
   listing the old name in `include`, and **an `include` entry that matches nothing is
   silent** — no error, no warning. So the file that enforces the entire architecture
   belonged to none of the four tsconfig projects, and `npm run typecheck` stayed green
   while covering less than it had the day before (G2 in
   [docs/REVIEW-2.0.md](docs/REVIEW-2.0.md)). Eight more references to the dead name
   survived in `docs/ARCHITECTURE.md`, in an ADR, in two presenter contract tests and in
   a web hook comment (G5) — one of them reading
   `// eslint.config.js — abridged; the file is the source of truth` directly above the
   excerpt it pointed at. Config names live in tsconfigs, in docs, in comments and in
   tests, so a rename is finished only when
   `grep -rn "<old name>" --exclude-dir=node_modules` is empty. Two mechanical rules come
   out of it: a **single named file goes in a tsconfig `files`, not `include`**, because
   a `files` entry that names nothing is `error TS6053` instead of silence; and a
   `.js`/`.mjs` file needs `allowJs` to be in the program and `checkJs` to be _checked_ —
   `--listFiles` lists it either way, which is why "typecheck passes" and "the file is
   type-checked" are different claims, and only the second one is the guard.

---

## 10. Definition of done

- [ ] The change names which audience it serves (guest / host / room).
- [ ] Business rules landed in `domain` or `application`, not in a handler or component.
- [ ] Tests in the right ring, failing before the fix and passing after.
- [ ] `npm run verify` green, output actually read.
- [ ] No new token-less colour or spacing value; no new `any`; no new `process.env` read.
- [ ] Docs touched if behaviour or API changed (`docs/API.md` §§1–8 is the contract —
      **§9 is not**: it is a list of known divergences and proposals, and nothing in it
      is implemented. Never code against a route you found only in §9).
- [ ] Conventional Commit, scoped, one concern.
