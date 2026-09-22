---
name: eventslide-mutation
description: Prove a guard bites by breaking the rule it guards and watching a test go red. Use before opening any pull request, when a change states a rule ("X can never happen", "Y is refused", "the budget wins over the host"), when reviewing whether an existing test actually protects anything, and whenever a test was green on the first run and you have not established what makes it fail.
---

# Proving a guard, instead of asserting one

Every branch in this repository has been green on `npm run verify` before review. Every
one still contained at least one defect that would have reached a real event. A
55-mutation audit found the pattern behind all of them, and it has not changed since:

> **Every defect that survived was a rule stated only in a comment, with no test that
> fails when the rule breaks.**

A passing test proves that the code does something. It does not prove that the code does
the thing the comment claims, and it does not prove that anyone would notice if it
stopped. Only a mutation proves that: break the rule on purpose, run the suite, and watch
something go red **by name**.

This skill is the protocol. It costs minutes and it is the only technique in this
repository with a measured record of finding real defects.

## The protocol

**1. List what the change claims.** Read your own diff and write down every sentence that
is a rule rather than a description. They hide in commit messages, in doc comments, in
PR bodies and in test names. The tell is a modal: _never_, _always_, _cannot_, _must_,
_only_, _refuses_, _wins over_.

**2. For each claim, write the smallest edit that makes it false.** Not a plausible bug —
_the_ edit a future maintainer would plausibly make. Flip a comparison, delete a clause
from a `WHERE`, add the `|| isOperator` fallback somebody will reach for, return the
stored value instead of the narrowed one, remove an `await`.

**3. Run the narrowest suite that should catch it.** `npx vitest run <file>` for one
ring, `npx playwright test <spec>` for ring 6. If nothing goes red, you have found a
defect — an unguarded rule — and it is more valuable than the feature you were writing.

**4. Revert the mutation and prove the tree is clean.** `git status` in your report, not
just in your head. A mutation left behind is the worst possible outcome of this skill.

**5. Report what bit and what did not**, by test name and count. "All tests pass" is not
a result. `19 failed | 15 passed`, naming the cases, is.

## Writing the mutation down

A mutation that is only in your transcript is lost the moment the session ends. Put it in
the PR body as a table, because the next person to touch that guard needs to know it
exists:

| Mutation                                                     | Result                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `requireRole` falls back to `\|\| isOperator`                | **27 red** — every "budget still wins" case, plus the wall's |
| drop `AND disabled_at IS NULL` from the adapter query        | **contract red on the fake _and_ on SQLite**, plus ring 6    |
| `siteRoleFor` returns the stored role for a disabled account | **1 red** — the ring-3 case that pins it                     |

## What a good mutation looks like here

The rules this repository keeps breaking are specific, so the mutations are too.

**Authorization.** Add the elevation somebody will one day add on purpose: `role ??
'owner'` when a membership is missing, an `|| isOperator`, a `requireUser` where a
`requireRole` belongs. Mount an unguarded route and see whether the route sweep notices —
`siteOperatorScope.test.ts` exists because a sweep that enumerates real routes catches
the route nobody remembered to guard.

**Fakes against adapters.** Delete a constraint the fake enforces and the real database
also enforces, then run the shared contract suite in
`src/application/testing/contracts/`. A critical bug once shipped here precisely because
a fake did not enforce a UNIQUE index that SQLite did; a fake that accepts what the real
one rejects — or delivers what a real browser filters — will lie to you again.

**Ordering and side effects.** An end-state assertion cannot see that two writes happened
in the wrong order, nor that the first of two guards did nothing.
`src/application/testing/callLog.ts` exists for exactly those. Swap two calls and see
whether anything notices.

**Migrations.** Change the backfill's `WHERE`, restore the previous SQL, run the
migration tests. `migrator.ts` hashes migration SQL as text for a reason — read it before
you decide a migration edit is safe.

**Rendering and determinism.** Remove the input a visual baseline pins — the interval, the
id, the origin — and see whether the shot still passes. CLAUDE.md §9 trap 10 records what
it costs when it does: four pull requests red on a baseline that was one of two images
34% apart, rendered from identical DOM.

**Documentation.** If a document names a test, a route or a fixture, check it exists.
`freshServerTest` was referenced in four documents and one adapter comment before anybody
noticed nobody had written it.

## When a mutation does not go red

You have three honest options, in order of preference.

**Write the missing test.** Usually right, usually small, and it is the whole point of
having run the mutation.

**Delete the claim.** If the rule is not worth a test, it is not worth asserting in prose
either. A comment that promises a guarantee nobody enforces is worse than silence,
because the next reader will build on it.

**Say it is unguarded, in the PR.** Acceptable when the guard is genuinely expensive and
the risk is understood — the wall's `--surface-scrim` sat at a known-wrong contrast for
weeks with a test pinning the number so it could not quietly worsen. That is a deliberate
open finding, not an oversight, and the difference is that it is written down.

What is never acceptable: raising a threshold, masking a region, loosening a compiler
flag, or weakening an assertion so the mutation passes. CLAUDE.md is explicit — fix the
code, or say plainly that the requirement itself is wrong.

## Scope

Three to eight mutations is the right size for a feature branch. You are not running a
mutation-testing tool over the tree; you are testing **the rules your change states**.

Prefer the mutation that a maintainer would actually make. `x + 1` in an arithmetic
expression teaches nothing. The `|| isOperator` that makes a support feature work teaches
you whether your authorization holds.
