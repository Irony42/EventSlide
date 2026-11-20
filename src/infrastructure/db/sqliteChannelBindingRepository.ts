import type { Db } from './connection'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'
import type { ChannelBindingRepository } from '../../application/ports/channelBindingRepository'
import { ChannelBinding } from '../../domain/channels/channelBinding'
import { parseChannelKind, type ChannelKind } from '../../domain/channels/channelKind'
import {
  asChannelBindingId,
  asEventId,
  type ChannelBindingId,
  type EventId,
} from '../../domain/shared/ids'

/**
 * `ChannelBindingRepository` over SQLite (migration 033).
 *
 * `received_count` is a counter the adapter owns: the upsert never writes it, and `recordReceived`
 * increments it in one statement, so two media finishing at once cannot lose one.
 */

interface BindingRow {
  readonly id: string
  readonly event_id: string
  readonly channel: string
  readonly conversation_ref: string
  readonly conversation_title: string
  readonly bound_at: string
  readonly unbound_at: string | null
  readonly received_count: number
}

const SELECT_BINDING = `
  SELECT id, event_id, channel, conversation_ref, conversation_title, bound_at, unbound_at,
         received_count
    FROM channel_bindings
`

/**
 * Only what can change is updated: the conversation's identifier, its title, the end of the link.
 * The event, the channel and the instant of binding are the binding's identity, and the WHERE
 * keeps a save carrying another event off the row instead of moving it.
 */
const UPSERT_BINDING = `
  INSERT INTO channel_bindings (id, event_id, channel, conversation_ref, conversation_title,
                                bound_at, unbound_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET conversation_ref   = excluded.conversation_ref,
                                 conversation_title = excluded.conversation_title,
                                 unbound_at         = excluded.unbound_at
                           WHERE channel_bindings.event_id = excluded.event_id
`

/** A stored channel the domain does not know is a corrupt row, not a user error. */
const toChannel = (raw: string): ChannelKind => {
  const parsed = parseChannelKind(raw)
  if (!parsed.ok) {
    throw new Error(
      `channel_bindings.channel holds a value the domain rejects (${parsed.error.code})`,
    )
  }
  return parsed.value
}

const toBinding = (row: BindingRow): ChannelBinding =>
  ChannelBinding.restore({
    id: asChannelBindingId(row.id),
    eventId: asEventId(row.event_id),
    channel: toChannel(row.channel),
    conversationRef: row.conversation_ref,
    conversationTitle: row.conversation_title,
    boundAt: fromIsoText(row.bound_at),
    unboundAt: fromNullableIsoText(row.unbound_at),
    receivedCount: row.received_count,
  })

const isConversationTaken = (error: unknown): boolean =>
  error instanceof Error &&
  (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
  error.message.includes('channel_bindings.conversation_ref')

export class SqliteChannelBindingRepository implements ChannelBindingRepository {
  constructor(private readonly db: Db) {}

  async findActive(channel: ChannelKind, conversationRef: string): Promise<ChannelBinding | null> {
    const row = this.db
      .prepare<[string, string], BindingRow>(
        `${SELECT_BINDING} WHERE channel = ? AND conversation_ref = ? AND unbound_at IS NULL`,
      )
      .get(channel, conversationRef)
    return row === undefined ? null : toBinding(row)
  }

  async findById(eventId: EventId, bindingId: ChannelBindingId): Promise<ChannelBinding | null> {
    const row = this.db
      .prepare<[string, string], BindingRow>(`${SELECT_BINDING} WHERE event_id = ? AND id = ?`)
      .get(eventId, bindingId)
    return row === undefined ? null : toBinding(row)
  }

  async listActiveForEvent(eventId: EventId): Promise<readonly ChannelBinding[]> {
    return this.db
      .prepare<[string], BindingRow>(
        `${SELECT_BINDING} WHERE event_id = ? AND unbound_at IS NULL ORDER BY bound_at, id`,
      )
      .all(eventId)
      .map(toBinding)
  }

  async save(binding: ChannelBinding): Promise<Result<void, DomainError>> {
    let written: { readonly changes: number }
    try {
      written = this.db
        .prepare<[string, string, string, string, string, string, string | null]>(UPSERT_BINDING)
        .run(
          binding.id,
          binding.eventId,
          binding.channel,
          binding.conversationRef,
          binding.conversationTitle,
          toIsoText(binding.boundAt),
          binding.unboundAt === null ? null : toIsoText(binding.unboundAt),
        )
    } catch (error) {
      // The partial unique index: another binding of this conversation is active.
      if (isConversationTaken(error)) return err(DomainError.conflict('channel.conversationTaken'))
      throw error
    }

    // The WHERE skipped the update: this id belongs to a binding of another event.
    if (written.changes === 0) {
      throw new Error(`channel_bindings.id ${binding.id} is already held by another event`)
    }
    return ok(undefined)
  }

  async recordReceived(bindingId: ChannelBindingId): Promise<void> {
    this.db
      .prepare<[string]>(
        `UPDATE channel_bindings SET received_count = received_count + 1 WHERE id = ?`,
      )
      .run(bindingId)
  }
}
