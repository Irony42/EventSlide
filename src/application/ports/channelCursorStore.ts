import type { ChannelKind } from '../../domain/channels/channelKind'

/**
 * Where a channel's inbox stood: Telegram's `offset` of `getUpdates`, as an opaque string.
 *
 * Saved **after** the messages it covers were handled, so a crash replays them rather than loses them,
 * and the unique job per message makes the replay harmless.
 */
export interface ChannelCursorStore {
  /** `null` before the first message was ever handled. */
  get(channel: ChannelKind): Promise<string | null>
  set(channel: ChannelKind, cursor: string): Promise<void>
}
