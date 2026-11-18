import { MAX_ATTEMPTS, retryDelayMs, shouldRetry, type ClipFailureKind } from '../clips/clipFailure'

/**
 * Why a voice message's processing ended, as a **closed** list (spec 25, section 5).
 *
 * The codes are the ones `guestbook_voices.failure` stores (migration 032 pins the list against
 * this one), not the `DomainError.code` an adapter answered with: a transcoder grows a code, this
 * table is taught about it, and nothing else changes. {@link voiceFailureOf} is the one mapping
 * from the open world (`voice.*`, plus the write transaction's own codes) to the closed one.
 *
 * Like `clipFailure.ts`, the split is about **whether a second attempt could possibly answer
 * differently**: the file is the problem (permanent) or the machine was (transient). The retry
 * ladder itself is the clip's (three attempts, a short backoff), imported rather than copied: a
 * guest waiting on "En traitement" is the same person waiting on the same worker.
 */
export const VOICE_FAILURES = [
  'unsupportedFormat',
  'corrupt',
  'notAudio',
  'noAudioStream',
  'tooLong',
  'tooShort',
  'transcodeFailed',
  'timedOut',
  'storageFailed',
] as const

export type VoiceFailure = (typeof VOICE_FAILURES)[number]

export const isVoiceFailure = (value: unknown): value is VoiceFailure =>
  typeof value === 'string' && (VOICE_FAILURES as readonly string[]).includes(value)

export type VoiceFailureKind = ClipFailureKind

/** The file is the problem: the same bytes answer the same way, so a retry only burns a core. */
const PERMANENT: ReadonlySet<VoiceFailure> = new Set([
  'unsupportedFormat',
  'corrupt',
  'notAudio',
  'noAudioStream',
  'tooLong',
  'tooShort',
])

export const classifyVoiceFailure = (failure: VoiceFailure): VoiceFailureKind =>
  PERMANENT.has(failure) ? 'permanent' : 'transient'

/**
 * The adapter's `DomainError.code`s, and what each says in the closed vocabulary.
 *
 * A `Map`, because the key arrives from an adapter and a bare lookup on an object would resolve
 * `constructor` to an inherited member. **An unknown code is a transient `transcodeFailed`**: the
 * bounded worst case is three attempts, whereas defaulting to permanent would throw away a
 * guest's only recording the first time an adapter grew a code this table has not been taught.
 */
const FAILURE_BY_CODE = new Map<string, VoiceFailure>([
  ['voice.unsupportedFormat', 'unsupportedFormat'],
  ['voice.corrupt', 'corrupt'],
  ['voice.notAudio', 'notAudio'],
  ['voice.noAudioStream', 'noAudioStream'],
  ['voice.tooLong', 'tooLong'],
  ['voice.tooShort', 'tooShort'],
  ['voice.transcodeFailed', 'transcodeFailed'],
  ['voice.transcodeTimedOut', 'timedOut'],
  ['voice.storageFailed', 'storageFailed'],
  // The box had no encoder when the job ran: the machine, not the recording.
  ['voice.transcoderUnavailable', 'transcodeFailed'],
])

export const voiceFailureOf = (code: string): VoiceFailure =>
  FAILURE_BY_CODE.get(code) ?? 'transcodeFailed'

/** Three attempts, then a refusal: the ladder of a clip, so one worker keeps one rhythm. */
export const MAX_VOICE_ATTEMPTS = MAX_ATTEMPTS

export const voiceRetryDelayMs = retryDelayMs

/** A transient failure with attempts left comes back; everything else is final. */
export const shouldRetryVoice = (failure: VoiceFailure, attempts: number): boolean =>
  shouldRetry(classifyVoiceFailure(failure), attempts)
