import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'
import type { EventStatus } from '../../domain/events/eventStatus'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import type { ReactionKind } from '../../domain/reactions/reactionKind'

/**
 * What happened, as facts. Every event carries its `eventId`, because every subscriber
 * is scoped to one event — the SSE hub must never deliver a wedding's activity to a
 * corporate gala's projector, and 1.0's single global `EventEmitter` with a
 * `partyName === updatedPartyId` comparison inside the listener was one typo away from
 * exactly that.
 *
 * Names are past tense: a bus carries facts, not commands.
 */
export type DomainEvent =
  | { readonly type: 'photo.uploaded'; readonly eventId: EventId; readonly photoId: PhotoId }
  | {
      readonly type: 'photo.moderated'
      readonly eventId: EventId
      readonly photoId: PhotoId
      readonly status: PhotoStatus
    }
  | { readonly type: 'photo.deleted'; readonly eventId: EventId; readonly photoId: PhotoId }
  | { readonly type: 'photo.captionChanged'; readonly eventId: EventId; readonly photoId: PhotoId }
  | { readonly type: 'guest.joined'; readonly eventId: EventId; readonly guestId: GuestId }
  | {
      readonly type: 'reaction.added'
      readonly eventId: EventId
      readonly photoId: PhotoId
      readonly kind: ReactionKind
    }
  | {
      readonly type: 'event.statusChanged'
      readonly eventId: EventId
      readonly status: EventStatus
    }
  | { readonly type: 'event.settingsChanged'; readonly eventId: EventId }

export type DomainEventType = DomainEvent['type']

export type Unsubscribe = () => void

export interface EventBus {
  /**
   * Announce a fact. Never throws and never awaits a subscriber: a slow projector must
   * not be able to fail a guest's upload.
   */
  publish(event: DomainEvent): void

  /**
   * Listen to one event's activity. The `eventId` is a hard filter applied by the hub,
   * not a suggestion the listener is trusted to honour.
   */
  subscribe(eventId: EventId, listener: (event: DomainEvent) => void): Unsubscribe
}
