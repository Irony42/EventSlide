import type {
  AudioTranscoder,
  TranscodedVoice,
  VoiceContainer,
  VoiceProbe,
} from '../../application/ports/audioTranscoder'
import { DomainError } from '../../domain/shared/errors'
import { err, type Result } from '../../domain/shared/result'

/**
 * The audio transcoder for a box with no encoder on it (spec 25).
 *
 * A Null Object rather than a `null` in the container, for the reason `nullVideoTranscoder` is:
 * "there is no ffmpeg here" is one refusal with one code, decided at the boundary where everything
 * else is. **A photo wall with no voice still serves the room**, so this never fails the boot or
 * `/api/ready`.
 *
 * `identify` still answers honestly: refusing to recognise an MP4 would tell a guest "that is not
 * a voice message" when the truth is that this server cannot process it.
 */
export const nullAudioTranscoder = (
  identifyContainer: (bytes: Uint8Array) => VoiceContainer | null,
): AudioTranscoder => {
  const unavailable = <T>(): Result<T, DomainError> =>
    err(DomainError.unexpected('voice.transcoderUnavailable'))

  return {
    available: () => false,
    identify: identifyContainer,
    probe: async (): Promise<Result<VoiceProbe, DomainError>> => unavailable(),
    transcode: async (): Promise<Result<TranscodedVoice, DomainError>> => unavailable(),
  }
}
