# AGENTS.md — EventSlide 2.0

Instructions for any AI coding agent (Claude Code, Codex, Cursor, Copilot Workspace,
Aider…) operating in this repository. Claude Code should read [CLAUDE.md](CLAUDE.md),
which is the fuller version of this document; everything below is binding for all
agents.

---

## Project in one paragraph

Self-hosted live photo wall for events. Guests scan a QR code and upload photos from
their phone with no account. A host moderates them. Approved photos appear on a
projector in real time. Node + Express + SQLite API, React + Vite web app, TypeScript
everywhere, hexagonal architecture, tests at every ring.

---

## The one rule that matters

**Business logic must not import Express, SQLite, `fs`, `sharp`, or `react`.**

```
src/domain/         pure — imports nothing outside src/domain
src/application/    use cases + ports — imports domain and ports only
src/infrastructure/ adapters — the only place I/O lives
src/interface/http/ Express wiring only
src/main/           composition root — the only place adapters are constructed
web/src/            React — views and view-state only
```

Dependencies point inward. `npm run lint` fails on a violating import; do not
suppress the rule. If domain code seems to need I/O, add a **port** in
`src/application/ports/` and implement it in `src/infrastructure/`.

---

## Before you start

1. Read [CLAUDE.md](CLAUDE.md) §3 (rules) and §9 (traps).
2. Read the matching recipe in `.claude/skills/`:
   - `eventslide-domain` — pure business rules
   - `eventslide-usecase` — use case + port + fake
   - `eventslide-http-endpoint` — an endpoint end to end
   - `eventslide-ui-component` — React + design system
   - `eventslide-testing` — which ring, which double
   - `eventslide-e2e` — Playwright journeys across the three surfaces
   - `eventslide-migration` — schema changes
3. Read [docs/API.md](docs/API.md) if you touch the HTTP surface — it is the contract,
   and it is kept in sync by hand.

---

## Hard constraints

| #   | Constraint                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- |
| 1   | No business logic in an Express handler or a React component.                                                  |
| 2   | No colour, spacing, radius, shadow, or font size outside `web/src/design-system/tokens.css`. Use `var(--...)`. |
| 3   | Every boundary input parsed with zod. `req.*` and `process.env` are untrusted.                                 |
| 4   | Never trust client MIME types or filenames. Magic bytes decide; the server names the file.                     |
| 5   | Every photo/guest/reaction query is scoped by `eventId`.                                                       |
| 6   | Strip EXIF and bake orientation on ingest.                                                                     |
| 7   | No `any`, including in tests. Use `unknown` and narrow.                                                        |
| 8   | A behaviour change ships with its tests in the same commit.                                                    |
| 9   | Migrations are append-only. Never edit one that exists on `main`.                                              |
| 10  | Only `src/infrastructure/config/env.ts` reads `process.env`.                                                   |
| 11  | No remote `<script>` or `<link>`. The CSP forbids it and there is no CDN.                                      |
| 12  | UI strings are French and live in `web/src/lib/i18n/`. Code, comments, commits, docs are English.              |

---

## Testing contract

| Ring        | Where                             | Doubles                                         |
| ----------- | --------------------------------- | ----------------------------------------------- |
| Domain unit | `src/domain/**/*.test.ts`         | none — the code is pure                         |
| Use case    | `src/application/**/*.test.ts`    | in-memory fakes from `src/application/testing/` |
| Adapter     | `src/infrastructure/**/*.test.ts` | real SQLite `:memory:`, real temp dirs          |
| HTTP        | `src/interface/http/**/*.test.ts` | supertest against `buildServer(deps)`           |
| Component   | `web/src/**/*.test.tsx`           | Testing Library + fake transport                |
| End-to-end  | `tests/e2e/**/*.spec.ts`          | none — real server, real SQLite, real browsers  |

- Use the **fakes**, do not `vi.mock` internal modules.
- Inject `Clock` and `IdGenerator`; never call `Date.now()` or `Math.random()` in code
  under test.
- Name the rule, not the mechanics: `rejects an upload once the event quota is reached`.
- `src/domain` and `src/application` are gated at 100% branch coverage in CI.
- E2E is for journeys that cross surfaces (guest phone → host laptop → projector) or
  that only real infrastructure can break. No network stubbing, no `waitForTimeout`,
  throwaway database and media root per worker. See `.claude/skills/eventslide-e2e/`.

---

## Workflow

```bash
npm install
npm run dev        # API :4300 + web :5173
npm run verify     # lint + typecheck + coverage + build — the gate
npm run test:e2e   # Playwright journeys (needs `npx playwright install` once)
```

- Run `npm run verify` and **read the output** before reporting a task complete.
- Report failures verbatim. Never describe a failing suite as passing.
- Never weaken or skip a test to get green. Fix the code, or say the requirement is
  wrong and why.
- Commit with Conventional Commits, one concern per commit:
  `feat(domain): …`, `fix(http): …`, `test(application): …`, `docs: …`, `chore: …`.
- Never commit `photos/`, `thumbnails/`, `data/*.sqlite*`, `.env`, `dist/`, `coverage/`.

---

## Definition of done

- [ ] States which audience it serves: guest, host, or the room.
- [ ] Rules live in `domain`/`application`; adapters and components stay thin.
- [ ] Tests in the correct ring, red before the change, green after.
- [ ] `npm run verify` green, output read.
- [ ] No new untokenised style value, no new `any`, no new `process.env` read.
- [ ] `docs/API.md` updated if the HTTP contract moved.
