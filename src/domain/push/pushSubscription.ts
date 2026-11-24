import { DomainError } from '../shared/errors'
import type { EventId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'

/**
 * One browser that asked to be told when replies come in, for one event and one account (spec 30,
 * lot 4). The endpoint is a capability URL: it is never logged and never shown back.
 */

/** A host's browsers hold at most this many subscriptions per event (a laptop, a phone, a tablet...). */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER_EVENT = 10

/** A subscription whose last this many sends all failed is a dead one, and is pruned (a delivery resets the count). */
export const MAX_PUSH_FAILURES = 5

/** Browsers told per message at most: bounded, and shared out fairly between the owners. */
export const MAX_PUSH_SENDS_PER_MESSAGE = 50

/** The browser's key to encrypt to: an uncompressed P-256 point, 65 bytes, base64url. */
const P256DH_BYTES = 65
/** The browser's authentication secret: 16 bytes, base64url. */
const AUTH_BYTES = 16
const BASE64URL = /^[A-Za-z0-9_-]+$/u

/** Unpadded base64url holds `length` bytes when it has exactly the characters they take. */
const bytesOf = (raw: unknown, length: number): string | null => {
  if (typeof raw !== 'string' || !BASE64URL.test(raw)) return null
  return Math.ceil((length * 4) / 3) === raw.length ? raw : null
}

export interface PushKeys {
  readonly p256dh: string
  readonly auth: string
}

/**
 * The two keys of a subscription, by shape (their lengths, and the 0x04 of an uncompressed point):
 * `push.keysInvalid` otherwise. Whether the point is on the curve is the cipher's to say, and a
 * subscription it refuses is removed.
 */
export const parsePushKeys = (raw: unknown): Result<PushKeys, DomainError> => {
  if (typeof raw !== 'object' || raw === null) return err(DomainError.invalid('push.keysInvalid'))
  const record = raw as Record<string, unknown>
  const p256dh = bytesOf(record['p256dh'], P256DH_BYTES)
  const auth = bytesOf(record['auth'], AUTH_BYTES)
  // An uncompressed point starts with the byte 0x04, which base64url writes as a leading "B".
  if (p256dh === null || auth === null || !p256dh.startsWith('B')) {
    return err(DomainError.invalid('push.keysInvalid'))
  }
  return ok({ p256dh, auth })
}

export interface PushSubscriptionProps extends PushKeys {
  readonly id: string
  readonly userId: UserId
  readonly eventId: EventId
  readonly endpoint: string
  readonly createdAt: Date
}

export class PushSubscription {
  private constructor(private readonly props: PushSubscriptionProps) {}

  static create(props: PushSubscriptionProps): PushSubscription {
    return new PushSubscription(props)
  }

  get id(): string {
    return this.props.id
  }
  get userId(): UserId {
    return this.props.userId
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get endpoint(): string {
    return this.props.endpoint
  }
  get p256dh(): string {
    return this.props.p256dh
  }
  get auth(): string {
    return this.props.auth
  }
  get createdAt(): Date {
    return this.props.createdAt
  }

  /** The same subscription with the keys the browser gave this time (it renewed them). */
  withKeys(p256dh: string, auth: string): PushSubscription {
    return new PushSubscription({ ...this.props, p256dh, auth })
  }
}

/**
 * Which subscriptions a message goes to when there are more than `cap`: shared out **round-robin
 * between the accounts** (the one who subscribed first goes first in each round), the **newest browser
 * first** within an account, so that one account holding ten browsers cannot starve the others, and
 * a later subscription is not left out for ever behind earlier ones.
 */
export const selectForDelivery = (
  subscriptions: readonly PushSubscription[],
  cap: number,
): readonly PushSubscription[] => {
  const queues = new Map<UserId, PushSubscription[]>()
  for (const subscription of subscriptions) {
    const queue = queues.get(subscription.userId) ?? []
    queue.push(subscription)
    queues.set(subscription.userId, queue)
  }
  const lines = [...queues.values()].map((queue) =>
    [...queue].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  )
  const picked: PushSubscription[] = []
  for (let round = 0; picked.length < cap; round += 1) {
    const before = picked.length
    for (const line of lines) {
      const next = line[round]
      if (next !== undefined && picked.length < cap) picked.push(next)
    }
    if (picked.length === before) break
  }
  return picked
}
