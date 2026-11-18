import type { OutboxPolicy } from './outboxPolicy'
import type { OutboxSendOutcome } from './outbox'

/**
 * What the voice queue does with each answer of the server (spec 25, section 5).
 *
 * A recording is the one thing a guest cannot make again ("la mariée a dit…"), so the queue is
 * stricter than the photo's about destroying one, and it sorts every answer into **three** states
 * and not two:
 *
 * 1. **Deferred**: retried with a backoff. The network, a 429, a 5xx, a full voice queue.
 * 2. **Blocked, kept**: retrying on a timer would never help, and the bytes are still worth
 *    something. The host switched the voices off, the event stopped taking messages, a ceiling is
 *    reached. The guest is told why and may save the file to the phone or delete it; the page
 *    tries again when it is next opened or when the host's setting changes.
 * 3. **Dropped**: **only** a refusal of the content itself, which nothing will change.
 *
 * Anything this file does not name is deferred. The default is the one that keeps the recording.
 */

/** The refusals of the recording itself. Everything else is kept. */
export const VOICE_TERMINAL_CODES: ReadonlySet<string> = new Set([
  'voice.unsupportedFormat',
  'voice.notAudio',
  'voice.corrupt',
  'voice.tooLong',
  'voice.tooShort',
])

/** The refusals of the moment: the host's switch, the event's state, a ceiling. Kept, stopped. */
export const VOICE_BLOCKED_CODES: ReadonlySet<string> = new Set([
  'guestbook.voiceDisabled',
  'guestbook.disabled',
  'event.notAcceptingUploads',
  'guestbook.limitReached',
  'guestbook.eventFull',
  'guestbook.voiceEventFull',
])

/**
 * The voice queue's rules: three recordings to an event (the server's ceiling per guest, so the
 * phone never holds one the server must refuse), twelve hours, and the content refusals above.
 */
export const VOICE_POLICY: OutboxPolicy = {
  maxEntriesPerEvent: 3,
  maxAgeMs: 12 * 60 * 60 * 1_000,
  terminalCodes: VOICE_TERMINAL_CODES,
}

/** The three-state answer for a request that failed. `status` is `0` when nothing reached the server. */
export const voiceOutcomeForFailure = (status: number, code: string): OutboxSendOutcome => {
  if (status === 0) return { kind: 'deferred' }
  if (VOICE_TERMINAL_CODES.has(code)) return { kind: 'rejected', code }
  if (VOICE_BLOCKED_CODES.has(code)) return { kind: 'blocked', code }
  return { kind: 'deferred' }
}
