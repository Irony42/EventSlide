import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * How long one photo stays on the projector.
 *
 * Bounded at both ends because this value drives an unattended eight-hour run. Under
 * two seconds nobody in the room can take a photo in and the crossfades read as a
 * strobe; over ten minutes a guest who uploaded and then went back to dancing never
 * sees their own photo, which is the only reason they uploaded.
 *
 * The Ken Burns animation is *derived* from this value (see `kenBurns.ts`) instead of
 * being configured beside it: in 1.0 the two were independent settings and the shipped
 * combination — a 20s zoom against a 10s slide — made every image snap back to its
 * start scale halfway through.
 */

const MIN_MS = 2_000
const MAX_MS = 600_000

/**
 * Long enough to look at a photo and read its caption out loud, short enough that a
 * guest still sees theirs come up on a wall holding a few hundred photos.
 */
const DEFAULT_MS = 8_000

export class SlideInterval {
  private constructor(readonly ms: number) {}

  static create(ms: number): Result<SlideInterval, DomainError> {
    if (!Number.isInteger(ms)) return err(DomainError.invalid('slideInterval.notInteger'))
    if (ms < MIN_MS) return err(DomainError.invalid('slideInterval.tooShort', { min: MIN_MS }))
    if (ms > MAX_MS) return err(DomainError.invalid('slideInterval.tooLong', { max: MAX_MS }))
    return ok(new SlideInterval(ms))
  }

  static default(): SlideInterval {
    return new SlideInterval(DEFAULT_MS)
  }

  /** CSS animation and transition durations are authored in seconds. */
  get seconds(): number {
    return this.ms / 1_000
  }

  equals(other: SlideInterval): boolean {
    return this.ms === other.ms
  }

  toString(): string {
    return `${this.ms}ms`
  }

  static readonly minMs = MIN_MS
  static readonly maxMs = MAX_MS
  static readonly defaultMs = DEFAULT_MS
}
