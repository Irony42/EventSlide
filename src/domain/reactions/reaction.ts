import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EventId, GuestId, PhotoId, ReactionId } from '../shared/ids'
import { isReactionKind, type ReactionKind } from './reactionKind'

export interface ReactionProps {
  readonly id: ReactionId
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly guestId: GuestId
  readonly kind: ReactionKind
  readonly createdAt: Date
}

/**
 * What arrives from a phone.
 *
 * `kind` is a raw string on purpose. The closed set is the promise this aggregate
 * makes to the room, so it is parsed here — once, in the domain — rather than trusted
 * from a caller who may have widened it on the way in.
 */
export interface NewReaction {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly guestId: GuestId
  readonly kind: string
}

/**
 * One guest's reaction to one photo.
 *
 * A reaction is a fact with no lifecycle: it is created and, at most, deleted. There
 * is deliberately no `changeKind` — a guest who taps the wrong button removes it and
 * taps again, which keeps the one-per-guest-per-kind unique index meaningful instead
 * of giving the same intent two code paths.
 */
export class Reaction {
  private constructor(private readonly props: ReactionProps) {}

  static create(input: NewReaction, id: ReactionId, now: Date): Result<Reaction, DomainError> {
    if (!isReactionKind(input.kind)) {
      return err(DomainError.invalid('reaction.kindUnknown'))
    }
    return ok(
      new Reaction({
        id,
        eventId: input.eventId,
        photoId: input.photoId,
        guestId: input.guestId,
        kind: input.kind,
        createdAt: now,
      }),
    )
  }

  /**
   * Rehydrate from storage. Trusts the row: the kind was parsed on the way in and the
   * schema's CHECK constraint and foreign keys back that up. Anything malformed here
   * is a corrupt database — a bug to surface loudly, not a user error to model.
   */
  static restore(props: ReactionProps): Reaction {
    return new Reaction(props)
  }

  get id(): ReactionId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get photoId(): PhotoId {
    return this.props.photoId
  }

  get guestId(): GuestId {
    return this.props.guestId
  }

  get kind(): ReactionKind {
    return this.props.kind
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  /**
   * Both predicates exist for the phone's own view: it holds the reactions it has
   * already sent for the photo currently on the wall, so the buttons can show as
   * already tapped without another round trip over venue Wi-Fi.
   */
  isBy(guestId: GuestId): boolean {
    return this.props.guestId === guestId
  }

  isFor(photoId: PhotoId): boolean {
    return this.props.photoId === photoId
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): ReactionProps {
    return this.props
  }
}
