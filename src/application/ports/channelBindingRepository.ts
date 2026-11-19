import type { ChannelBinding } from '../../domain/channels/channelBinding'
import type { ChannelKind } from '../../domain/channels/channelKind'
import type { ChannelBindingId, EventId } from '../../domain/shared/ids'

/**
 * The links between messaging conversations and events (spec 27).
 *
 * One read is **not** scoped by an event, deliberately and for the one caller that has no event to
 * start from: {@link ChannelBindingRepository.findActive} answers a poller that holds a
 * conversation's identifier and asks "where does this go". Nothing a request supplies reaches it;
 * the host's reads ({@link ChannelBindingRepository.listActiveForEvent}, `findById`) take the event first.
 */
export interface ChannelBindingRepository {
  /** The one active binding of a conversation, or `null`: at most one exists (a unique index holds it). */
  findActive(channel: ChannelKind, conversationRef: string): Promise<ChannelBinding | null>

  /** Scoped by event: another event's binding id is a miss. */
  findById(eventId: EventId, bindingId: ChannelBindingId): Promise<ChannelBinding | null>

  /** The event's active bindings, oldest first (`bound_at`, then id). */
  listActiveForEvent(eventId: EventId): Promise<readonly ChannelBinding[]>

  /**
   * Insert a binding, or update the three things that can change: the conversation's identifier (a
   * group became a supergroup), its title, and the end of the link. The event, the channel and the
   * instant of binding never change. Activating a second binding for a conversation that has one
   * active throws: the use case ends the old one first.
   */
  save(binding: ChannelBinding): Promise<void>

  /** One more media received through this binding. Atomic; an unknown id is not an error. */
  recordReceived(bindingId: ChannelBindingId): Promise<void>
}
