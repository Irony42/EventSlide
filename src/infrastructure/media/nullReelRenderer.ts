import type { ReelRenderer } from '../../application/ports/reelRenderer'
import { DomainError } from '../../domain/shared/errors'
import { err } from '../../domain/shared/result'

/**
 * The reel's encoder on a box that has none (spec 08): the Null Object that stands where
 * `ffmpegReelRenderer` would, as `nullVideoTranscoder` does for clips.
 *
 * `available()` is `false`, so a request is refused with `reel.transcoderUnavailable` before
 * anything is written, and the host's panel hides the montage. A job that was queued before the
 * encoder disappeared is refused the same way and, being transient, retried a few times.
 */
export const nullReelRenderer = (): ReelRenderer => ({
  available: () => false,
  render: async () => err(DomainError.unexpected('reel.transcoderUnavailable')),
})
