import type { ModerationMode } from '../events/eventSettings'
import { allowedDecisionsFrom, type ModerationDecision } from '../moderation/moderationDecision'
import type { PhotoReview, Reviewer } from '../photos/photo'
import { canTransition, type PhotoStatus } from '../photos/photoStatus'
import { authorMayTakeBack, removalVerdict, type DeletionVerdict } from '../photos/selfRemoval'
import { DomainError } from '../shared/errors'
import type { EventId, GuestId, GuestbookEntryId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import type { GuestbookText } from './guestbookText'
import type { GuestbookVoice } from './guestbookVoice'

/**
 * A message a guest left in an event's guestbook (spec 01).
 *
 * It has the life of a photograph and borrows its machine whole: the same four statuses, the same
 * legal moves (`photos/photoStatus.ts`), the same reviewer. A host who knows how to moderate a
 * photo has nothing to learn, and there is one transition table to keep right rather than two.
 *
 * Immutable like `Photo`: every decision returns a new instance, time arrives as a parameter.
 *
 * **A voice message is the same entry with a recording** (spec 25): `voice` is set and `text` is
 * `null`, the guest's optional line living on `voice.caption`. Exactly one of the two is set, and
 * every reader of `text` has to say what it does with a message that has none.
 */

/** A message is judged by the photograph machine; the alias says why it is not a copy. */
export type EntryStatus = PhotoStatus

export interface GuestbookEntryProps {
  readonly id: GuestbookEntryId
  readonly eventId: EventId
  readonly guestId: GuestId
  /** `null` for a voice message: its words are the recording, and its line is `voice.caption`. */
  readonly text: GuestbookText | null
  /** The recording and where its processing stands, or `null` for a written message. */
  readonly voice: GuestbookVoice | null
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

export interface NewGuestbookVoiceEntry {
  readonly eventId: EventId
  readonly guestId: GuestId
  /** A reservation: `GuestbookVoice.create`'s, whose bytes are about to be written. */
  readonly voice: GuestbookVoice
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
      voice: null,
      status: auto ? 'published' : 'pending',
      review: auto ? { kind: 'automatic', at: now } : null,
      createdAt: now,
      takenDownAt: null,
    })
  }

  /**
   * A voice message just recorded, with the moderation of the event as a written one has
   * (`published` at once in `auto`, `pending` otherwise). It is listenable, decidable and
   * archivable only once its voice is `ready`: moderation and processing are two axes.
   */
  static createVoice(
    input: NewGuestbookVoiceEntry,
    id: GuestbookEntryId,
    now: Date,
    moderation: ModerationMode,
  ): GuestbookEntry {
    const auto = moderation === 'auto'
    return new GuestbookEntry({
      id,
      eventId: input.eventId,
      guestId: input.guestId,
      text: null,
      voice: input.voice,
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
  get text(): GuestbookText | null {
    return this.props.text
  }
  get voice(): GuestbookVoice | null {
    return this.props.voice
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

  /** A voice is never on a screen, so `hidden` would change nothing visible and keep it in the album. */
  hide(by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    return this.transitionTo('hidden', by, at)
  }

  /** The single gate for every status change; a no-op transition is accepted and recorded. */
  transitionTo(next: EntryStatus, by: Reviewer, at: Date): Result<GuestbookEntry, DomainError> {
    if (next === 'hidden' && this.props.voice !== null) {
      return err(DomainError.conflict('guestbook.voiceCannotHide'))
    }
    // Nobody can listen to a recording that is still being processed, or that failed, so there is
    // nothing to decide yet (or ever): moderation and processing are two axes, and this is where
    // the first waits for the second.
    if (!this.isDecidable()) return err(DomainError.conflict('guestbook.voiceNotReady'))
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('guestbook.illegalTransition', { from: this.props.status, to: next }),
      )
    }
    return ok(new GuestbookEntry({ ...this.props, status: next, review: { ...by, at } }))
  }

  /**
   * Whether a host may decide on it now: a written message always, a voice only once `ready`
   * (spec 25, rule 2). The console lists nothing else, and `transitionTo` refuses the rest.
   */
  isDecidable(): boolean {
    return this.props.voice === null || this.props.voice.isReady()
  }

  /**
   * The decisions the host's buttons may offer for this message **now**: the status machine's
   * (`allowedDecisionsFrom`) minus `hide` on a voice, which is never on a screen so would change
   * nothing visible and keep it in the album, and none at all while it cannot be listened to.
   */
  allowedDecisions(): readonly ModerationDecision[] {
    if (!this.isDecidable()) return []
    const decisions = allowedDecisionsFrom(this.props.status)
    return this.props.voice === null
      ? decisions
      : decisions.filter((decision) => decision !== 'hide')
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
    if (this.props.voice !== null) return this.voiceDeletionVerdict(actor, now, settings)
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

  /**
   * **Rule 1 bis of spec 25: a voice has a removal rule of its own.**
   *
   * The photograph's rule lets an author take back only what is `pending` or `rejected`, because
   * pulling something off the wall mid-evening is the host's call. That reason does not exist for
   * a voice, which is never on a screen; kept as it was, a voice published on arrival in `auto`
   * could only be undone by "Tout effacer", which takes every photograph with it. So:
   *
   * - the host's veto over the feature stays (`selfDeleteDisabled`);
   * - the author may remove their voice **inside the grace window whatever its status**, while
   *   the operator has not taken it down (the server does not know what the host has listened to,
   *   so the window is the only guard);
   * - a voice that **failed** is removable by its author **without condition**, the window and the
   *   veto included: there is no content left to protect and the guest is only cleaning up.
   */
  private voiceDeletionVerdict(
    actor: EntryActor,
    now: Date,
    settings: { readonly allowGuestSelfDelete: boolean; readonly guestSelfDeleteGraceMs: number },
  ): DeletionVerdict {
    const isAuthor = actor.kind === 'guest' && this.isAuthoredBy(actor.guestId)
    if (this.props.voice?.state === 'failed' && (actor.kind === 'host' || isAuthor)) {
      return 'allowed'
    }
    const withinGrace =
      this.props.takenDownAt === null &&
      now.getTime() - this.props.createdAt.getTime() <= settings.guestSelfDeleteGraceMs
    const mayRemove = actor.kind === 'host' || (isAuthor && withinGrace)
    return removalVerdict(actor.kind === 'guest', mayRemove, settings.allowGuestSelfDelete)
  }

  toProps(): GuestbookEntryProps {
    return this.props
  }
}

/** A written message: the entry whose `text` is known to be there, for what only reads words. */
export type WrittenGuestbookEntry = GuestbookEntry & { readonly text: GuestbookText }

/** A voice message: the entry whose recording is known to be there, for what reads or removes it. */
export type VoiceGuestbookEntry = GuestbookEntry & { readonly voice: GuestbookVoice }

/** Narrows an entry to a voice message, `false` for a written one. */
export const isVoiceMessage = (entry: GuestbookEntry): entry is VoiceGuestbookEntry =>
  entry.voice !== null

/** Narrows an entry to a written message, `false` for a voice. */
export const isWritten = (entry: GuestbookEntry): entry is WrittenGuestbookEntry =>
  entry.text !== null
