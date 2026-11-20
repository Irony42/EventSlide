import type { Db } from './connection'
import type { ChannelCursorStore } from '../../application/ports/channelCursorStore'
import type { ChannelKind } from '../../domain/channels/channelKind'

/** `ChannelCursorStore` over SQLite: one row per channel (migration 033). */
export class SqliteChannelCursorStore implements ChannelCursorStore {
  constructor(private readonly db: Db) {}

  async get(channel: ChannelKind): Promise<string | null> {
    const row = this.db
      .prepare<[string], { readonly cursor: string }>(
        `SELECT cursor FROM channel_cursors WHERE channel = ?`,
      )
      .get(channel)
    return row === undefined ? null : row.cursor
  }

  async set(channel: ChannelKind, cursor: string): Promise<void> {
    this.db
      .prepare<[string, string]>(
        `INSERT INTO channel_cursors (channel, cursor) VALUES (?, ?)
         ON CONFLICT (channel) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(channel, cursor)
  }
}
