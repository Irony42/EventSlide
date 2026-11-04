import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { ClipDuration } from './clipDuration'

/**
 * Which part of a too-long recording the guest kept, in milliseconds from the start of
 * the bytes that were sent.
 *
 * A guest filmed forty seconds and the room takes fifteen. This is the answer to "which
 * fifteen", and it is a value object because the rule is the whole point: a trim is only
 * a trim if it is a whole range, at least a second and at most the cap, so an object that
 * exists is an object that is valid.
 *
 * **Enforced in two places, as `ClipDuration` is.** The request is judged against the
 * configured cap when it arrives, and the transcoder is still told to stop at the cap
 * (`-t`) and the output is measured again: the numbers come from a phone, and a phone is
 * a client.
 *
 * The bounds are relative to the bytes the server received. Whether the phone cut the
 * container first (and so moved the zero) is not the server's business.
 */

/**
 * An encoder writes a duration to the fraction of a second, and a player seeks to a
 * frame, not a millisecond. Half a second of slack on the end keeps "the last frame the
 * guest could see" from being refused as out of range.
 */
export const TRIM_TOLERANCE_MS = 500

/**
 * The longest source a trim is accepted on. Without a trim the source may not exceed the
 * cap at all; with one it may be as long as the byte limit lets it be, and this is the
 * sanity bound on what a header may claim — a crafted file can declare a year.
 */
export const MAX_TRIM_SOURCE_MS = 30 * 60 * 1_000

export class ClipTrim {
  private constructor(
    readonly startMs: number,
    readonly endMs: number,
  ) {}

  static create(startMs: number, endMs: number, maxMs: number): Result<ClipTrim, DomainError> {
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) {
      return err(DomainError.invalid('clip.trimInvalid'))
    }

    const lengthMs = endMs - startMs
    if (lengthMs < ClipDuration.minMs) {
      return err(DomainError.invalid('clip.tooShort', { minMs: ClipDuration.minMs, ms: lengthMs }))
    }
    if (lengthMs > maxMs) {
      return err(DomainError.invalid('clip.tooLong', { maxMs, ms: lengthMs }))
    }

    return ok(new ClipTrim(startMs, endMs))
  }

  get lengthMs(): number {
    return this.endMs - this.startMs
  }

  /**
   * Whether the range lies inside what the source declares, with the tolerance above.
   * Judged on the declared duration, which is a claim by the file — the encoder bounds
   * the output either way, so a lie costs a short clip and never a long one.
   */
  fitsWithin(declaredMs: number): boolean {
    return this.endMs <= declaredMs + TRIM_TOLERANCE_MS
  }

  equals(other: ClipTrim): boolean {
    return this.startMs === other.startMs && this.endMs === other.endMs
  }
}
