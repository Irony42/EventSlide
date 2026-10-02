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

**The rule:** ids are unique, contiguous from `001`, never renumbered once a migration
has merged to `main`, and ordered so that a migration referencing a table carries an id
greater than or equal to the id of the migration that creates that table.

**What `scripts/migrationIds.test.ts` actually checks in CI**, as part of
`npm run verify`: it fails by name on a duplicate id, a gap in the contiguous sequence,
or a reference to a table that does not exist yet. That is three of the four — a
duplicate, a gap or a bad forward reference are all visible from the current
`migrations` array alone, so a test can catch them mechanically.

**"Never renumbered once merged" is not merge-time CI-checked here.** Catching it
would mean diffing the current ids/names against what `origin/main` had at the
migration's own merge, and a standard shallow, single-ref CI checkout
(`actions/checkout@v4`'s default `fetch-depth: 1`) does not have `origin/main` to diff
against without first changing `.github/workflows/ci.yml` to fetch full history on
every run — a real cost, for a rule two cheaper layers already cover: code review (this
is a visible, one-line diff), and `migrator.ts`'s own boot-time guard, which refuses to
start against a database that already applied the old id/name/SQL the moment anyone
relabels a merged migration (`MigrationError`, loud, before any query runs). The gap is
real and known, not silently assumed to be covered — see the pull request that added
this file for the tradeoff.

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

## Changing what an existing installation sees

[docs/UPGRADING.md](docs/UPGRADING.md) is what the people who run EventSlide have been
promised, and a pull request is held to it. `scripts/changelogPolicy.test.ts` and
`scripts/upgradingDocs.test.ts` check what a machine can.

- **A break is a major.** Removing or renaming what that page lists as promised (an API route
  or error code, a setting, an operator command), or changing what a default does to an
  installation that already runs, is a break. Mark the commit `feat!:` (or `fix!:`) with a
  `BREAKING CHANGE:` footer, and add the `## Upgrading to N.0` section to that page in the
  same pull request: who is affected, what to change and in which order, how to tell it
  worked. Once one has merged, the next release is a major.
- **A refusal at boot starts as a warning.** If an installation that runs today would be
  refused, log a warning instead (`computeWarnings` in `src/infrastructure/config/env.ts`) and
  refuse only in a major. A default that destroys data starts as an opt-in.
- **Something to remove is deprecated first**, with a warning logged when it is used where
  the code can, for at least one minor release and 90 days.
- **A migration is SQL only.** It holds no program code, so what happens to existing rows is
  what one SQL statement can compute. Where a feature needs a value they cannot be given, they
  keep a default or `NULL` and the feature reads that as "not set".
- **Leave `CHANGELOG.md` to the release.** The entry is written when the release is prepared,
  from the commit messages, so a commit that breaks or changes behaviour says so in its own
  words.
