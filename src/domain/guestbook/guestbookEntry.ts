import type { ModerationMode } from '../events/eventSettings'
import type { PhotoReview, Reviewer } from '../photos/photo'
import { canTransition, type PhotoStatus } from '../photos/photoStatus'
import { authorMayTakeBack, removalVerdict, type DeletionVerdict } from '../photos/selfRemoval'
import { DomainError } from '../shared/errors'
import type { EventId, GuestId, GuestbookEntryId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import type { GuestbookText } from './guestbookText'

/**
 * A message a guest left in an event's guestbook (spec 01).
 *
 * It has the life of a photograph and borrows its machine whole: the same four statuses, the same
 * legal moves (`photos/photoStatus.ts`), the same reviewer. A host who knows how to moderate a
 * photo has nothing to learn, and there is one transition table to keep right rather than two.
 *
 * Immutable like `Photo`: every decision returns a new instance, time arrives as a parameter.
 */

/** A message is judged by the photograph machine; the alias says why it is not a copy. */
export type EntryStatus = PhotoStatus

export interface GuestbookEntryProps {
  readonly id: GuestbookEntryId
  readonly eventId: EventId
  readonly guestId: GuestId
  readonly text: GuestbookText
  readonly status: EntryStatus
  readonly review: PhotoReview | null
  readonly createdAt: Date
  /** The operator took it down without reading it; set only by the operator's route. */
  readonly takenDownAt: Date | null
}

export interface NewGuestbookEntry {
  readonly eventId: EventId
  readonly guestId: GuestId
  readonly text: GuestbookText
}

/** Who may act on an entry, for the removal rule. */
export type EntryActor =
  | { readonly kind: 'guest'; readonly guestId: GuestId }
  | { readonly kind: 'host'; readonly userId: UserId }

export class GuestbookEntry {
  private constructor(private readonly props: GuestbookEntryProps) {}

  /**
   * A message just written. `published` at once on an event that publishes on arrival, recorded
   * as an `automatic` decision so "nobody decided this" stays distinguishable from "the host
   * decided this"; `pending` otherwise, held for a moderator.
   */
  static create(
    input: NewGuestbookEntry,
    id: GuestbookEntryId,
    now: Date,
    moderation: ModerationMode,
  ): GuestbookEntry {
    const auto = moderation === 'auto'
    return new GuestbookEntry({
      id,
      eventId: input.eventId,
      guestId: input.guestId,
      text: input.text,
      status: auto ? 'published' : 'pending',
      review: auto ? { kind: 'automatic', at: now } : null,
      createdAt: now,
      takenDownAt: null,
    })
  }

  /** Rebuild what a repository read back, with no rule re-judged. */
  static restore(props: GuestbookEntryProps): GuestbookEntry {
    return new GuestbookEntry(props)
  }

  get id(): GuestbookEntryId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get guestId(): GuestId {
    return this.props.guestId
  }
  get text(): GuestbookText {
    return this.props.text
  }
  get status(): EntryStatus {
    return this.props.status
  }
  get review(): PhotoReview | null {
    return this.props.review
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get takenDownAt(): Date | null {
    return this.props.takenDownAt
  }

  publish(by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    return this.transitionTo('published', by, at)
  }

  reject(by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    return this.transitionTo('rejected', by, at)
  }

  hide(by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    return this.transitionTo('hidden', by, at)
  }

  /** The single gate for every status change; a no-op transition is accepted and recorded. */
  transitionTo(next: EntryStatus, by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('guestbook.illegalTransition', { from: this.props.status, to: next }),
      )
    }
    return ok(new GuestbookEntry({ ...this.props, status: next, review: { ...by, at } }))
  }

  isAuthoredBy(guestId: GuestId): boolean {
    return this.props.guestId === guestId
  }

  /**
   * The whole answer to "may this actor remove this message in an event with these settings".
   *
   * **The photograph's rule, not a rule of its own** (`photos/selfRemoval.ts`): the host's switch
   * over the feature, then the author inside the grace window while the message is not on the
   * wall. The guest's `canDelete` is `verdict === 'allowed'`, so a phone is never shown a button
   * the server refuses, and the privacy notice says one thing about removal for both.
   */
  deletionVerdict(
    actor: EntryActor,
    now: Date,
    settings: { readonly allowGuestSelfDelete: boolean; readonly guestSelfDeleteGraceMs: number },
  ): DeletionVerdict {
    const mayRemove =
      actor.kind === 'host' ||
      authorMayTakeBack({
        isAuthor: this.isAuthoredBy(actor.guestId),
        createdAt: this.props.createdAt,
        now,
        graceMs: settings.guestSelfDeleteGraceMs,
        status: this.props.status,
      })
    return removalVerdict(actor.kind === 'guest', mayRemove, settings.allowGuestSelfDelete)
  }

  toProps(): GuestbookEntryProps {
    return this.props
  }
}
