---
name: eventslide-release
description: Recipe for cutting an EventSlide release (vX.Y.Z) the way it is actually done here — choosing the version, the release pull request (package.json, lockfile, manifest, both compose files, docs/API.md, CHANGELOG.md, docs/UPGRADING.md), the tag on the merge commit, the Release workflow and its `release` environment approval, the checks afterwards, and what to do when a step fails half way. Use when asked to "create a version", "cut a release", "tag vX.Y.Z" or "prepare the release PR", and before touching a version number anywhere.
---

# Cutting a release

A release here is **three things done in order by different hands**: a pull request that
writes the version down, a tag on its merge commit, and a workflow that builds, signs and
publishes the image. Merging the pull request publishes nothing; the tag does, and only
after the maintainer has approved the `release` environment. Everything below was read
from `.github/workflows/release.yml`, the scripts tests and the last releases
(v3.8.1 to v3.12.0); a step I could not confirm is marked **unverified**.

## What is in use today: hand-made release pull requests

Not release-please. `.github/workflows/release-please.yml` exists, with
`release-please-config.json` and `.release-please-manifest.json`, but it runs only on
"Run workflow" (`on: workflow_dispatch`, held by `scripts/releasePipeline.test.ts`,
"release-please, which is configured and switched off") and its own header says releases
are made by hand today. Evidence: the ten last releases, v3.4.0 to v3.12.0, each have a
merged pull request on a branch `release/X.Y.Z` titled `release: EventSlide X.Y.Z` (earlier
ones `chore(release): X.Y.Z`), written by hand; `CHANGELOG.md` says it is "written by hand
until releases are automated". **Do not run the Release PR workflow and do not edit
`release-please-config.json`.** Two things of release-please's still matter: the manifest
`.release-please-manifest.json` is bumped by hand with the rest (a test holds it equal to
`package.json`), and the comment `# x-release-please-version` on the `image:` line of
`compose.yaml` and `compose.build.yaml` must stay (a test matches it).

## Who does what

| Step                                                                                                  | Who                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Release pull request: write, check, open                                                              | The agent                                                                                                            |
| Merge it (a merge commit), once CI is green                                                           | The agent only if the maintainer's instructions say so; else the maintainer                                          |
| `git tag -a` and `git push origin vX.Y.Z`                                                             | Whoever the maintainer asked to "create the version" (a tag push **is** a publication; never on your own initiative) |
| **Approve the `release` environment** (Actions UI)                                                    | **The maintainer, only.** Stop and say so; never try to approve it, never work around it                             |
| Watch the run, verify afterwards                                                                      | The agent                                                                                                            |
| GitHub Discussion in Announcements                                                                    | Public post: ask first, unless the maintainer already said to                                                        |
| Upgrading the maintainer's hosted instance                                                            | The maintainer (not in this repository: **unverified**)                                                              |
| Repository settings (the `release` environment, the `versions` tag ruleset, the package's visibility) | The maintainer; nothing a pull request can change                                                                    |

`release` is an environment with **required reviewers**
(`gh api repos/Irony42/EventSlide/environments`). The `publish` job waits on it, whoever
pushed the tag. A run whose approval has not come is not a failure: tell the maintainer,
give the run URL, and stop. Do not poll for hours; set a deadline (v3.10.0's run took
3 h 16 min wall time, almost all of it waiting for the approval; v3.12.0's took 27 min).

## 1. Preconditions

```bash
git fetch --tags origin
gh run list --repo Irony42/EventSlide --workflow ci.yml --branch main --limit 3   # latest main run green
gh pr list --repo Irony42/EventSlide --state open                                  # nothing half-merged that belongs in this release
git tag --sort=-creatordate | head -3                                              # the last release
gh release list --repo Irony42/EventSlide --limit 3                                # it was published to the end (Latest)
git log --first-parent --format='%h %s' <last tag>..origin/main                    # what this release carries
```

- The tip of `main` is green (branch protection requires `Lint, typecheck, unit and
integration tests`, `Container image` and the five `End-to-end (...)` checks). A release
  is tagged on `main`, so do not release on top of a red `main`.
- **Open pull requests are not in the release.** If one belongs in it, it is merged first
  (by its own rules); the release pull request is written after, from the then tip of
  `main`. Say which open pull requests you are leaving out.
- The previous release is complete: its GitHub release exists and carries
  `image-sources-<its version>.txt` (that file is what "complete" means; see
  "A version is published once"). If it does not, fix that first.
- Work in a worktree cut from `origin/main`, never in a shared checkout; no `npm install`
  is needed for any step here.

## 2. Choose the version

Read `docs/UPGRADING.md`, "What a version number promises", and apply it to the commits
since the last tag (`git log --no-merges --format=%s <last tag>..origin/main`):

- **Major** (`4.0.0`): only if a commit is marked `feat!:` / `fix!:` or carries a
  `BREAKING CHANGE:` footer (CONTRIBUTING.md, "Changing what an existing installation
  sees"). Then the entry also needs a `### BREAKING` section and `docs/UPGRADING.md` needs
  `## Upgrading to N.0` (both held by `scripts/changelogPolicy.test.ts`). Stop and ask the
  maintainer before cutting a major: none has been made since 3.0.0.
- **Minor** (`3.13.0`): at least one `feat`, **or** a migration (a new file in
  `src/infrastructure/db/migrations/`), a new setting in `.env.example`, a new endpoint or
  error code, a visible change. v3.9.0 and v3.10.0 were minors with almost no `feat`
  commit; "a patch fixes and changes nothing you could have relied on".
- **Patch** (`3.12.1`): only fixes, with no migration, no new setting, no behaviour to
  check (v3.8.1 is the model).
- No release candidate has been cut so far. `vX.Y.Z-rc.N` is supported by the workflow
  (it moves no floating tag, and the GitHub release is marked prerelease) but its CHANGELOG
  and `package.json` handling is **unverified**: `package.json` must say the same string
  (`3.13.0-rc.1`) or the `resolve` job refuses.
- State your choice and the counts (`feat`, `fix`, migrations, settings) in the pull
  request body. If it is not obvious, ask the maintainer.

## 3. The files a release touches

Taken from the diffs of #448 (3.12.0), #437 (3.11.0), #433 (3.10.0), #389 (3.9.0) and
#378 (3.8.1). `X` below is the new version without the `v`.

| File                            | Change                                                                                                                                                                                   | Held by                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `package.json`                  | `"version": "X"`                                                                                                                                                                         | `scripts/versionSource.test.ts`                                                      |
| `package-lock.json`             | **two** places: the top `"version"` and `packages[""].version`. Edit by hand; the lock's dependency list does not change, so no `npm install`                                            | `scripts/releaseVersion.test.ts`                                                     |
| `.release-please-manifest.json` | `".": "X"`                                                                                                                                                                               | `scripts/releasePipeline.test.ts`                                                    |
| `compose.yaml`                  | `image: ghcr.io/irony42/eventslide:X # x-release-please-version`                                                                                                                         | `scripts/versionSource.test.ts`, `releasePipeline.test.ts`                           |
| `compose.build.yaml`            | `image: eventslide:X # x-release-please-version`                                                                                                                                         | same                                                                                 |
| `docs/API.md`                   | the three examples: `/api/health` `"version"`, `/api/about` `"version"`, and the `sourceUrl` ending `/tree/vX`. Every `"version": "..."` and every `/tree/v...` in the file must equal X | `scripts/releaseVersion.test.ts`                                                     |
| `CHANGELOG.md`                  | a new entry at the top, section 4                                                                                                                                                        | `releaseVersion.test.ts`, `changelogPolicy.test.ts`, `upgradingDocs.test.ts` (links) |
| `docs/UPGRADING.md`             | a minor adds `## Upgrading to X.Y` at the end of the file, section 5. A patch leaves it unchanged (#378)                                                                                 | `upgradingDocs.test.ts` (links, commands, settings, routes it names)                 |

Not touched by a release (checked: the string `3.12` does not occur anywhere else in the
tree of v3.12.0 but in the version-numbered files above and in two unrelated places):
`Dockerfile`, `docs/IMAGE-SOURCES.md` (it describes what **every** release attaches),
`src/` (the version is read from `package.json` by `src/main/version.ts`; a literal in
production code fails `versionSource.test.ts`), `README.md`.

`docs/releases/` held a hand-written draft of the GitHub release body per version until
3.11.0. #448 deleted the last one and wrote no new one, because `release.yml` now builds the
release body from the CHANGELOG entry. **Do not create a draft.** `docs/releases/v3.0.0.md`
is still there; leave it.

Handy, from the repository root (replace `OLD` and `NEW`; read the diff afterwards):

```bash
grep -rn --exclude-dir=node_modules --exclude-dir=.git -F 'OLD' package.json package-lock.json .release-please-manifest.json compose.yaml compose.build.yaml docs/API.md
```

and `Edit` each hit. `package-lock.json` has `OLD` only in those two root places; do not
replace a dependency's version that happens to be the same string.

## 4. The CHANGELOG entry

Insert it **directly under the "In an entry:" list at the top and above the previous
entry** (the tests take the first `## ` heading in the file as the newest).

```markdown
## [X] - YYYY-MM-DD

Everything merged to `main` after the tag `vPREV`: pull requests #A, #B and #C. This is a
minor release: <one sentence per theme>. <Migration and settings sentence, e.g. "No
migration, nothing to set." or "One migration, 028 (`user_tours`), applied at start-up.">

### The room <- by audience; use the ones that apply

### Guests

### Hosts and moderators

### Operators

### Under the hood <- no user-visible change (tests, CI, refactors)

### Dependencies and security

### Behaviour changes to check before upgrading

- No migration (the last is still 027), nothing to set in `.env`.
```

- **Heading exactly `## [X] - YYYY-MM-DD`**: version in brackets, `-`, a real ISO date,
  the day you tag (`releaseVersion.test.ts` checks the shape and that it is a real date;
  `release.yml` finds the entry by the prefix `## [X]`). A heading it cannot read, such as
  `## [Unreleased]`, is reported by `changelogPolicy.test.ts`.
- **Who it is for:** the people who run, host and use EventSlide, not the developers.
  Sections are by audience; each bullet is a bold sentence saying what changed for that
  person, then a few lines of why and how, ending with the pull request number in
  parentheses (`(#440)`). French UI labels are quoted as the screen shows them ("Modérer").
  The same text becomes the body of the GitHub release, and the first sentence of the
  paragraph under the heading is what a reader sees first.
- **Cite every pull request merged since the tag that a person could notice**, and name the
  rest under "Under the hood" or "Dependencies and security". List them with
  `git log --first-parent --format=%s <last tag>..origin/main | grep 'Merge pull request'`.
  The release notes #448 cited four pull requests and left out none of the user-visible ones.
- **`### Behaviour changes to check before upgrading` is always present** (for a patch:
  "None: no migration, no new environment variable, nothing to change before upgrading.").
  It names a migration **by number**, a new limit that is off unless set, a new boot
  warning, a redirect that now happens. See the three bullets in the preamble of
  `CHANGELOG.md`.
- **`### BREAKING` only in a major**; a `BREAKING` section in a minor or a patch fails
  `changelogPolicy.test.ts` ("only a major may break something"). A `### Deprecated` section
  lists what a later major will remove.
- **Links** written as `](relative/path)` must point at a file that exists, and an
  `#anchor` at a heading that exists (`upgradingDocs.test.ts`, "the links of CHANGELOG.md").
  `release.yml` rewrites relative links to `blob/vX/...` on the release page.
- Prose is wrapped at about 118 columns by hand; `npx prettier --write CHANGELOG.md` does
  not rewrap it (`proseWrap: preserve`).
- Check the migration claim against the tree: `git ls-tree --name-only origin/main
src/infrastructure/db/migrations/ | tail -3` and `git diff <last tag> origin/main --
.env.example`.

## 5. The `docs/UPGRADING.md` section (minor and major)

Append, after the previous `## Upgrading to ...` section, the shape of 3.12:

```markdown
## Upgrading to 3.13

3.13.0 is a minor release: it breaks nothing the policy above promises to keep, so there is
no `BREAKING` section. It applies **one migration** (028, ...) / **no migration** (the last
is still 027) and adds no setting. Take the steps of
[Upgrading with Docker](#upgrading-with-docker), or [without](#without-docker), with
`vX.Y.Z` as `v3.13.0`; the image is `ghcr.io/irony42/eventslide:3.13.0`.

### <one heading per thing a host must know>

- **Nothing to set.** ...
```

Anything it says to type (npm scripts, operator commands, settings, routes) is checked
against the code by `scripts/upgradingDocs.test.ts`.

## 6. Commands, in order

```bash
git fetch origin
git worktree add C:/src/es-wt/rc-release-X -b release/X origin/main     # or any worktree cut from origin/main
cd C:/src/es-wt/rc-release-X
# edit the files of section 3, write the entry (4) and the section (5)
npx prettier --write CHANGELOG.md docs/UPGRADING.md docs/API.md package.json package-lock.json compose.yaml compose.build.yaml .release-please-manifest.json
npx prettier --check .
npx vitest run scripts          # the release tests among them; add `npm run lint` if you touched anything else
git add -A
git commit -m "release: EventSlide X"          # one commit, plus the trailer your harness gives
git push -u origin release/X
gh pr create --repo Irony42/EventSlide --base main --head release/X --title "release: EventSlide X" --body-file <body>
```

Never force-push or rewrite pushed history; update the branch by merging `origin/main`
into it. No `npm run verify` is needed for a release pull request that touches no code
(#378 and #389 ran prettier and the release scripts tests; #433 and #437 ran more); if
the diff carries anything else, run it.

**The pull request:** base `main`, branch `release/X`, title `release: EventSlide X`, body
in the style of #448: what the release contains (`pull requests #..`), the version bump list,
the CHANGELOG and UPGRADING lines, the version choice and why, "No migration / migration N",
what is deliberately not in it, the checks you ran, and a last paragraph saying **after the
merge: tag `vX` on the merge commit, then `release.yml` builds and signs the image and
publishes the release, and the `release` environment waits for the maintainer's approval**.
End with the attribution line your harness gives.

Wait for CI (`gh pr checks <n> --repo Irony42/EventSlide --watch`, with a deadline) and merge
with a **merge commit**: `gh pr merge <n> --repo Irony42/EventSlide --merge`. Every release
so far is a `Merge pull request #N from Irony42/release/X` commit; the repository allows
squash and rebase too (checked), so do not use them: the tag goes on that merge commit.
Branches are deleted on merge (repository setting).

## 7. The tag

Only after the merge, on the merge commit, and only because the maintainer asked for the
version to be created:

```bash
git fetch origin
git switch --detach origin/main            # or: the merge commit of the release PR
git log -1 --format='%H %s'                # must be "Merge pull request #N from Irony42/release/X" (or a later main commit)
node -p "require('./package.json').version"   # must print X
git tag -a vX -m "EventSlide X" <that sha>
git push origin vX
```

- The tags of v3.11.0 and v3.12.0 are annotated (`git cat-file -t` says `tag`) with the
  message `EventSlide X`, on the merge commit of the release pull request. v3.9.0 sits on a
  later `main` commit (#391); what the workflow requires is only that the commit is on
  `main` and its `package.json` says X.
- **Why not before the merge:** `release.yml` refuses a tag whose version differs from the
  `package.json` of the tagged commit ("Tag the commit that bumped it"), and a commit not
  reachable from `origin/main` ("This commit is not on main, so it is not published").
  A tag cannot be moved after the workflow has pushed an image for it: do not tag
  speculatively.
- The tag name is exactly `vX.Y.Z` (no leading zeros) or `vX.Y.Z-rc.N`; anything else is
  refused by the `resolve` job. Creating tags matching `v*` is restricted by a ruleset
  (`versions`) to the maintainer's account; if the push is refused, stop and tell him.
- The push starts the **Release** workflow by itself. Nothing else (a push to `main`, a
  pull request, a schedule) ever does.

## 8. Watching the workflow

```bash
gh run list --repo Irony42/EventSlide --workflow release.yml --limit 3
gh run watch <id> --repo Irony42/EventSlide --exit-status      # give it a deadline; it can wait on an approval
gh run view <id> --repo Irony42/EventSlide --json jobs --jq '.jobs[]|"\(.name): \(.status) \(.conclusion)"'
```

Jobs, in order: `resolve` (works out tag, version, tags; refuses a version mismatch, a
commit off `main`, a run not started from `main` or a tag, and a release already complete)
→ `gate` (builds the image, runs `scripts/verify-image.sh`, writes an SBOM and scans it) →
**`publish` (waits for the `release` environment's approval: the maintainer's)** → pushes
`ghcr.io/irony42/eventslide:X` for `linux/amd64` and `linux/arm64` → `verify-published`
(same checks on the pushed digest, labels, SBOM, scan, writes `image-sources-X.txt`) →
`sign` (keyless cosign signature and SPDX attestation, then verified with the identity
documented in `docs/IMAGE-SOURCES.md`) → `promote` (moves the floating tags `X.Y` and `X`,
only if this is the newest release of that line) → `release` (creates the GitHub release,
body = the CHANGELOG entry + an "Image" paragraph, assets attached).

When the run is waiting at `publish`: tell the maintainer, with
`https://github.com/Irony42/EventSlide/actions/runs/<id>`, that the run needs his approval
of the `release` environment, and stop there. A whole run takes about 25 to 35 minutes
once approved (arm64 is built under emulation).

## 9. Verifying after the release

All of this needs only `gh` (this PC has no `docker` or `cosign`; the workflow's own
`verify-published` and `sign` jobs are what verify the image and the signature, so a green
run is the proof):

```bash
gh run view <id> --repo Irony42/EventSlide --json conclusion,jobs --jq '.conclusion, (.jobs[]|"\(.name): \(.conclusion)")'   # every job success, none skipped
gh release view vX --repo Irony42/EventSlide --json tagName,isPrerelease,assets,body --jq '.tagName, .isPrerelease, (.assets[].name), .body'
```

- Assets: `eventslide-X.spdx.json`, `IMAGE-SOURCES.md`, `image-sources-X.txt` (the last one
  last: its presence is what marks the release complete).
- The body starts with the CHANGELOG entry (if it starts with `## Image`, the entry was
  not found: the heading did not start with `## [X]`; edit the release body with
  `gh release edit`, or note it for the maintainer) and then `## Image` with
  `ghcr.io/irony42/eventslide@sha256:...` and the tags `X`, `X.Y`, `X`'s major
  (`3.13.0`, `3.13`, `3`). No `latest`, on purpose.
- `compose.yaml` at the tag pulls `ghcr.io/irony42/eventslide:X`:
  `git show vX:compose.yaml | grep 'image:'`.
- Locally, if `docker` and `cosign` exist (**unverified here**): the commands of
  `docs/IMAGE-SOURCES.md`, "Checking the signature".
- Post a GitHub Discussion in the **Announcements** category, titled
  `EventSlide X.Y: <the three or four main things>` (#465 for 3.13.0, #439, #392, #380 are
  the models). Body: a bold one-sentence summary, a bullet per change a user will notice,
  a "Before upgrading" line (migration number, settings; "Nothing to set" otherwise), the
  links to `CHANGELOG.md` and `docs/UPGRADING.md` at the tag, and the image and release
  links. It is a public post: ask the maintainer first unless he has said to post it. The
  command (used for #465), with the body in a file:

  ```bash
  gh api graphql -f query='{repository(owner:"Irony42",name:"EventSlide"){id discussionCategories(first:10){nodes{id name}}}}'
  gh api graphql -f query='mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{number url}}}' \
    -f repo=<repository id> -f cat=<the Announcements category id> -f title="EventSlide X.Y.Z: ..." -F body=@<file>
  ```

- Tell the maintainer the hosted instance can be upgraded; that is his. Its runbook (in his
  private infrastructure repository) forbids an upgrade from Friday 16:00 to Sunday midnight
  and during a live event: say so when the release lands in that window.

## 10. When a step fails half way

- **The workflow is red before `publish`** (`resolve` or `gate`): nothing was pushed. Read
  the error. A tag naming the wrong version or a commit off `main`: delete the tag
  (`git push origin :refs/tags/vX` and `git tag -d vX`) **only** because nothing was
  published, say so to the maintainer first, fix on `main` through a pull request, tag again.
  A `gate` failure (vulnerability, `verify-image.sh`) is a bug to fix on `main`, then tag the
  new commit; the `package.json` version stays X.
- **Red after `publish`** (`verify-published`, `sign`, `promote` or `release`): the exact
  tag `X` is already in the registry but the release is incomplete. **Do not move the tag
  and do not bump the version.** Start the same tag again: Actions > Release > Run workflow,
  branch **main**, `tag` = `vX`, `publish` **checked**, or
  `gh workflow run release.yml --repo Irony42/EventSlide --ref main --field tag=vX --field publish=true`.
  The `resolve` job lets a run through whose `image-sources-X.txt` is not attached yet (a
  run that failed half way, with or without a GitHub release), builds and pushes again (the
  environment asks the maintainer for a new approval), and replaces the artifact of the
  first run. A run started from another branch is refused. Re-run job by job from the
  Actions UI is the maintainer's choice; the command above is what is documented.
- **A release that completed is never pushed a second time** ("A version is published once:
  fix forward with the next patch"). If the image is wrong, the fix is `X.Y.(Z+1)`, by this
  whole procedure.
- **A hang in the `sign` job's verify step** has happened (v3.0.0, three times); the step has
  its own 12-minute limit and uploads `cosign-diagnostics`. Read that artifact before
  re-running.
- **The release pull request conflicts** (another pull request merged first and touched
  `CHANGELOG.md`, `docs/API.md` or `docs/UPGRADING.md`): `git merge origin/main` into
  `release/X` (never rebase, never force-push), resolve, then **redo the section 4 listing**:
  the new pull request is in the release, so cite it, and re-check the version choice. If
  something other than release files landed after you wrote the entry, the entry is stale.
- **Main moved after the release pull request merged but before the tag**: tag the merge
  commit of the release pull request, not the tip; what is after it is the next release.
  (`release.yml` accepts any commit on `main` whose `package.json` says X.)
- **CI on the release pull request is red for a reason that is not the release**: fix it on
  its own pull request first (#448 carried two such commits; prefer not to).

## Traps found in the history and the tests

- Forgetting the lockfile's own version or the manifest: nothing in the build notices
  (`npm ci` accepts a stale root version); `releaseVersion.test.ts` and
  `releasePipeline.test.ts` do, so run `npx vitest run scripts` before you push.
- `docs/API.md` has three version spots, not one.
- An entry whose date is not a real date, or which is not the first `## ` of the file.
- `BREAKING` words in a minor's entry; `## [Unreleased]` headings.
- A CHANGELOG or UPGRADING link to a heading that does not exist.
- Tagging before the merge, or tagging a commit whose `package.json` is not X.
- Approving or "unblocking" the environment yourself, or pushing the image by hand: the
  workflow is the only thing that publishes (`releasePipeline.test.ts` holds that nothing
  else can).
- Opening the release pull request from the shared checkout, or with `npm install`: the lock
  would drift. Hand-edit the two lines.
- Leaving a release draft in `docs/releases/` or recreating one.
- Running `release-please.yml` "to see": it opens a pull request nobody asked for.
