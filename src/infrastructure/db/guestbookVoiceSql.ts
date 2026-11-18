import {
  VOICE_STATES,
  blocksVoiceResend,
  countsAgainstVoiceLimits,
  holdsVoiceBytes,
  holdsVoiceSource,
} from '../../domain/guestbook/guestbookVoiceState'

/**
 * The state sets of a voice message, rendered once, from the domain predicates that define them
 * (the counterpart of `clipJobStatusSql.ts`, for the same reason: a rule with six spellings drifts
 * silently, one spelling does not).
 *
 * **The migration deliberately does not use these.** Migration 032 carries frozen literals in its
 * CHECK and its partial indexes, and `migrator.test.ts` pins them against these sets.
 */

const quoted = (states: readonly string[]): string => states.map((state) => `'${state}'`).join(', ')

/** States whose source is still on the disk and charged: `reserved`, `queued`, `running`. */
export const VOICE_IN_FLIGHT_SQL = quoted(VOICE_STATES.filter(holdsVoiceSource))

/** States that are charged to the quota in some form (the source, then the output). */
export const VOICE_HOLDING_BYTES_SQL = quoted(VOICE_STATES.filter(holdsVoiceBytes))

/** States that stop the same bytes being staged again: the partial unique index's set. */
export const VOICE_BLOCKING_RESEND_SQL = quoted(VOICE_STATES.filter(blocksVoiceResend))

/** States that count toward the ceilings: everything but a failed voice. */
export const VOICE_COUNTED_SQL = quoted(VOICE_STATES.filter(countsAgainstVoiceLimits))

/**
 * What an event's voices occupy, as an SQL expression: the source while a voice is processed, the
 * **output once it is ready**, nothing for a failed one (its bytes are gone). One term of the byte
 * sum every reader shares (`eventHoldingBytesSum`); a parenthesised expression for a `SELECT` list.
 *
 * @param eventIdExpr What the event id is spelled as at the call site.
 */
export const voiceHoldingBytesSum = (eventIdExpr: string): string =>
  `(SELECT COALESCE(SUM(CASE WHEN state = 'ready' THEN audio_byte_size ELSE source_byte_size END), 0)
      FROM guestbook_voices
     WHERE event_id = ${eventIdExpr} AND state IN (${VOICE_HOLDING_BYTES_SQL}))`
