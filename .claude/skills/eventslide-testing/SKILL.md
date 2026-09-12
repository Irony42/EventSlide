---
name: eventslide-testing
description: The test strategy for EventSlide — which of the six rings a test belongs in, fakes vs mocks, the shared port contract suites, builders, injected clock and ids, coverage gates, and how to write a test that fails for exactly one reason. Use before writing any test, when a test is flaky, or when deciding whether something needs a unit, integration, HTTP, component, or e2e test.
---

# Testing EventSlide

Six rings. Each answers a question the others cannot. Putting a test in the wrong ring
is the most common quality mistake in this repo: it makes the suite slow, flaky, and
still full of holes.

| Ring            | Location                          | Question it answers                   | Doubles                           | Runtime |
| --------------- | --------------------------------- | ------------------------------------- | --------------------------------- | ------- |
| 1 Domain unit   | `src/domain/**/*.test.ts`         | is the rule correct?                  | none — pure code                  | µs      |
| 2 Use case      | `src/application/**/*.test.ts`    | is the orchestration correct?         | in-memory fakes                   | <1 ms   |
| 3 Adapter       | `src/infrastructure/**/*.test.ts` | does the adapter honour the port?     | real SQLite `:memory:`, temp dirs | ms      |
| 4 HTTP contract | `src/interface/http/**/*.test.ts` | is the wire contract and authz right? | supertest + fakes                 | ms      |
| 5 Component     | `web/src/**/*.test.tsx`           | does the UI behave?                   | Testing Library + fake transport  | ms      |
| 6 E2E           | `tests/e2e/**/*.spec.ts`          | does the journey work for real?       | none — real everything            | seconds |

Choosing:

- A conditional, a calculation, a state transition → **ring 1**. Always.
- Several objects coordinated, or a side effect ordered → **ring 2**.
- SQL, `fs`, `sharp`, `bcrypt`, HMAC → **ring 3**.
- A status code, a cookie flag, an authorization decision → **ring 4**.
- What the user sees and clicks → **ring 5**.
- A journey crossing surfaces, or a thing only real infrastructure can break → **ring 6**
  (see `.claude/skills/eventslide-e2e/`).

If a bug could have been caught in a cheaper ring, add it there **as well as** fixing
the leak. Regression tests go in the cheapest ring that would have caught it.

## Fakes, not mocks

`src/application/testing/` contains real in-memory implementations of every port:

| Fake                    | Behaviour that matters                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `FakeEventRepository`   | slug and join-code uniqueness enforced, as in SQLite                   |
| `FakePhotoRepository`   | keyed by `${eventId}:${photoId}` — a cross-event read genuinely misses |
| `FakeGuestRepository`   | tokens scoped to one event                                             |
| `FakeUserRepository`    | per-event role membership                                              |
| `InMemoryMediaStore`    | byte buffers, `put`/`get`/`delete`, reports sizes                      |
| `FakeImageProcessor`    | deterministic metadata, simulates rotation and failure                 |
| `FakeClock`             | `now()`, `advance(ms)`                                                 |
| `SequentialIdGenerator` | `id-1`, `id-2`, … — readable assertions                                |
| `RecordingEventBus`     | `published: DomainEvent[]`                                             |
| `FakePasswordHasher`    | `hash:<password>`, fast, no bcrypt cost in tests                       |

Why this instead of `vi.mock`:

- A fake **behaves**, so ordering, filtering, and uniqueness are genuinely exercised.
- Tenant bugs **fail** instead of passing because a stub returned what it was told.
- One implementation, fixed once. Per-test stubs drift and lie.
- `vi.mock` of an internal module couples the test to import structure: the test
  breaks on a rename and survives a behaviour change. Exactly backwards.

`vi.mock` is acceptable only for a third-party module with no seam, and each use
carries a comment explaining why no port was possible.

## Shared port contracts

Every port has a contract suite in `src/application/testing/contracts/`, run against
**both** the fake and the SQLite adapter.

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
// src/infrastructure/db/sqlitePhotoRepository.test.ts
photoRepositoryContract('sqlite', async () => {
  /* migrated :memory: db */
})

// src/application/testing/fakePhotoRepository.test.ts
photoRepositoryContract('fake', async () => ({ repo: new FakePhotoRepository() }))
```

This is what keeps the fakes honest. A fake that drifts from the real adapter turns
every ring-2 test into a lie. **Adding a port method means adding a contract case.**

## Builders

`src/application/testing/builders.ts` — `anEvent()`, `aPhoto()`, `aGuest()`, `aUser()`.
Sensible defaults, partial overrides.

```ts
const photo = aPhoto({ eventId: 'mariage', status: 'pending', byteSize: 2_400_000 })
```

Specify **only what the test is about**. A test that sets fourteen fields hides its own
point, and a new required field breaks ninety files instead of one.

## Determinism

- `FakeClock` and `SequentialIdGenerator` are injected. `Date.now()`, `new Date()`, and
  `Math.random()` in code under test are bugs.
- No test depends on wall-clock ordering or on `setTimeout` racing. Advance the fake
  clock, or use `vi.useFakeTimers()` for interval-driven UI.
- No test depends on another test's state. `beforeEach` builds a fresh world; there is
  no shared module-level `db` any more — that was 1.0's central testability defect.
- Temp dirs are per-test (`mkdtemp`) and removed in `afterEach`.

## Writing a test that fails for one reason

```ts
// Good: the name states the rule, the body proves exactly it.
it('refuses an upload once the event byte quota is reached', async () => {
  const event = anEvent({ slug: 'mariage', quotaBytes: 1_000 })
  photos.seed(aPhoto({ eventId: event.id, byteSize: 1_000 }))

  const result = await uploadPhotos({ eventId: event.id, files: [aFile({ bytes: 1 })] })

  expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
})
```

- The name is the requirement. If it needs "and" twice, it is two tests.
- Arrange / act / assert, visually separated, one act.
- Assert on **observable behaviour**: return value, repository content, bus events,
  rendered DOM. Never that a private helper was called.
- Assert on **error codes**, never messages — messages are French UI copy and will change.
- No logic in a test. A `for` loop over cases is fine (`it.each`); an `if` is not.

## Security invariants get named tests

These have their own dedicated tests and are never folded into a happy path:

- tenant isolation on every event-scoped repository method (ring 3) **and** every route
  (ring 4);
- a guest token grants upload to exactly one event and nothing else;
- a moderator of event A is refused on event B;
- magic-byte validation rejects a renamed `.php`, an `.svg`, and a polyglot;
- oversize files and pixel bombs are rejected before decode;
- EXIF GPS and device metadata are absent from stored output;
- byte quota closes uploads instead of filling the disk;
- session id changes on login (fixation);
- media routes 404 across events;
- rate limits return 429.

## Coverage

`vitest.config.ts`, enforced in CI:

| Scope                   | Statements | Branches |
| ----------------------- | ---------- | -------- |
| `src/domain/**`         | 100%       | 100%     |
| `src/application/**`    | 100%       | 100%     |
| `src/infrastructure/**` | 90%        | 85%      |
| `src/interface/**`      | 95%        | 90%      |
| `web/src/**`            | 85%        | 80%      |

Domain and application are at 100% because they are pure or fake-driven — there is no
excuse, and the gate catches the rule you forgot to handle. Adapters are lower on
purpose: some error branches need a real disk failure to reach, and faking that proves
nothing.

Coverage is a **floor**. A test that asserts nothing still covers lines. Never chase a
number by testing a getter.

## Commands

```bash
npm test                        # watch
npm run test:run                # once, all vitest projects
npm run test:unit               # src/domain + src/application only — fastest loop
npm run test:server             # all of src/
npm run test:web                # web/ (jsdom)
npm run test:coverage           # with gates
npm run test:e2e                # Playwright
npm run verify                  # lint + typecheck + coverage + build
```

## Anti-patterns, all of which have bitten this project

| Don't                                                | Do                                                   |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `vi.mock('../../database')`                          | inject a fake repository                             |
| assert a spy was called                              | assert the resulting state                           |
| `expect(res.body.message).toBe('Photo introuvable')` | `expect(res.body.error.code).toBe('photo.notFound')` |
| `await page.waitForTimeout(2000)`                    | an auto-retrying assertion                           |
| one test asserting eight things                      | one test per rule                                    |
| a test that only runs after another                  | `beforeEach` builds the world                        |
| `as any` to satisfy a type                           | build the real object with a builder                 |
| `it.skip` a red test                                 | fix it, or delete it and say why                     |
| a snapshot of a whole component tree                 | assert the specific text or role                     |

## Checklist

- [ ] Correct ring — the cheapest one that can catch the bug.
- [ ] Fakes and builders, not mocks and hand-built literals.
- [ ] Clock and ids injected; no ambient time or randomness.
- [ ] Name states the rule; one reason to fail.
- [ ] Assertions on observable behaviour and stable error codes.
- [ ] Cross-event / authorization case included where relevant.
- [ ] New port method → contract case added → both implementations covered.
- [ ] `npm run test:coverage` green, gates unchanged.
