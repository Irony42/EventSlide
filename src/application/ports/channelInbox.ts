import type { ChannelKind } from '../../domain/channels/channelKind'
import type { InboundMessage } from '../../domain/channels/inboundMessage'
import type { Result } from '../../domain/shared/result'
import type { ChannelFailure } from './messagingChannel'

/**
 * One batch of what a channel had for us, and where to resume.
 *
 * `cursor` is opaque (Telegram's next `offset`): the poller saves it **after** the messages were handled, and gives
 * it back to the next `next`. `null` means the channel had nothing and the cursor stays where it was.
 */
export interface InboundBatch {
  readonly messages: readonly InboundMessage[]
  readonly cursor: string | null
}

/**
 * The inbound half of a messaging channel (spec 27): how messages reach the application. Long polling for Telegram
 * (an outbound connection, never a webhook, so no public write endpoint exists); another channel may bring a session or
 * a webhook later behind the same shape. The outbound half is {@link MessagingChannel}.
 *
 * `next` waits (up to the channel's own long-poll timeout, or until `signal` aborts) and never carries a text that is
 * not a command: the adapter throws those words away before they become an {@link InboundMessage}.
 */
export interface ChannelInbox {
  readonly kind: ChannelKind
  next(cursor: string | null, signal: AbortSignal): Promise<Result<InboundBatch, ChannelFailure>>
}
