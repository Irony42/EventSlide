import type { PushOutcome, PushSender } from '../ports/pushSender'
import type { PushSubscription } from '../../domain/push/pushSubscription'

/** A `PushSender` that keeps what it was asked to send, and answers what the test scripted. */
export class RecordingPushSender implements PushSender {
  readonly sent: { readonly subscription: PushSubscription; readonly payload: string }[] = []
  /** What to answer, by subscription id; `delivered` for the others. */
  readonly outcomes = new Map<string, PushOutcome>()

  async send(subscription: PushSubscription, payload: string): Promise<PushOutcome> {
    this.sent.push({ subscription, payload })
    return this.outcomes.get(subscription.id) ?? 'delivered'
  }
}
