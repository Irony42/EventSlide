import type { ChannelKind } from '../../domain/channels/channelKind'
import { err, ok, type Result } from '../../domain/shared/result'
import type { ChannelFailure, MessagingChannel } from '../ports/messagingChannel'

/** A text the bot said, and where. */
export interface SaidReply {
  readonly conversationRef: string
  readonly text: string
  readonly replyTo: string | undefined
}

export interface Acknowledged {
  readonly conversationRef: string
  readonly messageRef: string
}

/**
 * A messenger in memory: the files it can hand over, what the bot said and acknowledged.
 *
 * Behaves as the contract of `MessagingChannel` says: a file longer than `maxBytes` is
 * `channel.mediaTooLarge`, an unknown one is `channel.fileGone`, and a failure a test arms
 * (`failNextDownload`) is what a blinking network looks like. `reply` and `acknowledge` never reject.
 */
export class FakeMessagingChannel implements MessagingChannel {
  readonly said: SaidReply[] = []
  readonly acknowledged: Acknowledged[] = []
  /** What each download asked for, so a test can read the limit it was given. */
  readonly downloads: { readonly fileRef: string; readonly maxBytes: number }[] = []
  private readonly files = new Map<string, Uint8Array>()
  private pendingFailures: ChannelFailure[] = []

  constructor(
    readonly kind: ChannelKind = 'telegram',
    private readonly username = 'EventSlideBot',
  ) {}

  /** Whether this fake bot reads every message of a group (privacy mode off). */
  readsAll = true
  /** The conversations this fake bot is an administrator of, when it does not read everything. */
  readonly administratorOf = new Set<string>()
  private pendingSeeFailures: ChannelFailure[] = []

  readsAllMessages(): boolean {
    return this.readsAll
  }

  /** The next `canSeeMedia` fails like this. */
  failNextSeeMedia(failure: ChannelFailure): this {
    this.pendingSeeFailures.push(failure)
    return this
  }

  async canSeeMedia(conversationRef: string): Promise<Result<boolean, ChannelFailure>> {
    const failure = this.pendingSeeFailures.shift()
    if (failure !== undefined) return err(failure)
    return ok(this.readsAll || this.administratorOf.has(conversationRef))
  }

  identity(): { readonly username: string } {
    return { username: this.username }
  }

  /** Make a file available under a reference. */
  hold(fileRef: string, bytes: Uint8Array): this {
    this.files.set(fileRef, bytes)
    return this
  }

  /** The next download fails like this (one failure per call, in order). */
  failNextDownload(failure: ChannelFailure): this {
    this.pendingFailures.push(failure)
    return this
  }

  async download(
    fileRef: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Result<Uint8Array, ChannelFailure>> {
    this.downloads.push({ fileRef, maxBytes })
    const failure = this.pendingFailures.shift()
    if (failure !== undefined) return err(failure)
    if (signal.aborted) return err({ code: 'channel.downloadUnavailable', retryable: true })

    const bytes = this.files.get(fileRef)
    if (bytes === undefined) return err({ code: 'channel.fileGone', retryable: false })
    if (bytes.length > maxBytes) return err({ code: 'channel.mediaTooLarge', retryable: false })
    return ok(bytes)
  }

  async reply(conversationRef: string, text: string, replyTo?: string): Promise<void> {
    this.said.push({ conversationRef, text, replyTo })
  }

  async acknowledge(conversationRef: string, messageRef: string): Promise<void> {
    this.acknowledged.push({ conversationRef, messageRef })
  }
}
