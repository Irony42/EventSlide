import type { ChannelKind } from '../../domain/channels/channelKind'
import type { ChannelCursorStore } from '../ports/channelCursorStore'

/** In-memory `ChannelCursorStore`. */
export class FakeChannelCursorStore implements ChannelCursorStore {
  private readonly cursors = new Map<ChannelKind, string>()

  async get(channel: ChannelKind): Promise<string | null> {
    return this.cursors.get(channel) ?? null
  }

  async set(channel: ChannelKind, cursor: string): Promise<void> {
    this.cursors.set(channel, cursor)
  }
}
