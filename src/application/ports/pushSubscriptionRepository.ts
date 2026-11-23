import type { PushSubscription } from '../../domain/push/pushSubscription'
import type { EventId, UserId } from '../../domain/shared/ids'

/**
 * The browsers that asked to be told about an event's replies (spec 30, lot 4, Web Push).
 *
 * Every method names the event, and a removal also names the account: **a host removes only their
 * own browsers**, and an endpoint is a capability URL that is never looked up on its own.
 */
export interface PushSubscriptionRepository {
  /**
   * Stores a subscription, or refreshes one the same browser already holds for this event and account
   * (`UNIQUE (endpoint, event_id, user_id)`: the keys are replaced, the id and the creation stay).
   * A new one past {@link MAX_PUSH_SUBSCRIPTIONS_PER_USER_EVENT} is `tooMany` (decided in the same write
   * transaction, so overlapping requests cannot pass the cap) and nothing is written.
   */
  upsert(
    subscription: PushSubscription,
    maxPerUserEvent: number,
  ): Promise<'added' | 'updated' | 'tooMany'>

  /** Removes this account's subscription of this browser for the event. Says whether one existed. */
  remove(eventId: EventId, userId: UserId, endpoint: string): Promise<boolean>

  /** Removes one subscription by its id, within the event (the push service said it is gone). */
  removeById(eventId: EventId, id: string): Promise<boolean>

  /** Every subscription of the event, oldest first. */
  listByEvent(eventId: EventId): Promise<readonly PushSubscription[]>
}
