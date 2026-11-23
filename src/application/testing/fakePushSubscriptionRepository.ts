import type { PushSubscription } from '../../domain/push/pushSubscription'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { PushSubscriptionRepository } from '../ports/pushSubscriptionRepository'

/** In-memory `PushSubscriptionRepository`, held to the same contract suite as the SQLite adapter. */
export class FakePushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly rows: PushSubscription[] = []

  async upsert(
    subscription: PushSubscription,
    maxPerUserEvent: number,
  ): Promise<'added' | 'updated' | 'tooMany'> {
    const at = this.rows.findIndex(
      (row) =>
        row.endpoint === subscription.endpoint &&
        row.eventId === subscription.eventId &&
        row.userId === subscription.userId,
    )
    if (at >= 0) {
      const held = this.rows[at] as PushSubscription
      // The keys are replaced; the id and the creation stay.
      this.rows[at] = held.withKeys(subscription.p256dh, subscription.auth)
      return 'updated'
    }
    const mine = this.rows.filter(
      (row) => row.eventId === subscription.eventId && row.userId === subscription.userId,
    )
    if (mine.length >= maxPerUserEvent) return 'tooMany'
    this.rows.push(subscription)
    return 'added'
  }

  async remove(eventId: EventId, userId: UserId, endpoint: string): Promise<boolean> {
    const at = this.rows.findIndex(
      (row) => row.eventId === eventId && row.userId === userId && row.endpoint === endpoint,
    )
    if (at < 0) return false
    this.rows.splice(at, 1)
    return true
  }

  async removeById(eventId: EventId, id: string): Promise<boolean> {
    const at = this.rows.findIndex((row) => row.eventId === eventId && row.id === id)
    if (at < 0) return false
    this.rows.splice(at, 1)
    return true
  }

  async listByEvent(eventId: EventId): Promise<readonly PushSubscription[]> {
    return this.rows
      .filter((row) => row.eventId === eventId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
}
