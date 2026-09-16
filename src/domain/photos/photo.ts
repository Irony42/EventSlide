import type { ClipDuration } from '../clips/clipDuration'
import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EventId, GuestId, PhotoId, UserId } from '../shared/ids'
import type { Caption } from './caption'
import type { ContentHash } from './contentHash'
import type { Dimensions } from './dimensions'
import type { MediaKind } from './mediaKind'
import { VARIANTS_BY_KIND, type MediaVariant, type ServedVariant } from './mediaVariant'
import { canTransition, type PhotoStatus } from './photoStatus'

/** Who sent the photo. Hosts can upload too — the venue's own camera roll. */
export type PhotoAuthor =
  | { readonly kind: 'guest'; readonly guestId: GuestId }
  | { readonly kind: 'host'; readonly userId: UserId }

/**
 * Who made a moderation decision. `automatic` exists because an event may run in
 * auto-publish mode, and "nobody decided this" must be distinguishable from "the host
 * decided this" when someone asks afterwards how a photo got on the wall.
 */
export type Reviewer =
  | { readonly kind: 'host'; readonly userId: UserId }
  | { readonly kind: 'automatic' }

export type PhotoReview = Reviewer & { readonly at: Date }

/** Anyone who might act on a photo. Used by the permission predicates below. */
export type PhotoActor =
  | { readonly kind: 'guest'; readonly guestId: GuestId }
  | { readonly kind: 'host'; readonly userId: UserId }

/**
 * What this row *is*, and the extra facts that follow from it.
 *
 * A discriminated union rather than three nullable columns hanging off every photo: a
 * still has no duration and no poster, and `duration: null` on ten thousand rows is a
 * field every reader has to remember cannot be trusted. Here the compiler carries it —
 * `photo.facet.duration` does not exist until `facet.kind` has been narrowed.
 *
 * `kind` is consulted where a **rule** differs and nowhere else; everything mechanical
 * about a clip is a lookup indexed by it (see `mediaVariant.ts`).
 */
export type PhotoFacet =
  | { readonly kind: 'photo' }
  | {
      readonly kind: 'clip'
      readonly duration: ClipDuration
      /**
       * The digest of the still frame. A clip has **two** hashes: `contentHash`
       * addresses the mp4, this addresses the poster JPEG, and each names its own bytes.
       * Neither is the hash of what the guest uploaded — that one lives on the
       * `ClipJob`, is the job's idempotency key, and never enters
       * `photos (event_id, content_hash)`.
       */
      readonly posterHash: ContentHash
    }

/** The facet of an ordinary still. A constant, because it carries nothing. */
export const STILL: PhotoFacet = { kind: 'photo' }

export interface PhotoProps {
  readonly id: PhotoId
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly status: PhotoStatus
  readonly contentHash: ContentHash
  readonly dimensions: Dimensions
  readonly byteSize: number
  readonly caption: Caption | null
  readonly createdAt: Date
  readonly review: PhotoReview | null
  readonly facet: PhotoFacet
}

export interface NewPhoto {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly contentHash: ContentHash
  readonly dimensions: Dimensions
  readonly byteSize: number
  readonly caption: Caption | null
  /** Omitted for the overwhelmingly common case, which is a photograph. */
  readonly facet?: PhotoFacet
}

/**
 * A photo sent to an event.
 *
 * Immutable: every transition returns a new instance, so a repository can never be
 * handed a half-mutated entity and a caller can hold on to the previous state for an
 * undo. Time always arrives as a parameter — the clock is a port.
 */
export class Photo {
  private constructor(private readonly props: PhotoProps) {}

  /**
   * A newly ingested photo. Always starts `pending`, even on an auto-publish event:
   * the use case publishes it immediately afterwards with an `automatic` reviewer, so
   * the wall never shows a photo that has no recorded decision.
   */
  static create(input: NewPhoto, id: PhotoId, now: Date): Result<Photo, DomainError> {
    if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
      return err(DomainError.invalid('photo.byteSizeInvalid'))
    }
    return ok(
      new Photo({
        id,
        eventId: input.eventId,
        author: input.author,
        status: 'pending',
        contentHash: input.contentHash,
        dimensions: input.dimensions,
        byteSize: input.byteSize,
        caption: input.caption,
        createdAt: now,
        review: null,
        facet: input.facet ?? STILL,
      }),
    )
  }

  /**
   * Rehydrate from storage. Trusts the row: the values were validated on the way in
   * and the schema's `CHECK` constraints and foreign keys back that up. Anything
   * malformed here is a corrupt database, which is a bug to surface loudly rather than
   * a user error to model.
   */
  static restore(props: PhotoProps): Photo {
    return new Photo(props)
  }

  get id(): PhotoId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get author(): PhotoAuthor {
    return this.props.author
  }

  get status(): PhotoStatus {
    return this.props.status
  }

  get contentHash(): ContentHash {
    return this.props.contentHash
  }

  get dimensions(): Dimensions {
    return this.props.dimensions
  }

  get byteSize(): number {
    return this.props.byteSize
  }

  get caption(): Caption | null {
    return this.props.caption
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get review(): PhotoReview | null {
    return this.props.review
  }

  get facet(): PhotoFacet {
    return this.props.facet
  }

  get kind(): MediaKind {
    return this.props.facet.kind
  }

  /**
   * Which rendition this row actually has.
   *
   * A lookup, so asking a photograph for a `video` misses on the **row** rather than on
   * the disk: the media use case answers `photo.notFound` instead of reaching the store,
   * failing to stat a file, and reporting `photo.mediaMissing` — which is the code that
   * means "a row points at bytes that are gone", a genuine corruption worth an operator's
   * attention. Two different conditions must not produce the same log line.
   */
  hasVariant(variant: ServedVariant): boolean {
    return VARIANTS_BY_KIND[this.props.facet.kind].includes(variant)
  }

  /**
   * The digest the bytes of this rendition are stored under.
   *
   * Every rendition of a still shares the photo's own hash. A clip's poster is a
   * different file with a different digest, so it is addressed by its own — which keeps
   * the media store's one invariant intact: the name of a file is the hash of that file.
   */
  hashFor(variant: MediaVariant): ContentHash {
    const facet = this.props.facet
    return facet.kind === 'clip' && variant === 'poster'
      ? facet.posterHash
      : this.props.contentHash
  }

  /**
   * Every digest this row owns, so deleting it removes every byte it put on the disk.
   *
   * A still owns one; a clip owns the mp4's and the poster's. The staged source is not
   * here: it belongs to the `ClipJob`, and it is gone before this row exists.
   */
  get storageHashes(): readonly ContentHash[] {
    const facet = this.props.facet
    return facet.kind === 'clip'
      ? [this.props.contentHash, facet.posterHash]
      : [this.props.contentHash]
  }

  // ---------------------------------------------------------------- moderation --

  publish(by: Reviewer, at: Date): Result<Photo, DomainError> {
    return this.transitionTo('published', by, at)
  }

  reject(by: Reviewer, at: Date): Result<Photo, DomainError> {
    return this.transitionTo('rejected', by, at)
  }

  hide(by: Reviewer, at: Date): Result<Photo, DomainError> {
    return this.transitionTo('hidden', by, at)
  }

  /**
   * The single gate for every status change.
   *
   * A no-op transition is accepted and still records the decision, so a host
   * double-clicking "publish" gets a success rather than a confusing conflict.
   */
  transitionTo(next: PhotoStatus, by: Reviewer, at: Date): Result<Photo, DomainError> {
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('photo.illegalTransition', {
          from: this.props.status,
          to: next,
        }),
      )
    }
    return ok(this.with({ status: next, review: { ...by, at } }))
  }

  // ------------------------------------------------------------------ captions --

  /**
   * Replace or clear the caption.
   *
   * Rejected on an archived-event photo? No — that is the event's rule, checked by the
   * use case, which owns the event. This method owns only what a photo knows about
   * itself.
   */
  withCaption(caption: Caption | null): Photo {
    return this.with({ caption })
  }

  // --------------------------------------------------------------- permissions --

  isAuthoredBy(actor: PhotoActor): boolean {
    if (actor.kind === 'guest') {
      return this.props.author.kind === 'guest' && this.props.author.guestId === actor.guestId
    }
    return this.props.author.kind === 'host' && this.props.author.userId === actor.userId
  }

  /**
   * A guest can take back a photo they regret, but only for a while. Without a window
   * a guest could delete a photo hours later, after it has been seen and after the
   * host built the album around it; without any window at all they would have to find
   * the host and ask.
   */
  isWithinAuthorGrace(now: Date, graceMs: number): boolean {
    return now.getTime() - this.props.createdAt.getTime() <= graceMs
  }

  /**
   * Hosts may always delete. A guest may delete their own photo inside the grace
   * window — and only while it has not yet been published, because pulling a photo off
   * the wall mid-slideshow is the host's call.
   */
  canBeDeletedBy(actor: PhotoActor, now: Date, graceMs: number): boolean {
    if (actor.kind === 'host') return true
    if (!this.isAuthoredBy(actor)) return false
    if (!this.isWithinAuthorGrace(now, graceMs)) return false
    return this.props.status === 'pending' || this.props.status === 'rejected'
  }

  /** Same shape as deletion, plus: a published caption is the host's to change. */
  canCaptionBeEditedBy(actor: PhotoActor, now: Date, graceMs: number): boolean {
    if (actor.kind === 'host') return true
    return (
      this.isAuthoredBy(actor) &&
      this.isWithinAuthorGrace(now, graceMs) &&
      this.props.status === 'pending'
    )
  }

  // -------------------------------------------------------------------- helpers --

  /** Same bytes in the same event: the upload is a retry, not a new photo. */
  isDuplicateOf(other: Photo): boolean {
    return (
      this.props.eventId === other.props.eventId &&
      this.props.contentHash.equals(other.props.contentHash)
    )
  }

  equals(other: Photo): boolean {
    return this.props.id === other.props.id
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): PhotoProps {
    return this.props
  }

  private with(changes: Partial<PhotoProps>): Photo {
    return new Photo({ ...this.props, ...changes })
  }
}
