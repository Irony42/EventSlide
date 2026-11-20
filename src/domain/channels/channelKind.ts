import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The messaging channels EventSlide can take photographs from (spec 27, ADR 0015).
 *
 * Telegram is the first adapter of a generic channel: everything in `src/domain/channels/` speaks of
 * a "conversation" and a "sender", never of a Telegram chat. Adding `whatsapp` later is one more
 * value here and one more adapter, and **no schema change**: the column holding it carries no SQL
 * `CHECK` on purpose, and a stored value is parsed with `parseChannelKind` when it is read.
 */
export const CHANNEL_KINDS = ['telegram'] as const

export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export const isChannelKind = (value: unknown): value is ChannelKind =>
  typeof value === 'string' && (CHANNEL_KINDS as readonly string[]).includes(value)

/** Parse a stored or received channel name; an unknown one is a stable `channel.unknownKind`. */
export const parseChannelKind = (raw: unknown): Result<ChannelKind, DomainError> =>
  isChannelKind(raw) ? ok(raw) : err(DomainError.invalid('channel.unknownKind'))
