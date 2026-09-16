import { ALL_MEDIA_VARIANTS } from '../ports/mediaStore'
import type {
  ByteRange,
  MediaMetadata,
  MediaStore,
  MediaVariant,
  StoredObject,
} from '../ports/mediaStore'
import type { Clock } from '../ports/clock'
import type { ContentHash } from '../../domain/photos/contentHash'
import { asEventId, type EventId } from '../../domain/shared/ids'

/**
 * The media store as byte buffers.
 *
 * Keyed by `(eventId, hash, variant)`, exactly as the filesystem adapter addresses a
 * file, so a test that reads another event's bytes genuinely misses. It really holds
 * what it was given and really reports sizes, because "how many bytes does this event
 * occupy" is a number the quota rules are decided from — a double that answered a
 * constant would make every quota test a statement about nothing.
 *
 * `failWritesAfter` is the only scripted behaviour: a disk filling up part-way through
 * a request is the one condition a test cannot otherwise reach, and unwinding on it is
 * the behaviour 1.0 got wrong.
 */
export class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  /**
   * The address and the write time of each object, which the byte map cannot carry.
   *
   * `modifiedAt` exists because the reconciliation sweep refuses to collect anything
   * written recently — every write path here is bytes-first, row-second, so a collector
   * with no sense of age eats the file out from under the insert about to name it. A
   * store that reported no age would make that rule untestable and, worse, would make a
   * sweep test pass that production would fail.
   *
   * The clock is optional because most tests do not care. Unwired, every object reads as
   * written at the epoch — old enough to be collectable, which is the answer that makes
   * a sweep test say something.
   */
  private readonly held = new Map<
    string,
    { eventId: EventId; hash: ContentHash; variant: MediaVariant; modifiedAt: Date }
  >()

  constructor(private readonly clock?: Clock) {}

  private budget = Number.POSITIVE_INFINITY

  /** Simulates a disk filling up: the next `writes` succeed and the rest throw. */
  failWritesAfter(writes: number): this {
    this.budget = writes
    return this
  }

  /** Every variant currently held for one digest, in a stable order. */
  variantsOf(eventId: EventId, hash: ContentHash): readonly MediaVariant[] {
    return ALL_MEDIA_VARIANTS.filter((variant) =>
      this.objects.has(this.key(eventId, hash, variant)),
    )
  }

  get objectCount(): number {
    return this.objects.size
  }

  private key(eventId: EventId, hash: ContentHash, variant: MediaVariant): string {
    return `${eventId}|${hash.value}|${variant}`
  }

  async put(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    bytes: Uint8Array,
  ): Promise<void> {
    if (this.budget <= 0) throw new Error('no space left on device')
    this.budget -= 1
    const key = this.key(eventId, hash, variant)
    this.objects.set(key, bytes)
    this.held.set(key, {
      eventId,
      hash,
      variant,
      modifiedAt: this.clock?.now() ?? new Date(0),
    })
  }

  async exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean> {
    return this.objects.has(this.key(eventId, hash, variant))
  }

  async stat(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<MediaMetadata | null> {
    const key = this.key(eventId, hash, variant)
    const bytes = this.objects.get(key)
    const held = this.held.get(key)
    return bytes === undefined || held === undefined
      ? null
      : {
          byteSize: bytes.length,
          contentType: variant === 'video' ? 'video/mp4' : 'image/jpeg',
          modifiedAt: held.modifiedAt,
        }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    if (bytes === undefined) return null
    if (range === undefined) return once(bytes)
    if (range.start >= bytes.length || range.end < range.start) return null
    return once(bytes.slice(range.start, Math.min(range.end, bytes.length - 1) + 1))
  }

  async read(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<Uint8Array | null> {
    return this.objects.get(this.key(eventId, hash, variant)) ?? null
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    for (const variant of ALL_MEDIA_VARIANTS) {
      const key = this.key(eventId, hash, variant)
      this.objects.delete(key)
      this.held.delete(key)
    }
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${eventId}|`)) {
        this.objects.delete(key)
        this.held.delete(key)
      }
    }
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }

  async listEvents(): Promise<readonly EventId[]> {
    const seen = new Set<string>()
    for (const key of this.objects.keys()) {
      const eventId = key.slice(0, key.indexOf('|'))
      seen.add(eventId)
    }
    return [...seen].map((id) => asEventId(id))
  }

  async list(eventId: EventId): Promise<readonly StoredObject[]> {
    const found: StoredObject[] = []
    for (const [key, bytes] of this.objects) {
      const held = this.held.get(key)
      if (held === undefined || held.eventId !== eventId) continue
      found.push({
        hash: held.hash,
        variant: held.variant,
        byteSize: bytes.length,
        modifiedAt: held.modifiedAt,
      })
    }
    return found
  }
}

const once = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes
  })()
