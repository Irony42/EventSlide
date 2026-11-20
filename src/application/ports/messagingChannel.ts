import type { ChannelKind } from '../../domain/channels/channelKind'
import type { Result } from '../../domain/shared/result'

/**
 * Why the channel could not hand a file over, in terms the queue can act on and nothing else.
 *
 * `retryable` is the whole point: a network that blinked is tried again later (the file reference of a
 * messenger stays valid), a file that is gone or too heavy is not. `code` is a stable machine string
 * (`channel.downloadUnavailable`, `channel.fileGone`, `channel.mediaTooLarge`); it never carries a URL,
 * a token or a message from the remote service, because the credential of a bot sits in every address.
 */
export interface ChannelFailure {
  readonly code: string
  readonly retryable: boolean
}

/**
 * One messenger's way of talking back: the outbound half of a channel (spec 27, ADR 0015). The inbound
 * half (`ChannelInbox`) is the poller's business.
 *
 * **`reply` and `acknowledge` are best effort and never reject.** A group that muted the bot, a chat the
 * bot was removed from or a network that blinked must not fail the photograph that was already stored; the
 * adapter says what went wrong in its own log, without the credential.
 */
export interface MessagingChannel {
  readonly kind: ChannelKind

  /** The bot's own handle, which the commands are addressed to (`/soiree@Handle`). */
  identity(): { readonly username: string }

  /**
   * The bytes of a file, **at most `maxBytes` of them**: a longer one is `channel.mediaTooLarge` and stops
   * downloading at the limit, so a lie about the declared size costs the limit and not the file.
   */
  download(
    fileRef: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Result<Uint8Array, ChannelFailure>>

  /** Plain text into a conversation, as a reply to a message when `replyTo` is given. */
  reply(conversationRef: string, text: string, replyTo?: string): Promise<void>

  /** The discreet "received" mark on a message (a reaction on Telegram). */
  acknowledge(conversationRef: string, messageRef: string): Promise<void>
}
