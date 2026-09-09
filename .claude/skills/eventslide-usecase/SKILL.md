---
name: eventslide-usecase
description: Recipe for adding a use case in src/application — the port interfaces it depends on, the in-memory fake that makes it testable, and the test that proves the rule. Use when implementing a new application capability such as uploading photos, moderating in bulk, joining an event, rotating a join code, or building a slideshow playlist.
---

# Writing a use case in EventSlide

A use case is **one exported factory, one responsibility, no I/O of its own**. It
receives its dependencies as ports and returns a function.

`src/application` may import `src/domain` and `src/application/ports`. Nothing else.
No Express, no SQLite, no `fs`, no `sharp`.

## The shape

```ts
// src/application/usecases/photos/publishPhoto.ts
import { Result, ok, err } from '../../../domain/shared/result'
import { DomainError } from '../../../domain/shared/errors'
import { EventId, PhotoId } from '../../../domain/shared/ids'
import { PhotoRepository } from '../../ports/photoRepository'
import { EventBus } from '../../ports/eventBus'
import { Clock } from '../../ports/clock'

export interface PublishPhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
}

export interface PublishPhotoDeps {
  readonly photos: PhotoRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type PublishPhoto = (input: PublishPhotoInput) => Promise<Result<void, DomainError>>

export const makePublishPhoto = ({ photos, bus, clock }: PublishPhotoDeps): PublishPhoto =>
  async ({ eventId, photoId }) => {
    // Scoped read: passing eventId is what makes cross-tenant access impossible.
    const photo = await photos.findById(eventId, photoId)
    if (!photo) return err(DomainError.notFound('photo.notFound'))

    const published = photo.publish(clock.now())
    if (!published.ok) return published

    await photos.save(published.value)
    bus.publish({ type: 'photo.published', eventId, photoId })
    return ok(undefined)
  }
```

Rules encoded above, all of which are load-bearing:

1. **`eventId` is always part of the lookup.** Never `findById(photoId)`. That single
   habit is the tenant-isolation guarantee.
2. **The decision lives in the entity** (`photo.publish`). The use case orchestrates;
   it does not re-implement the rule.
3. **`Result` in, `Result` out.** No throwing for expected failures.
4. **Side effects last.** Persist, then publish to the bus, then return.
5. **`clock.now()`**, never `new Date()`.

## Defining a port

One interface per file, named for the capability, expressed in domain types only.

```ts
// src/application/ports/photoRepository.ts
import { Photo } from '../../domain/photos/photo'
import { EventId, PhotoId } from '../../domain/shared/ids'
import { PhotoStatus } from '../../domain/photos/photoStatus'

export interface PhotoQuery {
  readonly statuses?: readonly PhotoStatus[]
  readonly limit?: number
  readonly before?: Date
}

export interface PhotoRepository {
  findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null>
  list(eventId: EventId, query?: PhotoQuery): Promise<readonly Photo[]>
  save(photo: Photo): Promise<void>
  delete(eventId: EventId, photoId: PhotoId): Promise<void>
  countBytes(eventId: EventId): Promise<number>
}
```

Port design rules:

- **No leaking storage concepts.** No `WHERE` clauses, no row types, no SQL strings, no
  `Knex`, no `Statement`. If the interface mentions SQLite, it is not a port.
- **Every method takes `eventId` first** when the entity is event-scoped. Make the
  unsafe call impossible to write, rather than forbidden by convention.
- **Return domain objects**, not rows. Mapping is the adapter's job.
- Keep ports narrow. A port with fourteen methods is several ports.

## The fake — write it, do not mock

For every port there is a real in-memory implementation in
`src/application/testing/`. It is production-quality code and it has its own tests.

```ts
// src/application/testing/fakePhotoRepository.ts
import { PhotoRepository, PhotoQuery } from '../ports/photoRepository'
import { Photo } from '../../domain/photos/photo'
import { EventId, PhotoId } from '../../domain/shared/ids'

export class FakePhotoRepository implements PhotoRepository {
  /** Keyed by `${eventId}:${photoId}` so a cross-event read genuinely misses. */
  private readonly rows = new Map<string, Photo>()

  private key(eventId: EventId, photoId: PhotoId): string {
    return `${eventId}:${photoId}`
  }

  seed(...photos: readonly Photo[]): this {
    for (const photo of photos) this.rows.set(this.key(photo.eventId, photo.id), photo)
    return this
  }

  async findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null> {
    return this.rows.get(this.key(eventId, photoId)) ?? null
  }

  async list(eventId: EventId, query: PhotoQuery = {}): Promise<readonly Photo[]> {
    const all = [...this.rows.values()]
      .filter((p) => p.eventId === eventId)
      .filter((p) => !query.statuses || query.statuses.includes(p.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return query.limit ? all.slice(0, query.limit) : all
  }

  async save(photo: Photo): Promise<void> {
    this.rows.set(this.key(photo.eventId, photo.id), photo)
  }

  async delete(eventId: EventId, photoId: PhotoId): Promise<void> {
    this.rows.delete(this.key(eventId, photoId))
  }

  async countBytes(eventId: EventId): Promise<number> {
    return [...this.rows.values()]
      .filter((p) => p.eventId === eventId)
      .reduce((total, p) => total + p.byteSize, 0)
  }
}
```

Why a fake rather than `vi.mock`:

- It **behaves**, so a use case test exercises real sequencing and real filtering.
- The composite key means a cross-tenant bug **fails a test** instead of passing
  because the mock returned whatever it was told to.
- Same fake in fifty tests: one place to fix, no per-test stub drift.
- The SQLite adapter and the fake are both verified against the **same shared contract
  suite** (`src/application/testing/contracts/photoRepositoryContract.ts`). Add a
  method to a port → add it to the contract → both implementations are covered.

Also available: `FakeClock` (`advance(ms)`), `SequentialIdGenerator`,
`RecordingEventBus` (`published: DomainEvent[]`), `InMemoryMediaStore`,
`FakeImageProcessor`, `FakePasswordHasher`.

## The test

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { makePublishPhoto } from './publishPhoto'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { FakeClock } from '../../testing/fakeClock'
import { aPhoto } from '../../testing/builders'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'

describe('publishPhoto', () => {
  let photos: FakePhotoRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let publishPhoto: ReturnType<typeof makePublishPhoto>

  beforeEach(() => {
    photos = new FakePhotoRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock(new Date('2026-06-20T21:00:00Z'))
    publishPhoto = makePublishPhoto({ photos, bus, clock })
  })

  it('publishes a pending photo and announces it', async () => {
    photos.seed(aPhoto({ id: 'p1', eventId: 'wedding', status: 'pending' }))

    const result = await publishPhoto({ eventId: asEventId('wedding'), photoId: asPhotoId('p1') })

    expect(result.ok).toBe(true)
    const stored = await photos.findById(asEventId('wedding'), asPhotoId('p1'))
    expect(stored?.status).toBe('published')
    expect(bus.published).toEqual([
      { type: 'photo.published', eventId: 'wedding', photoId: 'p1' },
    ])
  })

  it('cannot publish a photo that belongs to another event', async () => {
    photos.seed(aPhoto({ id: 'p1', eventId: 'other-wedding', status: 'pending' }))

    const result = await publishPhoto({ eventId: asEventId('wedding'), photoId: asPhotoId('p1') })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
    expect(bus.published).toEqual([])
  })

  it('does not announce anything when the transition is refused', async () => {
    photos.seed(aPhoto({ id: 'p1', eventId: 'wedding', status: 'rejected', lockedByHost: true }))

    const result = await publishPhoto({ eventId: asEventId('wedding'), photoId: asPhotoId('p1') })

    expect(result.ok).toBe(false)
    expect(bus.published).toEqual([])
  })
})
```

Every use case gets, at minimum:

- the happy path, asserted on **observable state** (repository content, bus events);
- the not-found path;
- **the cross-event path** — non-negotiable for anything event-scoped;
- one refused-by-domain path, asserting no side effect leaked.

Use the builders in `src/application/testing/builders.ts` (`anEvent`, `aPhoto`,
`aGuest`) so a new required field does not break ninety test files.

## Checklist

- [ ] One file, one `make…` factory, one responsibility.
- [ ] Deps are ports, passed in; nothing constructed inside.
- [ ] `eventId` in every scoped lookup.
- [ ] Decision delegated to the entity; the use case only orchestrates.
- [ ] `Result` returned; no throw for expected failures.
- [ ] New port → new fake → added to the shared contract suite.
- [ ] Tests: happy, not-found, cross-event, domain-refused.
- [ ] Wired in `src/main/container.ts`.
- [ ] 100% branch coverage for `src/application` still holds.
