import { createHmac } from 'node:crypto'
import type { ChannelSenderKeyer } from '../../application/ports/channelSenderKeyer'
import { deriveKey } from './primitives'

/**
 * The fingerprint of a messaging identity (spec 27, ADR 0015): HMAC-SHA256 under a key derived with HKDF from
 * `GUEST_TOKEN_SECRET`, hex encoded.
 *
 * The label is the domain separation: the same secret under another label gives a key that shares nothing, so a
 * guest cookie can never be replayed as a sender key nor the reverse, and a copy of the database holds no Telegram
 * account number (the material hashed is `channel:eventId:ref`, which an attacker without the secret cannot
 * enumerate). No new secret is needed, so no installation refuses to boot on upgrade.
 *
 * The label never changes: every guest created through a channel would stop being found.
 */
export const CHANNEL_SENDER_LABEL = 'eventslide/channel-sender/v1'

export const createHmacChannelSenderKeyer = (rootSecret: string): ChannelSenderKeyer => {
  if (rootSecret.length < 32) {
    throw new Error('the channel sender key must be derived from a secret of 32+ characters')
  }
  const key = deriveKey(rootSecret, CHANNEL_SENDER_LABEL)
  return {
    keyOf: (material) => createHmac('sha256', key).update(material, 'utf8').digest('hex'),
  }
}
