## What this changes, and why

<!-- One or two sentences. Link the issue or the plan item if there is one. -->

## Who it is for

<!-- CLAUDE.md §1: every change names the audience it serves. Tick at least one. -->

- [ ] **Guest** — the phone: `/join/:code`, `/e/:slug/upload`
- [ ] **Host / moderator** — the console: `/admin/**`
- [ ] **The room** — the projected wall: `/e/:slug/display`
- [ ] None of them (tooling, CI, documentation)

## Before this can be merged

- [ ] **CLA.** The CLA bot comments on your first pull request. Reply with the sentence it
      gives you, and the `CLA signed` check goes green. One signature covers every later
      pull request. The text is [docs/CLA.md](../docs/CLA.md); it is a licence grant, and
      you keep your copyright. The maintainer and Dependabot are exempt.
- [ ] `npm run verify` is green, and I read its output.
- [ ] Every rule this change states has a mutation that went red, named below.
- [ ] Docs are updated where behaviour changed (`docs/API.md` §§1–8 is the HTTP contract).

## Guards and mutations

<!-- Which tests protect this change, and which edit to the code made each one fail. -->
