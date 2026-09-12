import type {
  ClipContainer,
  ClipProbe,
  TranscodedClip,
  VideoTranscoder,
} from '../../application/ports/videoTranscoder'
import { DomainError } from '../../domain/shared/errors'
import { err, type Result } from '../../domain/shared/result'

/**
 * The transcoder for a box with no encoder on it.
 *
 * A Null Object rather than a `null` in the container, and the difference matters at the
 * three call sites that would otherwise need a branch: the upload route, the worker, and
 * every use case in between. With this, "there is no ffmpeg here" is one refusal with one
 * code and one French sentence, decided at the boundary where everything else is decided.
 *
 * **Photo ingest is untouched by this.** That is the whole reason the capability check
 * does not fail the boot and does not fail `/api/ready`: a photo wall with no video still
 * serves the room, and taking a venue's wall out of service over a missing codec would be
 * a far worse outage than the one it reports. Readiness carries it as a detail beside
 * `mediaWritable`, so an operator can see it without an orchestrator acting on it.
 *
 * `identify` still answers honestly. Refusing to recognise an mp4 would make a clip
 * upload fail as `clip.unsupportedFormat` — "that is not a video" — when the truth is
 * that this server cannot process it, and the guest would spend the evening trying other
 * files.
 */
export const nullVideoTranscoder = (
  identifyContainer: (bytes: Uint8Array) => ClipContainer | null,
): VideoTranscoder => {
  const unavailable = <T>(): Result<T, DomainError> =>
    err(DomainError.unexpected('clip.transcoderUnavailable'))

  return {
    identify: identifyContainer,
    probe: async (): Promise<Result<ClipProbe, DomainError>> => unavailable(),
    transcode: async (): Promise<Result<TranscodedClip, DomainError>> => unavailable(),
  }
}
