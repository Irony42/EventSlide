import type { PhotoCapRefusal, StorageRefusal } from '../../domain/events/admission'
import type { Photo, PhotoReview } from '../../domain/photos/photo'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ClientId, ClipJobId, EventId, GuestId, PhotoId } from '../../domain/shared/ids'
import type { ClientByteLimit } from './clientRepository'

/**
 * Every method takes `eventId` first, **except {@link PhotoRepository.clientTotalBytes}**,
 * which is scoped by client the way the others are by event: the client's total is the one
 * number a use case needs that no single event owns, and it answers a sum, never a photograph.
 *
 * That is not a style choice. Tenant isolation in this product *is* "was the event id
 * part of the query", so the port makes the unsafe call impossible to write rather than
 * merely discouraged. There is deliberately no `findById(photoId)`.
 */

export interface PhotoQuery {
  readonly statuses?: readonly PhotoStatus[]
  readonly authoredBy?: GuestId
  /** Only the host's favourites (spec 08): starred **and** published, never a hidden one. */
  readonly highlightedOnly?: boolean
  /** Oldest first, for a best-of in the order the photographs were taken. Default: newest first. */
  readonly oldestFirst?: boolean
  readonly limit?: number
  /** Opaque cursor from a previous page. Encoding is the adapter's business. */
  readonly cursor?: string
}

export interface PhotoPage {
  readonly items: readonly Photo[]
  readonly nextCursor: string | null
}

export interface PhotoStatusCounts {
  readonly pending: number
  readonly published: number
  readonly rejected: number
  readonly hidden: number
}

/**
 * The limits a batch insert must respect, checked against the rows already committed.
 *
 * They are passed in rather than read from the database because they belong to the
 * `Event` aggregate, and a repository does not get to interpret another aggregate. What
 * the repository contributes is the one thing a use case cannot: taking the count and
 * the sum **inside the same transaction as the insert**, where nothing can interleave.
 */
export interface PhotoAdmissionLimits {
  /** `events.quota_bytes`. The event's total `byteSize` may not pass it. */
  readonly quotaBytes: number
  /** `settings.maxPhotosPerGuest`; `null` is no cap. Never applies to a host author. */
  readonly maxPhotosPerGuest: number | null
  /**
   * A clip job whose staged source these rows are **replacing**, not adding to.
   *
   * The event's byte total spans `photos` and the staged sources in `clip_jobs`, which is
   * right for every other caller and wrong for exactly one: the transcode worker, which
   * inserts a clip's output while that clip's own job is still `running`. Its source is
   * therefore counted alongside the result it became — and a source is typically twenty
   * times the output, so an event anywhere near its quota refused a clip that plainly
   * fits. `event.quotaExceeded` is permanent here, so the outputs were unwound, the source
   * was deleted and the row went terminal; the host freeing space did not help, because a
   * re-upload deduped onto that terminal row.
   *
   * Naming the job rather than passing a number keeps the correction impossible to misuse:
   * the repository credits back what that job is actually charged, and nothing else. It is
   * credited only while the job still holds bytes — a `done` or `failed` job is charged
   * nothing, and crediting it twice would let the quota drift.
   */
  readonly replacesStagedClip?: ClipJobId
  /**
   * The ceiling the event's **client** puts on every one of its events together, or `null`
   * (the default) for an event with no client or a client with no `max_total_bytes`.
   *
   * Decided in the same transaction, over the same two tables, as the event's own quota —
   * the sum is `clientHoldingBytesSum`, photographs of every status plus the staged sources
   * of every clip still holding one, across **every event of that client**. An event is
   * refused by whichever ceiling it reaches first, and the event's own is named first when
   * both are reached. `replacesStagedClip` is credited here as well: a clip's output
   * replaces its source in the client's total exactly as it does in the event's.
   */
  readonly clientBytes?: ClientByteLimit | null
}

/**
 * Why a staged photo was not inserted, with the numbers observed at the moment of the
 * decision — so the caller reports the state that actually refused it rather than the
 * stale one it read before rendering.
 */
/**
 * Why one photo was refused: the author's cap, the event's quota or the client's ceiling
 * (`remaining` is what was left at the moment of the decision, `already` what the author
 * held). The decision and these shapes belong to `domain/events/admission`; the repository
 * only brings the sums.
 */
export type PhotoRefusal = PhotoCapRefusal | StorageRefusal

/** One verdict per submitted photo, in the order submitted. */
export interface PhotoAdmission {
  readonly photoId: PhotoId
  /** `null` when the row was inserted. */
  readonly refusal: PhotoRefusal | null
}

/**
 * Where a photograph lives, and nothing else: what the operator's takedown needs to act on a
 * photograph named by its id alone (launch review S5). Ids and an instant, never a byte, a
 * caption or an author.
 */
export interface PhotoLocation {
  readonly eventId: EventId
  /** When the operator took it down, or `null` while it is up. */
  readonly takenDownAt: Date | null
}

export interface PhotoRepository {
  findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null>

  /**
   * The idempotency check. A unique index on `(event_id, content_hash)` makes a
   * double-tapped submit or a retry after a dropped connection a no-op instead of a
   * duplicate slide.
   */
  findByContentHash(eventId: EventId, hash: ContentHash): Promise<Photo | null>

  /**
   * Every row in this event that still names these bytes — as its own content **or as a
   * clip's poster**.
   *
   * The media store is content-addressed, so a digest is shared by everything that hashes
   * to it, and deleting a file is only safe once nothing points at it. `contentHash` is
   * protected by `idx_photos_event_hash` and can never be shared; a **poster** has no
   * such index and is genuinely shareable: a poster is a deterministic 640-max-edge JPEG
   * of a frame taken one second in — or at the midpoint of a shorter clip, because a
   * phone recording's **first** frame is usually black — so two clips whose opening
   * second looks the same hash the same. A dark room, a stage before the lights, a hand
   * over the lens. Deleting one of them then turned the other into a broken tile on the
   * wall, in the grid and in the album, while its mp4 still played.
   *
   * Ids rather than a count, so a caller can ask the question it actually has — "is
   * anything **other than this row** holding them" — without arithmetic about whether it
   * is counting itself.
   */
  findIdsReferencing(eventId: EventId, hash: ContentHash): Promise<readonly PhotoId[]>

  /**
   * Every digest this event's rows name, as lower-case hex.
   *
   * The set form of the method above, for the reconciliation sweep. Asking per object was
   * one synchronous better-sqlite3 seek per digest on the connection that is also serving
   * uploads and the projector's range requests — forty events of six thousand files is
   * eighty thousand of them an hour, to re-confirm objects that were referenced last time
   * too. One query per event and a comparison in memory is the same answer for the cost
   * of one round trip.
   *
   * Strings rather than `ContentHash`, because the caller is comparing rather than
   * addressing, and hydrating forty thousand value objects to run `.has()` would put the
   * cost straight back.
   */
  listReferencedDigests(eventId: EventId): Promise<ReadonlySet<string>>

  /**
   * Newest first, with ties broken by **descending** id so two clients agree on the order.
   *
   * The cursor resumes inside a run of equal timestamps, which is routine: a multi-file
   * upload stamps every file of the batch with one `createdAt`. An implementation pages
   * through such a run without repeating or skipping a photo, at any limit; the contract
   * suite holds the SQLite adapter and the fake to it.
   */
  list(eventId: EventId, query?: PhotoQuery): Promise<PhotoPage>

  /**
   * Ordered ids only, for the wall. The playlist needs a stable list of hundreds of
   * ids, not hundreds of hydrated aggregates.
   */
  listIdsByStatus(eventId: EventId, status: PhotoStatus, limit: number): Promise<readonly PhotoId[]>

  countsByStatus(eventId: EventId): Promise<PhotoStatusCounts>

  /** Drives the event byte quota. */
  totalBytes(eventId: EventId): Promise<number>

  /**
   * What **every event of this client together** holds, photographs and staged clip sources:
   * the sum `PhotoAdmissionLimits.clientBytes` is judged against.
   *
   * It drives the cheap check an upload makes before it writes three variants to the disk,
   * exactly as {@link PhotoRepository.totalBytes} does for one event. It is **not** the
   * enforcing read: that is the sum `saveManyWithinLimits` takes inside its own transaction.
   * Scoped by client the way every other method here is scoped by event — an event with no
   * client is nobody's, and a client's number never includes another's.
   */
  clientTotalBytes(clientId: ClientId): Promise<number>

  countByAuthor(eventId: EventId, guestId: GuestId): Promise<number>

  save(photo: Photo): Promise<void>

  /**
   * Inserts the photos of one upload that the event still has room for, and reports the
   * ones it does not — the whole thing in a single transaction.
   *
   * This is the only bulk insert, and it is the only place the byte quota and the
   * per-guest cap are actually enforced. An unconditional `saveMany` used to sit here
   * beside it, and the quota was decided before the batch was rendered: two guests
   * uploading at the same moment both read the same usage, both passed, and the quota
   * was beatable by a factor equal to the number of requests in flight. Counting inside
   * the write transaction is what closes that, so there is deliberately no way to insert
   * an upload without the check.
   *
   * Partial by design, in the order given: a photo that does not fit is reported, and
   * the ones after it are still considered. That matches how a batch already behaves
   * everywhere else in ingest — five photos and one refusal, not one opaque failure.
   *
   * Insert only. A photo id that already exists raises, because ingest mints a fresh id
   * per file and a collision there is a bug, not an update. So does a content hash the
   * event already holds, **for the whole batch**: the use case treats that raise as the
   * lost half of a race between two identical uploads, asks `findByContentHash` again and
   * answers the photos that now have a twin as duplicates. An adapter that swallowed it
   * (`ON CONFLICT DO NOTHING`) would report a photo stored that no row names. 1.0 fired one insert per
   * file through `Promise.all` with no transaction, so a failure part-way left some rows
   * committed and some not; anything that raises here leaves the batch entirely unwritten.
   */
  saveManyWithinLimits(
    eventId: EventId,
    photos: readonly Photo[],
    limits: PhotoAdmissionLimits,
  ): Promise<readonly PhotoAdmission[]>

  /**
   * Which event holds this photograph, **across every event**: the one read in this port that
   * is not scoped by `eventId`, and the documented exception to "there is deliberately no
   * `findById(photoId)`". It answers an id and an instant and nothing a person made, and its
   * one caller is `setPhotoTakedown`: an operator told "photo <id>" has no event to name, and
   * must never be handed the photograph to find one. It also sees a taken-down row, which every
   * other read here leaves out. `null` for an id no row holds.
   */
  locate(photoId: PhotoId): Promise<PhotoLocation | null>

  /**
   * How many photographs of this guest the operator took down, which every read above leaves out.
   *
   * For a guest erasing what they sent: a taken-down photograph is preserved evidence and is
   * neither deleted nor counted by that erasure, and its row hangs from the guest row by a
   * cascading foreign key, so the guest row must stay while this is not zero. Scoped by event.
   */
  countTakenDownBy(eventId: EventId, guestId: GuestId): Promise<number>

  /**
   * Takes a photograph down (`at`) or puts it back (`null`), for `setPhotoTakedown` (launch
   * review S5). Scoped by event like everything else, and idempotent. `save` and
   * `updateStatuses` never write this column, so the host's moderation cannot undo it.
   *
   * **A taken-down row is invisible to `findById`, `list`, `listIdsByStatus` and
   * `countsByStatus`**, which is what removes it from the wall, a guest's feed, a gallery link,
   * the host's grid and the media route in one place. It still counts toward `totalBytes`,
   * `countByAuthor` and the client's total (the bytes are on the disk), is still named by
   * `findByContentHash` (so the same bytes cannot be uploaded again as a new photograph, and a
   * retry lands on the duplicate path), and is still referenced by `findIdsReferencing` and
   * `listReferencedDigests`, so no sweep collects its files: it is kept, not deleted.
   */
  setTakenDown(eventId: EventId, photoId: PhotoId, at: Date | null): Promise<void>

  /**
   * Stars a photograph (`at`) or takes the star off (`null`), for the host's best-of (spec 08).
   *
   * Scoped by event and idempotent. Setting answers `false`, and writes nothing, for a photograph
   * that is not found or not `published` (decided in the write itself, so a moderation landing
   * between a read and this call cannot leave a star on a hidden photograph); clearing answers
   * `false` only for a photograph that is not found. `save` and `updateStatuses` never write the
   * star (a stale read cannot erase one set in between), except to clear it when a row leaves
   * `published`. A taken-down row keeps its star but is not found here, as everywhere else.
   */
  setHighlighted(eventId: EventId, photoId: PhotoId, at: Date | null): Promise<boolean>

  /** How many favourites the event has: starred, published, not taken down. */
  countHighlighted(eventId: EventId): Promise<number>

  /** Idempotent: deleting an already-deleted photo is not an error. */
  delete(eventId: EventId, photoId: PhotoId): Promise<void>

  /**
   * Bulk moderation. Returns the ids actually changed, so the use case can announce
   * exactly those and the console can undo exactly those.
   */
  updateStatuses(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    status: PhotoStatus,
    review: PhotoReview,
  ): Promise<readonly PhotoId[]>
}
