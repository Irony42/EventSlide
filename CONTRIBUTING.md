# Contributing to EventSlide

Thanks for looking at the code. This file is the short, human version. The full rules —
architecture boundaries, test rings, security posture, the traps already learned the
hard way — live in [CLAUDE.md](CLAUDE.md) (and its vendor-neutral twin,
[AGENTS.md](AGENTS.md), for any AI agent working here). Read one of those before your
first pull request; this file does not repeat them.

## Before you open a pull request

- `npm run verify` is green: lint, typecheck, coverage, build. Report the real output —
  a failing check reported as passing is the worst outcome this project can produce.
- Every rule your change states has a mutation that was run and went red, named in the
  PR body. `.claude/skills/eventslide-mutation/SKILL.md` is the protocol: break the rule
  on purpose, watch a test fail by name, then revert the mutation and prove the tree is
  clean.
- Commits are [Conventional Commits](https://www.conventionalcommits.org/), one concern
  each: `feat(domain):`, `fix(http):`, `test(application):`, `docs:`, `chore:`.
- Docs are updated when behaviour changes. `docs/API.md` §§1–8 is the contract for the
  HTTP surface; §9 is known divergences and proposals, not something implemented.

## Migration numbers

Schema changes live in `src/infrastructure/db/migrations/` as append-only, numbered
files (`001_initial_schema.ts`, `002_…`, …). The full recipe — writing the SQL,
indexes, constraints, backfills, the repository and its contract tests — is
`.claude/skills/eventslide-migration/SKILL.md`. This section is only about the number.

**The rule:** ids are unique, contiguous from `001`, and never renumbered once a
migration has merged to `main`. The order also respects foreign-key parentage — a
migration that `REFERENCES` a table carries an id greater than or equal to the id of the
migration that creates that table. `scripts/migrationIds.test.ts` checks all of this in
CI, as part of `npm run verify`; it fails by name on a duplicate id, a gap, or a
reference to a table that does not exist yet.

**Why a rule is needed at all:** more than one branch regularly adds "the next
migration" at the same time, each one correct against whatever `main` looked like when
it was branched. Left alone, that produces either a collision (two files claim the same
id) or a gap (a number nobody used), and the second pull request to merge is the one
that notices — after the fact, against someone else's diff.

**The protocol:**

1. When you add a migration, use the next id you can see on `main` right now. Name the
   file to match (`008_whatever.ts`), set `id: 8`, and register it in
   `migrations/index.ts`.
2. Treat that number as a placeholder until you actually merge. If another pull request
   reaches `main` first and has taken "your" number, rebase onto the new `main` and
   renumber — file name, `id` field, and the `migrations/index.ts` entry — to the new
   next integer, immediately before merging.
3. **Whichever pull request merges last is the one that renumbers.** The alternative —
   renumbering whoever merged first — rewrites history that other branches, and
   possibly already-deployed databases, have built on.
4. Never renumber a migration that is already on `main`. At that point it is permanent;
   see `.claude/skills/eventslide-migration/SKILL.md`'s "one rule" for what the migrator
   does if you try anyway (it refuses to boot against a database that already applied
   the migration you edited).
5. If your migration's SQL references a table a different migration creates, make sure
   yours carries the larger id. `scripts/migrationIds.test.ts` will tell you if it
   does not, by naming the table and the migration that actually creates it.

This is the whole of what G2-01 / P3-01 (see
`PLAN-SAAS-GRATUIT-DONS-EVENTSLIDE.md` / `PLAN-SAAS-PAYANT-EVENTSLIDE.md`) asks for: a
documented convention plus a CI test that enforces the parts of it a machine can check.
