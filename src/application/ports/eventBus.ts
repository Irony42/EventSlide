import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'
import type { EventStatus } from '../../domain/events/eventStatus'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import type { ReactionKind } from '../../domain/reactions/reactionKind'
import type { DomainError } from '../../domain/shared/errors'
import type { Result } from '../../domain/shared/result'

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

/**
 * What the bus knows about one announcement that a subscriber cannot work out alone.
 *
 * `sequence` is minted **once per delivered publish** and handed unchanged to every
 * subscriber of that fact. It exists because the SSE hub has to number the frames it
 * writes, and only the bus knows that one fact was announced once: numbering inside
 * each subscriber's callback produced N different ids for N connected clients, so
 * `Last-Event-ID` was not a shared id space and the replay ring was consumed N times
 * faster than its size suggested.
 *
 * Monotonic and unique for the life of the process, across every event — never reused
 * and never reset, so a client that reconnects after the last subscriber for its event
 * left still holds a cursor that is strictly behind whatever comes next.
 */
export interface Delivery {
  readonly sequence: number
}

export type EventListener = (event: DomainEvent, delivery: Delivery) => void

export interface EventBus {
  /**
   * Announce a fact. Never throws and never awaits a subscriber: a slow projector must
   * not be able to fail a guest's upload.
   */
  publish(event: DomainEvent): void

  /**
   * Listen to one event's activity. The `eventId` is a hard filter applied by the hub,
   * not a suggestion the listener is trusted to honour.
   *
   * **Fallible on purpose.** An implementation bounds how many subscribers one event
   * may hold, and refusing is an expected outcome rather than a bug — so it is a
   * `Result`, like every other port. It was an `Unsubscribe` alone, and the adapter
   * answered a refusal with a no-op unsubscribe function that no caller could tell
   * from a live subscription: past the cap a projector was served `200` and a
   * heartbeat for the rest of the evening and never one signal, while reporting itself
   * connected. The intention was written in a comment — "the HTTP layer decides
   * whether to answer 503" — and that intention was inexpressible in the signature,
   * which is exactly how it was lost.
   *
   * A caller must therefore decide: the HTTP layer answers `503` **before** it writes
   * a header, because once an event stream has started there is no longer any way to
   * say no.
   */
  subscribe(eventId: EventId, listener: EventListener): Result<Unsubscribe, DomainError>
}
