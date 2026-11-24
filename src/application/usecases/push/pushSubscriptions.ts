import { parsePushEndpoint } from '../../../domain/push/pushEndpoint'
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER_EVENT,
  PushSubscription,
  parsePushKeys,
} from '../../../domain/push/pushSubscription'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { PushSubscriptionRepository } from '../../ports/pushSubscriptionRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { openGuestInvite } from '../guestInvites/guestInviteAccess'

/**
 * The host's browser notifications (spec 30, lot 4, Web Push): the public key a browser subscribes
 * with, and subscribing and unsubscribing **one browser for one event**.
 *
 * - **Off unless the box has VAPID keys** (`push` is `null`): the key and a subscription are
 *   `404 push.disabled`, and no request to a push service can ever be made.
 * - **A subscription is the owner's** (the replies are, and the notification says that some came in),
 *   on an event that is not archived or taken down; the endpoint is judged by the allowlist
 *   (`400 push.endpointInvalid|endpointNotAllowed`), the keys by shape (`400 push.keysInvalid`), at
 *   most ten browsers per account and event (`409 push.tooMany`). Subscribing again with the same
 *   browser refreshes its keys.
 * - **Unsubscribing is idempotent and always allowed**, even with the feature off or the event
 *   archived: it removes only this account's subscription of this browser, and says nothing of whether
 *   there was one.
 * - Nothing here logs, audits or returns the endpoint or the keys.
 */

export interface PushConfig {
  readonly publicKey: string
  readonly allowedHosts: readonly string[]
}

const disabled = (): DomainError => DomainError.notFound('push.disabled')

export type GetPushKey = () => Promise<Result<string, DomainError>>

export const makeGetPushKey =
  (push: PushConfig | null): GetPushKey =>
  async () =>
    push === null ? err(disabled()) : ok(push.publicKey)

export interface SubscribePushInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly endpoint: unknown
  readonly keys: unknown
}

export interface SubscribePushDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly subscriptions: Pick<PushSubscriptionRepository, 'upsert'>
  readonly ids: Pick<IdGenerator, 'bytes'>
  readonly clock: Clock
  readonly push: PushConfig | null
}

export type SubscribePush = (input: SubscribePushInput) => Promise<Result<void, DomainError>>

export const makeSubscribePush =
  (deps: SubscribePushDeps): SubscribePush =>
  async ({ eventId, actorId, endpoint, keys }) => {
    if (deps.push === null) return err(disabled())
    const opened = await openGuestInvite(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const judgedEndpoint = parsePushEndpoint(endpoint, deps.push.allowedHosts)
    if (!judgedEndpoint.ok) return judgedEndpoint
    const judgedKeys = parsePushKeys(keys)
    if (!judgedKeys.ok) return judgedKeys

    const stored = await deps.subscriptions.upsert(
      PushSubscription.create({
        id: Buffer.from(deps.ids.bytes(16)).toString('hex'),
        userId: actorId,
        eventId,
        endpoint: judgedEndpoint.value,
        ...judgedKeys.value,
        createdAt: deps.clock.now(),
      }),
      MAX_PUSH_SUBSCRIPTIONS_PER_USER_EVENT,
    )
    return stored === 'tooMany' ? err(DomainError.conflict('push.tooMany')) : ok(undefined)
  }

/**
 * A sign-out on a shared computer: this account's subscriptions of **this browser** are removed for
 * every event at once. Idempotent and always allowed, like the one-event removal, and it says nothing of
 * what existed. Only the caller's own rows can be reached: the account is the session's, never a value
 * a request names.
 */
export interface UnsubscribePushEverywhereInput {
  readonly actorId: UserId
  readonly endpoint: unknown
}

export interface UnsubscribePushEverywhereDeps {
  readonly subscriptions: Pick<PushSubscriptionRepository, 'removeAllForUser'>
  readonly push: PushConfig | null
}

export type UnsubscribePushEverywhere = (
  input: UnsubscribePushEverywhereInput,
) => Promise<Result<void, DomainError>>

export const makeUnsubscribePushEverywhere =
  (deps: UnsubscribePushEverywhereDeps): UnsubscribePushEverywhere =>
  async ({ actorId, endpoint }) => {
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
      return ok(undefined)
    }
    const normalised = parsePushEndpoint(endpoint, deps.push?.allowedHosts ?? [])
    await deps.subscriptions.removeAllForUser(actorId, normalised.ok ? normalised.value : endpoint)
    return ok(undefined)
  }

export interface UnsubscribePushInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly endpoint: unknown
}

export interface UnsubscribePushDeps {
  readonly subscriptions: Pick<PushSubscriptionRepository, 'remove'>
  readonly push: PushConfig | null
}

export type UnsubscribePush = (input: UnsubscribePushInput) => Promise<Result<void, DomainError>>

export const makeUnsubscribePush =
  (deps: UnsubscribePushDeps): UnsubscribePush =>
  async ({ eventId, actorId, endpoint }) => {
    // The same normalisation as the subscription's, so that what is looked up is what was stored; when
    // the address no longer passes the allowlist (the operator narrowed it, or switched the feature off)
    // the text itself is looked up, so such a subscription can still be removed. Nothing else is said.
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
      return ok(undefined)
    }
    const normalised = parsePushEndpoint(endpoint, deps.push?.allowedHosts ?? [])
    await deps.subscriptions.remove(eventId, actorId, normalised.ok ? normalised.value : endpoint)
    return ok(undefined)
  }
