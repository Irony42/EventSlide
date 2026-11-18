import type { Caption } from '../photos/caption'
import type { ContentHash } from '../photos/contentHash'
import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { canTransitionVoice, type VoiceState } from './guestbookVoiceState'
import {
  MAX_VOICE_ATTEMPTS,
  shouldRetryVoice,
  voiceFailureOf,
  voiceRetryDelayMs,
  type VoiceFailure,
} from './voiceFailure'

/**
 * The recording behind a voice message of the guestbook (spec 25).
 *
 * **A voice message is a `GuestbookEntry` that carries one of these**: the entry holds what
 * moderation sees (status, reviewer, `takenDownAt`), this holds what processing does (the state,
 * the digests, the measured duration). The two axes are never mixed. The entry's `text` is `null`
 * and the guest's optional line is {@link GuestbookVoiceProps.caption}, 140 characters.
 *
 * Immutable like `ClipJob`: every transition returns a new instance, time arrives as a parameter.
 *
 * ## What `ready` means
 *
 * A message is listenable, decidable and archivable **only** `ready`, and `ready` is the one state
 * that carries the output: its hash, its size and its duration, all three or none
 * (migration 032 has the same rule as a `CHECK`). The duration is the one **measured on the
 * output**; nothing the phone sent is ever stored as a duration.
 */

/** What the worker hands back for a recording it has transcoded. */
export interface VoiceOutput {
  readonly hash: ContentHash
  readonly byteSize: number
  readonly durationMs: number
}

export interface NewGuestbookVoice {
  readonly sourceHash: ContentHash
  readonly sourceByteSize: number
  readonly caption: Caption | null
}

export interface GuestbookVoiceProps {
  readonly state: VoiceState
  /** The digest of what the guest uploaded: it dedupes a retry, and is never what is served. */
  readonly sourceHash: ContentHash
  readonly sourceByteSize: number
  /** The guest's optional line, the text a host who cannot listen reads instead. */
  readonly caption: Caption | null
  readonly audioHash: ContentHash | null
  readonly audioByteSize: number | null
  readonly durationMs: number | null
  /** How many times the worker has claimed it. Incremented at the claim, so a crash counts. */
  readonly attempts: number
  readonly failure: VoiceFailure | null
  /** When it joined the queue, or, after a transient failure, when it may be claimed again. */
  readonly queuedAt: Date
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
}

const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0

export class GuestbookVoice {
  private constructor(private readonly props: GuestbookVoiceProps) {}

  /**
   * A **reservation**: the row that is written before the bytes are. Not claimable (the source
   * may not be on the disk yet) and charged to the event's quota from this instant.
   */
  static create(input: NewGuestbookVoice, now: Date): Result<GuestbookVoice, DomainError> {
    if (!positiveInteger(input.sourceByteSize)) {
      // Charged to the quota the instant the row exists: a size that is not a positive whole
      // number would charge the event nothing at all.
      return err(DomainError.invalid('voice.sourceByteSizeInvalid'))
    }
    return ok(
      new GuestbookVoice({
        state: 'reserved',
        sourceHash: input.sourceHash,
        sourceByteSize: input.sourceByteSize,
        caption: input.caption,
        audioHash: null,
        audioByteSize: null,
        durationMs: null,
        attempts: 0,
        failure: null,
        queuedAt: now,
        startedAt: null,
        finishedAt: null,
      }),
    )
  }

  /** Rebuild what a repository read back, with no rule re-judged. */
  static restore(props: GuestbookVoiceProps): GuestbookVoice {
    return new GuestbookVoice(props)
  }

  get state(): VoiceState {
    return this.props.state
  }
  get sourceHash(): ContentHash {
    return this.props.sourceHash
  }
  get sourceByteSize(): number {
    return this.props.sourceByteSize
  }
  get caption(): Caption | null {
    return this.props.caption
  }
  get audioHash(): ContentHash | null {
    return this.props.audioHash
  }
  get audioByteSize(): number | null {
    return this.props.audioByteSize
  }
  get durationMs(): number | null {
    return this.props.durationMs
  }
  get attempts(): number {
    return this.props.attempts
  }
  get failure(): VoiceFailure | null {
    return this.props.failure
  }
  get queuedAt(): Date {
    return this.props.queuedAt
  }
  get startedAt(): Date | null {
    return this.props.startedAt
  }
  get finishedAt(): Date | null {
    return this.props.finishedAt
  }

  /** Listenable, decidable and archivable: only a `ready` voice. */
  isReady(): boolean {
    return this.props.state === 'ready'
  }

  /**
   * What a `ready` voice holds: its output, or `null` for any other state. One answer instead of
   * `isReady()` and three nullable getters, so a reader of the file (the archive, the removal of its
   * bytes) has the hash, the size and the measured duration or nothing, and no branch for a
   * `ready` voice that lacks one (migration 032 refuses that row).
   */
  output(): VoiceOutput | null {
    const { state, audioHash, audioByteSize, durationMs } = this.props
    if (state !== 'ready' || audioHash === null || audioByteSize === null || durationMs === null) {
      return null
    }
    return { hash: audioHash, byteSize: audioByteSize, durationMs }
  }

  /** Claimable now: queued, and past its backoff. */
  isDue(now: Date): boolean {
    return this.props.state === 'queued' && this.props.queuedAt.getTime() <= now.getTime()
  }

  /**
   * The bytes are on the disk. Now the worker may have it: the only move a reservation can make.
   *
   * **Throws rather than answering a `Result`**, like `ClipJob.ready`: its one caller runs right
   * after `create`, so a refusal is a programming error and nothing an upload could report.
   */
  queue(now: Date): GuestbookVoice {
    const queued = this.moveTo('queued', { queuedAt: now })
    if (!queued.ok) throw new Error('a voice that is not a reservation cannot be queued')
    return queued.value
  }

  /** The worker takes it. `attempts` counts here, so a recording that kills the process counts. */
  start(now: Date): Result<GuestbookVoice, DomainError> {
    return this.moveTo('running', { attempts: this.props.attempts + 1, startedAt: now })
  }

  /**
   * Processing produced the file. Refuses an output with no size or no duration: a `ready` voice
   * that cannot say how long it is would be listenable and unmeasurable, and the database refuses
   * it too (the `CHECK` of migration 032).
   */
  finish(output: VoiceOutput, now: Date): Result<GuestbookVoice, DomainError> {
    if (!positiveInteger(output.byteSize) || !positiveInteger(output.durationMs)) {
      return err(DomainError.invalid('voice.outputInvalid'))
    }
    return this.moveTo('ready', {
      audioHash: output.hash,
      audioByteSize: output.byteSize,
      durationMs: output.durationMs,
      failure: null,
      finishedAt: now,
    })
  }

  /**
   * The attempt did not produce a file. Whether it comes back is the closed table's decision
   * (`voiceFailureOf`, then the ladder): a permanent failure or an exhausted ladder is `failed`,
   * a transient one with attempts left goes back to `queued` after a short backoff.
   */
  fail(code: string, now: Date): Result<GuestbookVoice, DomainError> {
    const failure = voiceFailureOf(code)
    if (!shouldRetryVoice(failure, this.props.attempts)) {
      return this.moveTo('failed', { failure, finishedAt: now })
    }
    return this.moveTo('queued', {
      failure,
      queuedAt: new Date(now.getTime() + voiceRetryDelayMs(this.props.attempts)),
    })
  }

  /**
   * Crash recovery, run at startup on every voice still `running`: the process that held it is
   * gone, so it goes back on the queue at once (the guest has waited once), unless it has spent
   * its attempts, which ends it rather than handing a poison recording to the next boot.
   */
  retry(now: Date): Result<GuestbookVoice, DomainError> {
    if (this.props.attempts >= MAX_VOICE_ATTEMPTS) {
      return this.moveTo('failed', { failure: 'transcodeFailed', finishedAt: now })
    }
    return this.moveTo('queued', { queuedAt: now })
  }

  toProps(): GuestbookVoiceProps {
    return this.props
  }

  /** The single gate for every state change, as `Photo.transitionTo` is for a photo. */
  private moveTo(
    next: VoiceState,
    changes: Partial<GuestbookVoiceProps>,
  ): Result<GuestbookVoice, DomainError> {
    if (!canTransitionVoice(this.props.state, next)) {
      return err(
        DomainError.conflict('guestbookVoice.illegalTransition', {
          from: this.props.state,
          to: next,
        }),
      )
    }
    return ok(new GuestbookVoice({ ...this.props, ...changes, state: next }))
  }
}
