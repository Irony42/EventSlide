import { DomainError } from '../shared/errors'
import { allowsAnotherEntry, guestbookRefusalFor, type GuestbookRefusal } from './guestbookLimits'

/**
 * The ceilings on voice messages, as arithmetic over plain numbers (spec 25, rules 3, 6 and 7).
 *
 * A voice counts **inside** the three per guest and the 500 open per event (one rule, "three
 * lines", not a second bucket) and has one ceiling of its own on top: 200 open voices per event,
 * because 200 minutes of listening is already what a host will do and every message is a file.
 * Like every ceiling here it is decided **twice** with the same function, by the use case against
 * counts it read (a cheap early refusal) and inside the repository's write transaction.
 *
 * **A `failed` voice counts nowhere**, in none of the three numbers: the repositories' counts
 * leave it out (`countsAgainstVoiceLimits`), so three failures of a file the transcoder refuses do
 * not close the door on the guest, text or voice.
 */

export const MAX_VOICE_PER_EVENT = 200

/** Waiting or being worked on, across the box (a voice is a few hundred milliseconds of ffmpeg). */
export const MAX_QUEUED_VOICES = 40
/** The same backpressure scoped to one event, so one wedding cannot fill every slot. */
export const MAX_QUEUED_VOICES_PER_EVENT = 20

/** How long a failed voice stays to be told to its guest before the reaper deletes it: a day. */
export const VOICE_FAILED_RETENTION_MS = 24 * 60 * 60 * 1000

/** Below this a recording is a stray tap, not a message (`voice.tooShort`). */
export const VOICE_MIN_MS = 1_000

/** What an admission is refused for, in the order it is asked: the text ceilings, then `voiceFull`. */
export type VoiceRefusal = GuestbookRefusal | 'voiceFull'

/**
 * The decision, from the three counts. `voiceFull` comes **after** `eventFull`: an event whose
 * whole book is full says so, and says "voices" only when it is the voices that are.
 */
export const voiceRefusalFor = (counts: {
  readonly heldByGuest: number
  readonly openInEvent: number
  readonly voicesInEvent: number
}): VoiceRefusal | null => {
  const text = guestbookRefusalFor(counts)
  if (text !== null) return text
  if (!allowsAnotherEntry(MAX_VOICE_PER_EVENT, counts.voicesInEvent)) return 'voiceFull'
  return null
}

export const admitsAnotherVoice = (depth: number, maxDepth: number): boolean => depth < maxDepth

/** About a second of the worker per recording; never advise a wait long enough to lose the guest. */
const MAX_RETRY_AFTER_SECONDS = 60

export const voiceRetryAfterSecondsFor = (depth: number): number =>
  Math.max(1, Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(depth)))

/** A `429`, never the quota's `413`: it clears in a minute, and the guest should simply wait. */
export const voiceQueueFull = (depth: number, maxDepth: number): DomainError =>
  DomainError.rateLimited('voice.queueFull', {
    depth,
    maxDepth,
    retryAfterSeconds: voiceRetryAfterSecondsFor(depth),
  })
