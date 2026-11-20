import type { ChannelInbox, InboundBatch } from '../../../application/ports/channelInbox'
import type { Logger } from '../../../application/ports/logger'
import type { ChannelFailure, MessagingChannel } from '../../../application/ports/messagingChannel'
import { err, ok, type Result } from '../../../domain/shared/result'
import { describeFailure, type TelegramApiError, type TelegramBotApi } from './telegramBotApi'
import { translateUpdate, updateIdOf } from './telegramUpdates'

/**
 * Telegram as a `MessagingChannel` (the way out) and a `ChannelInbox` (the way in), over {@link TelegramBotApi}.
 *
 * Nothing here returns or logs a URL, a token or a message from the service: a failure is a stable code, and what is
 * logged about it is a code and numbers (`describeFailure`).
 */

/** The long-poll wait Telegram is asked for (spec 27 §6). */
export const LONG_POLL_SECONDS = 30

/** The mark of "received": a thumbs up reaction on the message (spec 27, question 3). */
const RECEIVED_REACTION = '👍'

/** What a failure of Telegram means to the queue: retry a blink, give up on a file that cannot come. */
const downloadFailureOf = (error: TelegramApiError | 'tooLarge'): ChannelFailure => {
  if (error === 'tooLarge') return { code: 'channel.mediaTooLarge', retryable: false }
  if (error.fileTooBig) return { code: 'channel.mediaTooLarge', retryable: false }
  if (error.code === 'telegram.unreachable' || error.status === 429 || (error.status ?? 0) >= 500) {
    return { code: 'channel.downloadUnavailable', retryable: true }
  }
  // 400 on getFile, 404 on the file: the reference is gone and will not come back.
  return { code: 'channel.fileGone', retryable: false }
}

export interface TelegramChannelOptions {
  readonly api: TelegramBotApi
  /** The bot's own handle (`getMe`), which commands are addressed to. */
  readonly username: string
  readonly logger: Logger
  /** The bot's own account number, from `getMe`. */
  readonly botId: string
  /** `can_read_all_group_messages` from `getMe`: privacy mode is off. Cached for the life of the process. */
  readonly readsAll: boolean
}

export class TelegramMessagingChannel implements MessagingChannel {
  readonly kind = 'telegram' as const
  private readonly api: TelegramBotApi
  private readonly username: string
  private readonly logger: Logger
  private readonly botId: string
  private readonly readsAll: boolean

  constructor(options: TelegramChannelOptions) {
    this.api = options.api
    this.username = options.username
    this.logger = options.logger
    this.botId = options.botId
    this.readsAll = options.readsAll
  }

  readsAllMessages(): boolean {
    return this.readsAll
  }

  async canSeeMedia(conversationRef: string): Promise<Result<boolean, ChannelFailure>> {
    // Privacy mode off: the bot reads every message of every group. A private chat (a positive number) is always
    // visible: there is nobody else to hide from.
    if (this.readsAll || !conversationRef.startsWith('-')) return ok(true)
    const status = await this.api.getChatMemberStatus(
      conversationRef,
      this.botId,
      AbortSignal.timeout(15_000),
    )
    if (!status.ok) {
      // Not "no": the caller says nothing rather than warn on a guess.
      this.logger.warn('telegram membership check failed', describeFailure(status.error))
      return err({ code: 'channel.membershipUnknown', retryable: true })
    }
    return ok(status.value === 'administrator' || status.value === 'creator')
  }

  identity(): { readonly username: string } {
    return { username: this.username }
  }

  async download(
    fileRef: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Result<Uint8Array, ChannelFailure>> {
    const located = await this.api.getFilePath(fileRef, signal)
    if (!located.ok) return err(downloadFailureOf(located.error))
    const downloaded = await this.api.downloadFile(located.value, maxBytes, signal)
    return downloaded.ok ? ok(downloaded.value) : err(downloadFailureOf(downloaded.error))
  }

  async reply(conversationRef: string, text: string, replyTo?: string): Promise<void> {
    const sent = await this.api.sendMessage(
      conversationRef,
      text,
      replyTo,
      AbortSignal.timeout(20_000),
    )
    if (!sent.ok) this.logger.warn('telegram reply failed', describeFailure(sent.error))
  }

  async acknowledge(conversationRef: string, messageRef: string): Promise<void> {
    const marked = await this.api.setReaction(
      conversationRef,
      messageRef,
      RECEIVED_REACTION,
      AbortSignal.timeout(20_000),
    )
    // A group that muted reactions is not a failure worth a line each time.
    if (!marked.ok) this.logger.debug('telegram reaction failed', describeFailure(marked.error))
  }
}

export class TelegramInbox implements ChannelInbox {
  readonly kind = 'telegram' as const
  private readonly api: TelegramBotApi
  private readonly username: string
  private readonly pollSeconds: number

  /** The bot's number: the part of its token before the colon, which is not a secret. */
  private readonly botId: string

  constructor(options: {
    api: TelegramBotApi
    username: string
    /** Tells this bot's updates from another's: their offsets are not comparable. Never the whole token. */
    botId: string
    pollSeconds?: number
  }) {
    this.api = options.api
    this.username = options.username
    this.botId = options.botId
    this.pollSeconds = options.pollSeconds ?? LONG_POLL_SECONDS
  }

  async next(
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<Result<InboundBatch, ChannelFailure>> {
    // The cursor is `<bot number>:<offset>`. Offsets are per bot: after the token is changed to another bot's, the old
    // number would be higher than every new update and silently drop them, so a cursor of another bot is no cursor.
    const match = cursor === null ? null : /^(\d+):(\d+)$/u.exec(cursor)
    const offset = match !== null && match[1] === this.botId ? Number(match[2]) : null
    const updates = await this.api.getUpdates(offset, this.pollSeconds, signal)
    if (!updates.ok) {
      const error = updates.error
      // Two instances on one token, or a webhook set: the one failure an operator must be told about in words.
      if (error.errorCode === 409) return err({ code: 'telegram.conflict', retryable: true })
      if (error.errorCode === 429) {
        const waitMs = (error.retryAfterSeconds ?? 5) * 1000
        return err({ code: 'telegram.rateLimited', retryable: true, waitMs })
      }
      if (error.errorCode === 401 || error.status === 401) {
        return err({ code: 'telegram.unauthorized', retryable: false })
      }
      return err({ code: error.code, retryable: true })
    }

    let highest: number | null = null
    const messages = []
    for (const update of updates.value) {
      const id = updateIdOf(update)
      if (id !== null && (highest === null || id > highest)) highest = id
      const message = translateUpdate(update, this.username)
      if (message.type !== 'ignored') messages.push(message)
    }
    return ok({ messages, cursor: highest === null ? null : `${this.botId}:${highest + 1}` })
  }
}
