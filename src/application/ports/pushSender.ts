import type { PushSubscription } from '../../domain/push/pushSubscription'

/**
 * What came of one message to one browser:
 *
 * - `delivered`: the push service took it (2xx);
 * - `gone`: that subscription can never work again and is removed: the push service said `404` or
 *   `410`, the browser's keys are not a valid key, or the endpoint is no longer one the box may call;
 * - `failed`: not delivered, and the subscription is kept (a timeout, a refusal that is the operator's
 *   to look at such as a rejected VAPID signature, a service that answered 5xx, a redirect).
 */
export type PushOutcome = 'delivered' | 'gone' | 'failed'

/**
 * Sends one encrypted message (spec 30, lot 4). **Never throws**, and never says anything of the
 * endpoint or the keys in what it returns: the adapter makes the first request this box sends to an
 * address a user supplied, and judges it as the security notes say (docs/SECURITY.md, Web Push).
 */
export interface PushSender {
  send(subscription: PushSubscription, payload: string): Promise<PushOutcome>
}
