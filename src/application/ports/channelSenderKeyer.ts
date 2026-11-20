/**
 * The keyed fingerprint of a messaging identity (spec 27, ADR 0015).
 *
 * `keyOf(material)` is `HMAC(key derived from the guest-token secret with the label channel-sender,
 * material)`: the same sender at the same event always gets the same key, and another one at another event (the
 * material carries the event, so rows of two events cannot be linked), and nobody holding a copy of the database can recover a Telegram account from it.
 * The material is what the domain composes (`senderKeyMaterial`: the channel, the event and the sender's reference).
 * Synchronous and pure over its secret, so a use case can call it without suspension.
 */
export interface ChannelSenderKeyer {
  keyOf(material: string): string
}
