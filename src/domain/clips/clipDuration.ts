import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * How long a clip runs, in milliseconds.
 *
 * The cap is the whole reason this is a value object rather than a number. A clip is
 * projected in a room between two photographs: at five seconds it reads as a moment, at
 * ninety it is a film nobody asked to watch and the wall has stopped being a wall. It is
 * also the resource control — transcoding cost is linear in duration, and one worker
 * drains the queue for every event on the box.
 *
 * **Enforced twice, deliberately.** This refuses a source whose container declares more
 * than the cap, and the transcoder is separately told to stop at the cap (`-t`), because
 * a container's declared duration is a claim by the file and a truncated or hand-written
 * header can lie about it — or omit it. Refusing here is what stops the work; bounding
 * the output is what makes a lie harmless.
 *
 * The floor is one second and is **not** the roadmap's "5 to 15". Five is the shape of
 * the feature a host is told about; refusing a guest's four-second clip *after* they
 * filmed it, uploaded it over venue Wi-Fi and waited for the queue would be a worse
 * product than showing it. What the floor is for is the near-empty container — a mis-tap
 * that recorded eleven frames — which is not a clip and would flash past on the wall.
 */

const MIN_MS = 1_000

export class ClipDuration {
  private constructor(readonly ms: number) {}

  /**
   * `maxMs` is configuration (`MAX_CLIP_SECONDS`), passed in rather than read here: the
   * domain owns the rule, the deployment owns the number.
   */
  static create(rawMs: number, maxMs: number): Result<ClipDuration, DomainError> {
    if (!Number.isFinite(rawMs) || rawMs <= 0) {
      // ffprobe reports duration as absent, `N/A` or a negative number for a container
      // whose header was never finalised — a phone that ran out of battery mid-record.
      return err(DomainError.invalid('clip.durationUnknown'))
    }

    const ms = Math.round(rawMs)
    if (ms < MIN_MS) return err(DomainError.invalid('clip.tooShort', { minMs: MIN_MS, ms }))
    if (ms > maxMs) return err(DomainError.invalid('clip.tooLong', { maxMs, ms }))

    return ok(new ClipDuration(ms))
  }

  /** Rounded up: a 5.4 s clip is "6 s" to a guest, never "5". */
  get seconds(): number {
    return Math.ceil(this.ms / 1_000)
  }

  equals(other: ClipDuration): boolean {
    return this.ms === other.ms
  }

  static readonly minMs = MIN_MS
}
