---
name: eventslide-domain
description: Recipe for adding or changing a pure business rule in src/domain — entities, value objects, state machines, the Result type, and the tests that must accompany them. Use when a change involves event lifecycle, photo status, quotas, join codes, moderation ordering, slideshow playlists, or reaction rules, or whenever you are tempted to put an `if` in an Express handler or a React component.
---

# Writing domain code in EventSlide

`src/domain` is pure TypeScript. It has **no imports outside `src/domain`** — no
Express, no SQLite, no `fs`, no `sharp`, no `react`, no `zod`, not even `node:crypto`.
Lint enforces it.

Everything here runs in microseconds and is tested without a single test double. If a
rule is hard to test, it is in the wrong layer.

## Decide where it goes

| The rule…                                         | Belongs in                                    |
| ------------------------------------------------- | --------------------------------------------- |
| is true regardless of storage or transport        | `src/domain`                                  |
| orchestrates several domain objects and needs I/O | `src/application/usecases`                    |
| is about HTTP shapes, status codes, or cookies    | `src/interface/http`                          |
| is about how something looks                      | `web/src/design-system` or the feature folder |

Litmus test: _could this rule be wrong in a way a customer would notice, with no
network and no disk involved?_ If yes, it is domain.

## Value objects: parse, don't validate

Never let an invalid value exist. Constructors return `Result`, never throw.

```ts
// src/domain/photos/caption.ts
import { Result, ok, err } from '../shared/result'
import { DomainError } from '../shared/errors'

const MAX_LENGTH = 140

/** A guest-authored caption. Trimmed, length-bounded, control characters removed. */
export class Caption {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<Caption, DomainError> {
    // eslint-disable-next-line no-control-regex -- stripping C0/C1 is the point
    const cleaned = raw
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
      .trim()
    if (cleaned.length === 0) return err(DomainError.invalid('caption.empty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('caption.tooLong', { max: MAX_LENGTH }))
    }
    return ok(new Caption(cleaned))
  }

  static readonly maxLength = MAX_LENGTH
}
```

Notes that matter:

- `private constructor` — the only way in is `create`.
- Return `Result`, do not throw. Throwing forces `try/catch` on every caller and makes
  error paths untested by accident.
- Error codes are **stable machine strings** (`caption.tooLong`). The French message
  is chosen in `web/src/lib/i18n/`, never here.

## Branded ids

Ids are opaque strings, distinguished at the type level so an `EventId` can never be
passed where a `PhotoId` is expected.

```ts
// src/domain/shared/ids.ts
declare const brand: unique symbol
export type Branded<T, B extends string> = T & { readonly [brand]: B }

export type EventId = Branded<string, 'EventId'>
export type PhotoId = Branded<string, 'PhotoId'>
export type GuestId = Branded<string, 'GuestId'>
export type UserId = Branded<string, 'UserId'>

export const asEventId = (value: string): EventId => value as EventId
```

`asEventId` is the only cast. Use it at boundaries (repository row → domain), never
inside domain logic.

## Entities: explicit state machines

Illegal transitions must be unrepresentable or explicitly rejected — never silently
allowed.

```ts
// src/domain/photos/photoStatus.ts
export type PhotoStatus = 'pending' | 'published' | 'rejected' | 'hidden'

const ALLOWED: Record<PhotoStatus, readonly PhotoStatus[]> = {
  pending: ['published', 'rejected'],
  published: ['hidden', 'rejected'],
  rejected: ['published'],
  hidden: ['published'],
}

export const canTransition = (from: PhotoStatus, to: PhotoStatus): boolean =>
  from === to || ALLOWED[from].includes(to)
```

Entities expose intent-named methods that return a **new** entity, never mutate:

```ts
publish(at: Date): Result<Photo, DomainError>   // yes
set status(s: PhotoStatus)                      // no
```

## Time and randomness are inputs

Domain code never reads the clock or generates ids. It receives them.

```ts
publish(at: Date): Result<Photo, DomainError>
static create(input: NewPhoto, id: PhotoId, now: Date): Result<Photo, DomainError>
```

`Date.now()` or `Math.random()` inside `src/domain` is a bug, and a flaky test.

## The Result type

```ts
// src/domain/shared/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

Narrow with `if (!result.ok) return result`. Do not `!`-assert `result.value`.

## Tests

Colocated, one file per unit: `caption.ts` → `caption.test.ts`.

```ts
import { describe, expect, it } from 'vitest'
import { Caption } from './caption'

describe('Caption', () => {
  it('trims surrounding whitespace', () => {
    const result = Caption.create('  Santé !  ')
    expect(result.ok && result.value.value).toBe('Santé !')
  })

  it('rejects a caption that is only whitespace', () => {
    const result = Caption.create('   ')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('caption.empty')
  })

  it('rejects a caption longer than the limit', () => {
    const result = Caption.create('x'.repeat(Caption.maxLength + 1))
    expect(!result.ok && result.error.code).toBe('caption.tooLong')
  })

  it('strips control characters that would break the display layer', () => {
    const result = Caption.create('Bravo\u0007!')
    expect(result.ok && result.value.value).toBe('Bravo !')
  })
})
```

Requirements:

- Cover **every branch**. `src/domain` is gated at 100% branch coverage in CI, and it
  is the one place where that gate is easy to honour.
- Assert on the **error code**, not the message.
- Test the boundary values: `max`, `max + 1`, empty, and one representative middle case.
- Name the rule, not the mechanics.

## Checklist

- [ ] No import outside `src/domain`.
- [ ] Constructors are private; creation goes through `create` returning `Result`.
- [ ] No mutation — methods return new instances.
- [ ] `Date` and ids are parameters, never ambient.
- [ ] Error codes are stable strings; no user-facing French text.
- [ ] Colocated test file, every branch covered, boundaries included.
- [ ] `npm run test:coverage` still green at 100% for `src/domain`.
