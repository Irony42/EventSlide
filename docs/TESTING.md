# docs/TESTING.md — the EventSlide 2.0 test strategy

Reference for deciding **where a test goes, what it may fake, and when it is allowed to
be slow**. Companion to [CLAUDE.md](../CLAUDE.md) §5 (the summary) and
`.claude/skills/eventslide-testing/` (the step-by-step recipe). This document is the
deep version: mechanics, rationale, and the failure it prevents.

> **Status.** 2.0 is being built; the tree currently on disk under `src/` is still the
> 1.0 code being replaced. Everything below describes the **target** — including the
> lint rules, scripts and coverage gates it names, and every path marked _(planned)_.
> None of it is a claim that the file already exists; do not report it as implemented.

---

## 1. Philosophy

1.0 had **zero tests** and a CI job that went green on `jest --runInBand
--passWithNoTests`, so for its entire life the build proved only that TypeScript
compiled. The queue of shipped defects is the receipt: a QR page emitting `?partyname=`
against an upload page reading `?party` (every guest uploaded to the default event), a
`fileFilter` that trusted `file.mimetype`, no EXIF rotation and no EXIF stripping, a
`sharp` failure after the DB insert leaving rows with no file, `MemoryStore` sessions,
and a slideshow index in `sessionStorage` so two projectors disagreed. Not one of those
needed a clever test — each needed _a_ test, in a place cheap enough that someone would
have written it. So the fix in 2.0 is not "more tests": it is **placing tests where
they are cheap and honest**. Cheap means a business rule is a function call, not a
booted server (`src/domain` is pure; `buildServer(deps)` never calls `listen()`).
Honest means the double behaves like the real thing (fakes verified against the same
contract suite as the SQLite adapter, keyed so a cross-tenant read genuinely misses)
and the gate cannot pass on nothing (coverage thresholds fail an empty suite, which is
the structural replacement for `--passWithNoTests`).

---

## 2. The six rings

| Ring            | Location                          | Question it answers                       | Doubles                                         | Runtime |
| --------------- | --------------------------------- | ----------------------------------------- | ----------------------------------------------- | ------- |
| 1 Domain unit   | `src/domain/**/*.test.ts`         | is the rule correct?                      | none — the code is pure                         | µs      |
| 2 Use case      | `src/application/**/*.test.ts`    | is the orchestration correct?             | in-memory fakes from `src/application/testing/` | <1 ms   |
| 3 Adapter       | `src/infrastructure/**/*.test.ts` | does the adapter honour the port?         | real SQLite `:memory:`, real `mkdtemp` dirs     | ms      |
| 4 HTTP contract | `src/interface/http/**/*.test.ts` | is the wire contract and the authz right? | supertest against `buildServer(deps)` + fakes   | ms      |
| 5 Component     | `web/src/**/*.test.tsx`           | does the UI behave?                       | Testing Library + fake transport                | ms      |
| 6 E2E           | `tests/e2e/**/*.spec.ts`          | does the journey work for real?           | none — real server, real SQLite, real browsers  | seconds |

Rings 1–5 run under vitest (projects `server` = node, `web` = jsdom). Ring 6 runs under
Playwright and is deliberately outside the vitest include globs, so `npm run test:run`
never tries to execute a `.spec.ts` from `tests/e2e`.

| Ring | Put it here when…                                                                                                                                                                                                                                                                                                  | Do **not** put it here when…                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | a conditional, a calculation, a status transition, a validation, an ordering: `photo.publish()` refusing an archived event, join-code alphabet, slug normalisation, quota arithmetic, moderation queue order, Ken Burns duration derived from the slide interval                                                   | the answer needs another object loaded, or any I/O. Needs a repository → ring 2. Needs `fs` → the rule is in the wrong layer                                                                          |
| 2    | objects are coordinated or side effects sequenced: upload writes the file _then_ inserts _then_ publishes on the bus; publish emits exactly one `photo.published`; a cross-event lookup returns `photo.notFound`                                                                                                   | what you actually doubt is the SQL, the `sharp` pipeline, or a status code. A ring-2 test asserting `409` pins the wrong layer — the use case returns a `Result`, and `presenters/send.ts` maps it    |
| 3    | the code touches SQLite, `fs`, `sharp`, `bcrypt` or HMAC: migrations applying in order, `ON DELETE CASCADE` clearing an event's photos, magic-byte detection, EXIF stripped and orientation baked, content-addressed paths, token signatures                                                                       | you are re-testing a business rule through the adapter. Assert port behaviour (`countBytes` sums one event); leave the quota arithmetic in ring 1                                                     |
| 4    | the subject is a status code, header, cookie flag, zod rejection, error code, rate limit, or authorization decision: `401` with no session, `403` for a moderator of another event, `403` for a guest token on a moderation route, `400` + `request.invalid`, `413` on quota, `429`, `404` for media across events | you are walking a multi-step flow. Supertest _can_ express "upload then moderate then list", but a ring-4 test exercises **one** request; the flow belongs in ring 2 (cheaper) or ring 6 (honest)     |
| 5    | the subject is what a user sees, clicks or is told: the upload queue reporting each file `done`, a retry after a dropped network without losing the file, the four states every screen needs (loading, empty, error, populated), keyboard operability                                                              | you would assert a business rule ("is this photo publishable") — a server decision; the component renders what the DTO says. Never real network: inject the fake transport, never mock `global.fetch` |
| 6    | the test crosses surfaces (guest phone → host desktop → projector) or exercises what only real infrastructure can break: a real multipart upload through `sharp`, EXIF orientation visible in rendered pixel dimensions, SSE propagation with no reload, media authorization on real bytes                         | a cheaper ring can catch it. A ring-6 test for a validation message is CI seconds buying nothing                                                                                                      |

When a bug escapes, the regression test goes in **the cheapest ring that would have
caught it** — plus ring 6 only if the leak was in the wiring between rings.

---

## 3. Fakes, not mocks

`src/application/testing/` _(planned)_ holds a real in-memory implementation of every
port. They are production-quality code, and they are verified by the same contract
suites as the SQLite adapters (§4).

| Fake                    | Behaviour that has to be real                                                        |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `FakeEventRepository`   | slug and join-code uniqueness, exactly as the SQLite unique indexes enforce          |
| `FakePhotoRepository`   | keyed by `${eventId}:${photoId}`; `list` filters by `eventId` and sorts newest first |
| `FakeGuestRepository`   | a device token belongs to one event and resolves in no other                         |
| `FakeUserRepository`    | per-event role membership, so "moderator" is never global                            |
| `InMemoryMediaStore`    | byte buffers, `put`/`get`/`delete`, reports real sizes                               |
| `FakeImageProcessor`    | deterministic metadata, simulates rotation and simulates failure on demand           |
| `FakeClock`             | `now()`, `advance(ms)`                                                               |
| `SequentialIdGenerator` | `id-1`, `id-2`, … so assertions are readable                                         |
| `RecordingEventBus`     | `published: DomainEvent[]`                                                           |
| `FakePasswordHasher`    | `hash:<password>` — no bcrypt cost in ring 2 or ring 4                               |

### Why the key shape is load-bearing

A stub that returns what it was told cannot fail a tenant test. Neither can a fake with
the wrong key:

```ts
// WRONG — this fake makes a cross-tenant bug pass.
private readonly rows = new Map<PhotoId, Photo>()
async findById(_eventId: EventId, photoId: PhotoId) {
  return this.rows.get(photoId) ?? null                    // eventId ignored
}

// RIGHT — src/application/testing/fakePhotoRepository.ts (planned)
private readonly rows = new Map<string, Photo>()
private key(eventId: EventId, photoId: PhotoId) { return `${eventId}:${photoId}` }
async findById(eventId: EventId, photoId: PhotoId) {
  return this.rows.get(this.key(eventId, photoId)) ?? null
}
```

With the first map, a use case that calls `photos.findById(photoId)` — dropping the
scope — still returns the photo, so the test named _cannot publish a photo that belongs
to another event_ goes **green while the product is broken**. With the composite key,
`findById('wedding', 'p1')` genuinely misses a row stored as `gala:p1`, which is exactly
what SQLite does with `WHERE event_id = ? AND id = ?`. The same reasoning covers `list`
(filters by `eventId`) and `countBytes` (sums one event): a quota that counted every
tenant's bytes fails a ring-2 test instead of surfacing at someone's wedding.

### The rules

- `vi.mock` of an **internal** module is banned: it couples the test to import structure,
  so it breaks on a rename and survives a behaviour change — exactly backwards. 1.0's
  untestability had one root cause, the module-level mutable `export let db` in
  `src/database.ts`; mocking that module would have preserved the defect, not removed it.
- `vi.mock` of a **third-party** module with no seam is acceptable, with a comment
  saying why no port was possible.
- Never assert that a spy was called. Assert the resulting state: repository content,
  `bus.published`, the response body, the rendered DOM.
- One fake used by fifty tests has one place to fix. Per-test stubs drift, and drifted
  stubs lie.

---

## 4. Shared port contract suites

A contract suite is a `describe` block parameterised by a factory, exported from
`src/application/testing/contracts/` _(planned)_, and **run against every
implementation of the port**.

```ts
// src/application/testing/contracts/photoRepositoryContract.ts
export const photoRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: PhotoRepository; dispose?: () => Promise<void> }>,
) => {
  describe(`PhotoRepository contract: ${name}`, () => {
    it('returns null for a photo that belongs to another event', async () => {
      /* … */
    })
    it('lists newest first', async () => {
      /* … */
    })
    it('filters by status', async () => {
      /* … */
    })
    it('sums bytes for one event only', async () => {
      /* … */
    })
    it('is idempotent on delete', async () => {
      /* … */
    })
  })
}
```

```ts
// src/infrastructure/db/sqlitePhotoRepository.test.ts   (ring 3)
photoRepositoryContract('sqlite', async () => {
  const db = new Database(':memory:') // migrated, pragmas set
  return { repo: new SqlitePhotoRepository(db), dispose: async () => db.close() }
})

// src/application/testing/fakePhotoRepository.test.ts    (ring 2 support)
photoRepositoryContract('fake', async () => ({ repo: new FakePhotoRepository() }))
```

Why both must run it: every ring-2 test is an argument of the form "the use case behaves
correctly **against this fake**", and that argument is worth nothing unless the fake
behaves like SQLite. The contract suite is the only thing holding the two together — a
fake that sorted oldest-first would otherwise make a dozen moderation-queue tests pass
and let the queue arrive backwards in production.

A contract suite may use **only the port's own methods** — no SQL, no peeking inside the
fake's `Map`; if it needs implementation knowledge it is not a contract. It cleans up
through `dispose?()` so the SQLite variant closes its connection, and it takes time and
ids from parameters or seeded builders, never from the ambient clock.

**Rule: a new port method requires a new contract case, in the same commit.** Adding
`findByContentHash(eventId, hash)` to `PhotoRepository` without one lets the fake and
the adapter disagree from day one, and that disagreement surfaces as a duplicate photo
on a wall rather than as a red test. There is a suite per port — `EventRepository`,
`PhotoRepository`, `GuestRepository`, `UserRepository`, `MediaStore`, `ImageProcessor`,
`PasswordHasher`, `TokenService` — each run for its SQLite/filesystem/sharp/bcrypt/HMAC
adapter and for its fake. `Clock` and `IdGenerator` are the only exemption: there is no
behaviour there worth pinning.

---

## 5. Builders

`src/application/testing/builders.ts` _(planned)_ exports `anEvent()`, `aPhoto()`,
`aGuest()`, `aUser()`. Sensible defaults, partial override, plain strings branded
internally so tests stay readable.

```ts
const photo = aPhoto({ eventId: 'mariage', status: 'pending', byteSize: 2_400_000 })
```

**Specify only the field under test.** Two reasons. First, a test that sets fourteen
fields hides its own point: the reader cannot tell which value the assertion depends on,
so the next person changes the wrong one. Second, when a required field is added later —
`quotaBytes` on `Event`, `contentHash` on `Photo` — the new default lands in **one**
file. Tests built from object literals break in ninety files at once, and the usual
response to ninety broken files is `as any`, which is banned (CLAUDE.md §3.7) precisely
because it would hide the missing field.

Builders return **domain entities**, not rows. A test needing a persisted row goes
through the repository (`photos.seed(aPhoto(...))` for the fake, `repo.save(...)` for
SQLite), so row shape stays the adapter's business.

---

## 6. Determinism

A flaky test is worse than no test: it trains the team to re-run CI. Every source of
non-determinism is closed at the seam.

| Source          | Closed by                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Wall-clock time | `Clock` port; `FakeClock(new Date('2026-06-20T21:00:00Z'))`, `advance(ms)`                          |
| Ids             | `IdGenerator` port; `SequentialIdGenerator` → `id-1`, `id-2`, …                                     |
| Filesystem      | `await mkdtemp(join(tmpdir(), 'eventslide-'))` per test, removed in `afterEach`                     |
| Module state    | nothing is constructed at import time; `src/main/container.ts` and the test harness build the world |
| Timers in UI    | `vi.useFakeTimers()` + `advanceTimersByTimeAsync`                                                   |
| bcrypt cost     | `FakePasswordHasher` in rings 2/4; real cost 12 only in the bcrypt adapter's own ring-3 test        |
| Secrets         | fixed `SESSION_SECRET` / `GUEST_TOKEN_SECRET` in the test env, so HMAC output is stable             |

```ts
// ring 3: a per-test media root, so two tests can never see each other's bytes
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'eventslide-media-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
```

```tsx
// ring 5: the slideshow advances on an interval — drive it, never wait for it
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('advances to the next slide after the configured interval', async () => {
  renderWithProviders(<DisplayWall slug="demo" intervalMs={10_000} />, { transport })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(screen.getByTestId('wall-slide')).toHaveAttribute('data-index', '1')
})
```

With fake timers installed, `userEvent` must be told about them —
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` — or its internal waits
never resolve and the test times out looking like a product bug.

**`Date.now()`, `new Date()`, and `Math.random()` are banned in code under test** —
`src/domain`, `src/application`, and `web/src`. They are permitted in exactly two
places, both adapters behind a port: `src/infrastructure/time/systemClock.ts` and the id
generator in `src/infrastructure/crypto/`. This is an eslint rule
(`no-restricted-syntax` / `no-restricted-globals` scoped to those directories), not a
convention, because the failure mode is a suite that passes for a year and then fails at
23:59 UTC or on a leap day.

No test depends on another test's state: `beforeEach` builds a fresh world, every time.
There is no shared module-level `db` any more — that single 1.0 global is why 1.0 had no
tests at all.

---

## 7. A test that fails for exactly one reason

**Bad** — this is the shape to recognise and reject:

```ts
it('moderation works', async () => {
  const event = anEvent({
    id: 'e1',
    slug: 'mariage',
    name: 'Camille & Sacha',
    joinCode: 'ABC123',
    status: 'live',
    quotaBytes: 5_000_000 /* …9 more fields… */,
  })
  const spy = vi.spyOn(harness.photos, 'save') // mechanics
  const guest = await joinAsGuest(harness, 'mariage') // act 1
  await guest.post('/api/events/mariage/photos').attach('photos', jpeg) // act 2
  const res = await moderator
    .patch('/api/events/mariage/photos/p1/status')
    .send({ status: 'published' }) // act 3
  expect(res.status).toBe(200)
  expect(spy).toHaveBeenCalled()
  expect(await harness.photos.list(event.id)).toHaveLength(1)
  expect(res.body.message).toBe('Photo publiée') // French UI copy
})
```

Five distinct failures of diagnosis: the name says nothing, so a red run tells you only
that "moderation" is broken; three acts mean the failure could be in any of them; the
spy is green even if nothing was stored; `200` contradicts the documented `204`, so the
test pins the wrong contract; and the message assertion breaks on a copy edit in
`web/src/lib/i18n/` that changed no behaviour at all.

**Good** — one rule, one act, observable assertions:

```ts
it('refuses an upload once the event byte quota is reached', async () => {
  const event = anEvent({ slug: 'mariage', quotaBytes: 1_000 })
  photos.seed(aPhoto({ eventId: event.id, byteSize: 1_000 }))

  const result = await uploadPhotos({ eventId: event.id, files: [aFile({ bytes: 1 })] })

  expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
  expect(media.size()).toBe(1) // nothing was written for the refused file
})
```

The mechanics:

- **The name is the requirement**, not the mechanics. If it needs "and" twice, it is
  two tests.
- **Arrange / act / assert, blank-line separated, exactly one act.**
- **Assert observable behaviour**: return value, repository content, `bus.published`,
  rendered DOM, response status. Never that a private helper ran.
- **Assert error codes, never messages.** `event.quotaExceeded` is the stable contract;
  messages are French UI copy.
- **Assert the negative too** — here, that no bytes leaked into the media store. The 1.0
  "`sharp` fails after the insert" defect was exactly a missing negative assertion.
- **No logic in a test.** `it.each` over cases is fine; an `if` is not — a branch means
  one path is never exercised and nobody knows which.
- **Watch it fail first.** Break the guard, check the failure names the right rule,
  restore. A test never seen red is an assumption.

---

## 8. Security invariants get named tests

These are never folded into a happy path, and never asserted only as a side effect.
Each has its own `it`, named after the attack it refuses.

| Invariant                                                                       | Rings      | Where                                                                                     |
| ------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Every event-scoped repository method misses across events                       | 3          | contract suites, run for SQLite and the fake                                              |
| Every event-scoped route refuses another event's data                           | 4          | `src/interface/http/**/*.test.ts`                                                         |
| A guest token grants upload to exactly one event and nothing else               | 4, 6       | route tests + `tests/e2e/security/guest-token-scope.spec.ts`                              |
| A moderator of event A is refused (403) on event B                              | 4, 6       | route tests + `tests/e2e/security/tenant-isolation.spec.ts`                               |
| A guest cannot delete someone else's photo, nor their own past the grace window | 2, 4       | use case + route tests                                                                    |
| Magic bytes reject a renamed `.php`, an `.svg`, and a JPEG/HTML polyglot        | 3, 4, 6    | `src/infrastructure/media/magicBytes.test.ts` + upload route + `upload-hardening.spec.ts` |
| Oversize files and pixel bombs are rejected **before** decode                   | 3, 4       | byte limit and declared-dimension checks, asserted as rejection without a `sharp` decode  |
| Stored output carries no EXIF GPS and no device serial                          | 3, 6       | sharp pipeline test reads the stored file back                                            |
| A quota-full event stops accepting uploads instead of filling the disk          | 1, 2, 4, 6 | quota arithmetic, use case, `413`, e2e                                                    |
| The session id changes on login (fixation)                                      | 4          | login route test compares the `Set-Cookie` session id before and after                    |
| Media URLs from event A return 404 for a session on event B                     | 4, 6       | media controller test — the reason media is never `express.static`                        |
| Public write endpoints return 429 when rate-limited                             | 4          | rate-limit middleware test with a low configured limit                                    |
| `e2e_interval` / `e2e_transition` are ignored unless `E2E_HOOKS=1`              | 4          | asserts the test hooks cannot be driven in production                                     |

Tenant isolation is asserted at **ring 3 and ring 4** because they fail differently:
ring 3 catches a repository method that forgot `AND event_id = ?`, ring 4 catches a
route that never passed the scope in. The magic-byte cases use **real bytes** — a file
starting `<?php`, an SVG with an inline `<script>`, a valid JPEG with HTML appended —
because a test that asserts on a MIME string re-creates the 1.0 defect it exists to
prevent.

---

## 9. End to end

Ring 6 exists for one question: **does a photo taken on a phone actually appear on the
projector?** That path crosses a mobile browser, a multipart upload, `sharp`, SQLite, a
moderation decision, an SSE frame, and a second browser context. Every cheaper ring
passes with that path broken.

**Belongs in e2e:** cross-surface journeys (guest upload → moderation → wall), EXIF
rotation asserted from rendered pixel dimensions, SSE arrival with no reload, real
multipart uploads, the security journeys above, the wall's visual layouts, axe checks.
**Does not belong:** validation messages, error copy, status-code matrices, anything a
supertest or Testing Library test can answer, and anything that needs a stubbed route —
if you are stubbing the network, you are in the wrong ring.

```
tests/e2e/                        (planned)
  fixtures/app.ts        server-per-worker, throwaway SQLite file + media root
  fixtures/surfaces.ts   guestPhone / hostDesktop / projector contexts
  fixtures/media.ts      generated JPEGs, one with EXIF orientation 6 and GPS
  journeys/  security/  a11y/  visual/
```

- **Worker-scoped app fixture.** One server per Playwright worker, own port, own
  `data/e2e-<worker>.sqlite` (migrated, then deleted), own media root under the OS temp
  dir — so workers cannot see each other's photos, which is what makes parallel workers
  safe. Never the dev database. Seed through the API or a seed script, never SQL in a
  spec: seeding via the public surface is itself a test.
- **Three browser contexts, one test.** `guest` (Pixel 7 / iPhone 14), `host` (desktop),
  `projector` (desktop). Separate contexts mean separate cookie jars — the only way to
  assert that a guest token does not grant host powers. Assert the **negative**: the wall
  stays empty until the host publishes; a test that checks only the happy ending passes
  with moderation entirely bypassed.
- **Selector priority.** `getByRole` / `getByLabel` / `getByText` first — user-visible,
  so it doubles as an accessibility assertion. `getByTestId` only where there is no
  accessible identity (a slide layer, upload queue rows). **Never** a CSS class or
  DOM-structure selector. `data-testid` values are contract; grep before renaming one.
- **`page.waitForTimeout()` is banned** and lint rejects it; use
  `await expect(locator).toBeVisible({ timeout: 10_000 })`. A fixed sleep in an
  SSE-driven app is both flaky and slow — the single largest source of e2e flake here.
- **Test hooks, gated.** The slideshow advances on a real interval, so specs drive it
  with `?e2e_interval=250&e2e_transition=0`. Those params are zod-parsed and honoured
  **only when `E2E_HOOKS=1`**, never set in production; a ring-4 test asserts they are
  ignored without it. `E2E_CLOCK_EPOCH` fixes the clock so relative times are stable.
- **Visual snapshots cover the wall layouts only** (`tests/e2e/visual/display.spec.ts`),
  where "looks right" _is_ the requirement. They need the seeded demo album,
  `e2e_transition=0`, and `prefers-reduced-motion`. Update deliberately with
  `npm run test:e2e:update-snapshots` and read the diff. Admin screens are never
  snapshotted — they churn and teach nothing.
- **Accessibility.** `@axe-core/playwright` over `/join/:code`, `/e/:slug/upload`,
  `/admin` and the moderation console, tags `wcag2a` + `wcag2aa`, failing on `serious`
  and `critical`. The projector page is exempt from contrast rules by design (a photo on
  black) but must still be keyboard-operable.
- **Flake policy: `retries: 2` in CI, `0` locally.** A test that needs a retry on your
  machine is broken. Causes, in frequency order: a missing auto-retrying assertion, a
  `waitForTimeout`, state shared between workers, an unseeded clock. Never `test.skip` a
  red e2e without an issue link and a comment saying what broke.

---

## 10. Coverage gates

Configured in `vitest.config.ts` _(planned)_ and enforced in CI.

| Scope                   | Statements | Branches |
| ----------------------- | ---------- | -------- |
| `src/domain/**`         | 100%       | 100%     |
| `src/application/**`    | 100%       | 100%     |
| `src/infrastructure/**` | 90%        | 85%      |
| `src/interface/**`      | 95%        | 90%      |
| `web/src/**`            | 85%        | 80%      |

Domain and application are pure or fake-driven: there is no environment to blame, so an
uncovered branch is a rule nobody thought about and the gate names it. Adapters sit
lower on purpose — some error branches need a real disk failure or a corrupt SQLite page
to reach, and faking those proves nothing while costing a lie. `web/src` is lowest
because pixels are covered by ring 6 instead. Excluded from measurement: `**/*.test.*`,
`src/application/testing/**` (test support, itself covered by the contract suites),
`src/main/index.ts` (`listen` + signal handlers, covered by ring 6), generated files.

**Coverage is a floor, never the goal.** A test that asserts nothing still covers lines,
and a getter test raises the number while protecting nobody. What the gate actually buys
is structural: a suite with no tests scores 0% and fails, so 1.0's `--passWithNoTests`
green build cannot be reproduced. Never lower a threshold to land a change, and never
chase one by testing accessors.

---

## 11. Scripts

| Command                                         | When to use it                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm test`                                      | watch mode while writing code — the default inner loop                                   |
| `npm run test:unit`                             | `src/domain` + `src/application` only; the fastest honest signal, use it for rule work   |
| `npm run test:server`                           | all of `src/` (rings 1–4) after touching an adapter, a route, or a migration             |
| `npm run test:web`                              | `web/src` under jsdom (ring 5) after touching a component or a hook                      |
| `npm run test:run`                              | every vitest project once, no watch — what you run before a commit if you are in a hurry |
| `npm run test:coverage`                         | with the gates of §10; run it when you added or moved a rule                             |
| `npm run test:e2e`                              | Playwright, all projects; before opening a PR that touches a flow                        |
| `npm run test:e2e:ui`                           | Playwright UI mode, for debugging a failing journey step by step                         |
| `npm run test:e2e -- --project=chromium-mobile` | guest-surface work only; skips the desktop projects                                      |
| `npm run test:e2e -- --grep @smoke`             | the subset CI runs on every push                                                         |
| `npm run test:e2e:update-snapshots`             | after an **intentional** wall-layout change; review the diff                             |
| `npm run verify`                                | lint + typecheck + `test:coverage` + build — the gate before committing                  |
| `npm run verify:full`                           | `verify` + `test:e2e` — before opening a PR                                              |

`npx playwright install --with-deps` is needed once before the first e2e run. Run
`npm run verify` and **read its output**; a failing suite reported as passing is the
worst outcome available in this repository (CLAUDE.md §6).

---

## 12. Anti-patterns

Every row is a mistake actually made in this project or in its 1.0 predecessor.

| Don't                                                | Do                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `jest --passWithNoTests` in CI                       | coverage thresholds, which fail an empty suite                         |
| `vi.mock('../../database')`                          | inject `FakePhotoRepository`; there is no module-level `db` to mock    |
| assert a spy was called                              | assert the resulting state (repository, `bus.published`, DOM)          |
| `expect(res.body.message).toBe('Photo introuvable')` | `expect(res.body.error.code).toBe('photo.notFound')`                   |
| `await page.waitForTimeout(2000)`                    | `await expect(locator).toBeVisible({ timeout: 10_000 })`               |
| wait ten real seconds for the next slide             | `?e2e_interval=250` (ring 6) or `vi.advanceTimersByTimeAsync` (ring 5) |
| `expect(file.mimetype).toBe('image/jpeg')`           | feed real bytes and assert magic-byte rejection                        |
| one test asserting eight things                      | one test per rule, one act each                                        |
| a test that only passes after another ran            | `beforeEach` builds a fresh world                                      |
| a shared temp dir or the dev database                | `mkdtemp` per test; per-worker SQLite file in e2e                      |
| `as any` to satisfy a type                           | build the real object with a builder                                   |
| `it.skip` on a red test                              | fix it, or delete it and say why in the commit                         |
| a snapshot of a whole component tree                 | assert the specific role or text                                       |
| a new port method with no contract case              | add the case; both implementations then have to agree                  |
| a ring-6 test for a validation message               | ring 1 or ring 4 — e2e seconds are for journeys                        |
| lowering a coverage threshold to go green            | write the missing test, or delete the unreachable branch               |

---

## 13. Checklist before you push

- [ ] Correct ring — the cheapest one that can catch this bug.
- [ ] Fakes and builders, not mocks and hand-built literals.
- [ ] `Clock` and `IdGenerator` injected; no `Date.now()`, `new Date()`, `Math.random()`.
- [ ] The name states the rule; one act; one reason to fail.
- [ ] Assertions on observable behaviour and stable error codes.
- [ ] A cross-event / authorization case where the subject is event-scoped.
- [ ] New port method → contract case added → fake and adapter both run it.
- [ ] Seen red before green, for the right reason.
- [ ] `npm run verify` green and its output read; `npm run verify:full` for a PR.
