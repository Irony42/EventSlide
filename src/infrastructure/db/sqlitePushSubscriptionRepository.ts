import type { PushSubscriptionRepository } from '../../application/ports/pushSubscriptionRepository'
import { PushSubscription } from '../../domain/push/pushSubscription'
import { asEventId, asUserId, type EventId, type UserId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `push_subscriptions` (spec 30, lot 4): one row per browser, event and account. Every statement
 * names the event; a removal by the host names the account too. The cap per account and event is
 * decided inside the write transaction, so overlapping requests cannot pass it.
 */

const COLUMNS = `id, user_id, event_id, endpoint, p256dh, auth, created_at`

interface Row {
  readonly id: string
  readonly user_id: string
  readonly event_id: string
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly created_at: string
}

const toSubscription = (row: Row): PushSubscription =>
  PushSubscription.create({
    id: row.id,
    userId: asUserId(row.user_id),
    eventId: asEventId(row.event_id),
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: fromIsoText(row.created_at),
  })

export class SqlitePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: Db) {}

  async upsert(
    subscription: PushSubscription,
    maxPerUserEvent: number,
  ): Promise<'added' | 'updated' | 'tooMany'> {
    const refresh = this.db.prepare(
      `UPDATE push_subscriptions SET p256dh = ?, auth = ?, failures = 0
        WHERE endpoint = ? AND event_id = ? AND user_id = ?`,
    )
    const countMine = this.db.prepare<[string, string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM push_subscriptions WHERE event_id = ? AND user_id = ?`,
    )
    const insert = this.db.prepare(
      `INSERT INTO push_subscriptions (${COLUMNS})
            VALUES (@id, @user_id, @event_id, @endpoint, @p256dh, @auth, @created_at)`,
    )
    return this.db
      .transaction((): 'added' | 'updated' | 'tooMany' => {
        const refreshed = refresh.run(
          subscription.p256dh,
          subscription.auth,
          subscription.endpoint,
          subscription.eventId,
          subscription.userId,
        )
        if (refreshed.changes > 0) return 'updated'
        if ((countMine.get(subscription.eventId, subscription.userId)?.n ?? 0) >= maxPerUserEvent) {
          return 'tooMany'
        }
        insert.run({
          id: subscription.id,
          user_id: subscription.userId,
          event_id: subscription.eventId,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          created_at: toIsoText(subscription.createdAt),
        })
        return 'added'
      })
      .immediate()
  }

  async remove(eventId: EventId, userId: UserId, endpoint: string): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string]>(
          `DELETE FROM push_subscriptions WHERE event_id = ? AND user_id = ? AND endpoint = ?`,
        )
        .run(eventId, userId, endpoint).changes > 0
    )
  }

  async removeById(eventId: EventId, id: string): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string]>(`DELETE FROM push_subscriptions WHERE event_id = ? AND id = ?`)
        .run(eventId, id).changes > 0
    )
  }

  async recordFailure(eventId: EventId, id: string, limit: number): Promise<'kept' | 'pruned'> {
    const count = this.db.prepare<[string, string]>(
      `UPDATE push_subscriptions SET failures = failures + 1 WHERE event_id = ? AND id = ?`,
    )
    const prune = this.db.prepare<[string, string, number]>(
      `DELETE FROM push_subscriptions WHERE event_id = ? AND id = ? AND failures >= ?`,
    )
    return this.db
      .transaction((): 'kept' | 'pruned' => {
        count.run(eventId, id)
        return prune.run(eventId, id, limit).changes > 0 ? 'pruned' : 'kept'
      })
      .immediate()
  }

  async resetFailures(eventId: EventId, id: string): Promise<void> {
    this.db
      .prepare<[string, string]>(
        `UPDATE push_subscriptions SET failures = 0 WHERE event_id = ? AND id = ? AND failures > 0`,
      )
      .run(eventId, id)
  }

  async removeForMember(eventId: EventId, userId: UserId): Promise<number> {
    return this.db
      .prepare<[string, string]>(
        `DELETE FROM push_subscriptions WHERE event_id = ? AND user_id = ?`,
      )
      .run(eventId, userId).changes
  }

  async listByEvent(eventId: EventId): Promise<readonly PushSubscription[]> {
    return this.db
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM push_subscriptions WHERE event_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(eventId)
      .map(toSubscription)
  }
}
