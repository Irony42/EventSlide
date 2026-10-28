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
 * It answers as the filesystem adapter does, and `contracts/mediaStoreContract.ts` is what holds
 * it to that: bytes are copied in and out, so a caller reusing its buffer cannot reach what
 * is stored; every rendition has the content type the adapter gives it; and an event stays
 * listed after its last object is deleted, until the event itself is purged.
 *
 * The scripted behaviours are the conditions a test cannot otherwise reach, each of which
 * a use case or a route once got wrong or must be shown to survive: `failWritesAfter`, a disk
 * filling up part-way through a request, and unwinding on it was the behaviour 1.0 got wrong;
 * `failDeletes`, an unlink the operating system refuses; `failEventPurges`, a media root that
 * went read-only under a retention sweep; `vanishAfterStat`, the retention
 * purge taking a file between the size check and the open; and `opened`, a count of the byte
 * streams asked for, because how many is the whole of a descriptor leak. `forbidEnumeration`
 * is the other way round: a tripwire, for a test of a surface that must never walk the store.
 */
export class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  /**
   * Every event something was written for and which has not been purged. The adapter's
   * event directory outlives its last object, so this does too: `listEvents` names what the
   * store has been written to, not only what it holds right now.
   */
  private readonly events = new Set<EventId>()

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
  private deletesFail = false
  private readonly unreadable = new Set<string>()
  private enumerationRefusedFor: string | null = null
  private readonly purgesFail = new Set<EventId>()

  /**
   * How many byte streams have been asked for, found or not.
   *
   * Counted because "how many" is the whole of a descriptor leak: `openRead` on the
   * filesystem store opens the file when the stream is *constructed*, so a stream nobody
   * reads still costs a descriptor until something destroys it.
   */
  opened = 0

  /** Simulates a disk filling up: the next `writes` succeed and the rest throw. */
  failWritesAfter(writes: number): this {
    this.budget = writes
    return this
  }

  /** Simulates an unlink the operating system refuses (a permission, a busy handle). */
  failDeletes(): this {
    this.deletesFail = true
    return this
  }

  /**
   * Models the retention purge deleting a file between the size check and the open — the one
   * window in which a media read can fail after it has already succeeded. `stat` goes on
   * reporting the size; `openRead` answers `null`, for every rendition of the digest.
   */
  vanishAfterStat(eventId: EventId, hash: ContentHash): this {
    for (const variant of ALL_MEDIA_VARIANTS) this.unreadable.add(this.key(eventId, hash, variant))
    return this
  }

  /** Events whose purge blows up: a read-only media root, a disk that went away. */
  failEventPurges(...eventIds: readonly EventId[]): this {
    for (const eventId of eventIds) this.purgesFail.add(eventId)
    return this
  }

  /**
   * Makes `list` and `listEvents` throw, naming the surface they are not part of.
   *
   * Only the reconciliation sweep enumerates a store. A test of anything else says so, and a
   * use case or handler that started walking the store fails loudly rather than passing
   * against a store that shrugs.
   */
  forbidEnumeration(surface: string): this {
    this.enumerationRefusedFor = surface
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

  private refuseIfForbidden(method: string): void {
    if (this.enumerationRefusedFor !== null) {
      throw new Error(`${method} is not part of ${this.enumerationRefusedFor}`)
    }
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
    // A copy, as the adapter's write to disk is one: a buffer the caller goes on to reuse
    // must not change what was stored.
    this.objects.set(key, new Uint8Array(bytes))
    this.events.add(eventId)
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
          contentType: CONTENT_TYPE[variant],
          modifiedAt: held.modifiedAt,
        }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    this.opened += 1
    const key = this.key(eventId, hash, variant)
    const bytes = this.objects.get(key)
    if (bytes === undefined || this.unreadable.has(key)) return null
    if (range === undefined) return once(new Uint8Array(bytes))
    if (range.start >= bytes.length || range.end < range.start) return null
    return once(bytes.slice(range.start, Math.min(range.end, bytes.length - 1) + 1))
  }

  async read(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<Uint8Array | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    return bytes === undefined ? null : new Uint8Array(bytes)
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    if (this.deletesFail) throw new Error('EPERM: operation not permitted, unlink')
    for (const variant of ALL_MEDIA_VARIANTS) {
      const key = this.key(eventId, hash, variant)
      this.objects.delete(key)
      this.held.delete(key)
    }
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    if (this.purgesFail.has(eventId)) throw new Error('media root is read-only')
    this.events.delete(eventId)
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
    this.refuseIfForbidden('listEvents')
    return [...this.events]
  }

  async list(eventId: EventId): Promise<readonly StoredObject[]> {
    this.refuseIfForbidden('list')
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

/**
 * The declared type of each rendition, as `infrastructure/media/mediaLayout.ts` declares it (the
 * application layer cannot import it, and `mediaStoreContract` holds the two together): a still
 * is a JPEG, a clip an mp4, and a staged source, which nothing serves, is just bytes.
 */
const CONTENT_TYPE: Readonly<Record<MediaVariant, string>> = {
  original: 'image/jpeg',
  display: 'image/jpeg',
  thumb: 'image/jpeg',
  video: 'video/mp4',
  poster: 'image/jpeg',
  source: 'application/octet-stream',
  ground: 'image/webp',
}

const once = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes
  })()
