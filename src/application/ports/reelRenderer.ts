import type { DomainError } from '../../domain/shared/errors'
import type { Result } from '../../domain/shared/result'

/** What a montage is made to look like. Numbers only: no text from the evening reaches it. */
export interface ReelSpec {
  /** How long each photograph is shown. */
  readonly secondsPerPhoto: number
  /** The most the finished file may weigh; the renderer stops at it. */
  readonly maxOutputBytes: number
}

export interface RenderedReel {
  readonly bytes: Uint8Array
  readonly byteSize: number
  readonly durationMs: number
}

/**
 * Turns still photographs into one MP4 (spec 08): 1280x720, a fixed frame, the photograph fitted
 * with bars rather than cropped (a face must not be cut), a fade in and out, **no sound**, and no
 * text and no metadata.
 *
 * The input is the `display` rendition of each photograph, already re-encoded by the image
 * pipeline: no byte a guest sent reaches the encoder as it was sent. The order is the caller's.
 * The adapter makes one segment per photograph and joins them, so memory stays at one decoded
 * photograph and a failure names the segment that broke.
 */
export interface ReelRenderer {
  /** `false` when there is no encoder to run (no ffmpeg on this box). */
  available(): boolean

  render(frames: readonly Uint8Array[], spec: ReelSpec): Promise<Result<RenderedReel, DomainError>>
}
