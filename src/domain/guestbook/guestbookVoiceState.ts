/**
 * The life of one voice message's **processing**, a machine of its own beside moderation
 * (spec 25, rule 2). A voice can be `published` and `queued` at once, which is invisible
 * everywhere except in "En traitement": the two axes are never mixed.
 *
 * ```
 *   reserved ──bytes landed──► queued ──claim──► running ──finish──► ready
 *      │                          ▲                  │
 *      │                          └──retry/recover───┤
 *      │                                             └──fail (permanent)──► failed
 *      └──(never arrived: the row is deleted by the reaper)
 * ```
 *
 * `reserved` is the row before the bytes, for the clip's reason (`clipJobStatus.ts` has the
 * argument): a refusal costs zero bytes and the reservation is charged from the instant it exists.
 * `ready` and `failed` are terminal. A no-op transition is **refused**, as it is for a clip: a
 * second claim of a running voice is two workers on one output path.
 */
export const VOICE_STATES = ['reserved', 'queued', 'running', 'ready', 'failed'] as const

export type VoiceState = (typeof VOICE_STATES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<VoiceState, readonly VoiceState[]>> = {
  reserved: ['queued'],
  queued: ['running'],
  running: ['queued', 'ready', 'failed'],
  ready: [],
  failed: [],
}

export const isVoiceState = (value: unknown): value is VoiceState =>
  typeof value === 'string' && (VOICE_STATES as readonly string[]).includes(value)

export const canTransitionVoice = (from: VoiceState, to: VoiceState): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

/** The source is still on the disk, and charged: `reserved`, `queued` and `running`. */
export const holdsVoiceSource = (state: VoiceState): boolean =>
  state === 'reserved' || state === 'queued' || state === 'running'

/** Charged to the quota in some form: the source while processing, the output once `ready`. */
export const holdsVoiceBytes = (state: VoiceState): boolean => state !== 'failed'

/** A queue slot: waiting or being worked on, which is what backpressure counts. */
export const isVoiceInFlight = holdsVoiceSource

/**
 * Stops the same bytes being staged again: every state but `failed`, which is the partial unique
 * index's set. A `failed` row neither blocks a fresh attempt nor is refused one.
 */
export const blocksVoiceResend = (state: VoiceState): boolean => state !== 'failed'

/**
 * Counts toward the ceilings (the three per guest, the 500 and the 200 per event): everything but
 * `failed`. A voice the box could not process is not a message anybody holds, and trusting it to
 * count would let three failures of a file the transcoder refuses shut the door on the guest.
 */
export const countsAgainstVoiceLimits = (state: VoiceState): boolean => state !== 'failed'
