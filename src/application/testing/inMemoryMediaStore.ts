import { ALL_MEDIA_VARIANTS } from '../ports/mediaStore'
import type { ByteRange, MediaMetadata, MediaStore, MediaVariant } from '../ports/mediaStore'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId } from '../../domain/shared/ids'

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
    this.objects.set(this.key(eventId, hash, variant), bytes)
  }

  async exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean> {
    return this.objects.has(this.key(eventId, hash, variant))
  }

  async stat(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<MediaMetadata | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    return bytes === undefined
      ? null
      : { byteSize: bytes.length, contentType: variant === 'video' ? 'video/mp4' : 'image/jpeg' }
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
      this.objects.delete(this.key(eventId, hash, variant))
    }
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${eventId}|`)) this.objects.delete(key)
    }
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }
}

const once = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes
  })()
