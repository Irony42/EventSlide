import type { DomainError } from '../../domain/shared/errors'
import type { Result } from '../../domain/shared/result'

/**
 * The audio pipeline of a guestbook voice message, behind a port for the reason `VideoTranscoder`
 * is one: so a use case can be tested without a real encoder, and so the composition root can
 * substitute a Null Object on a box where ffmpeg is not installed (spec 25).
 *
 * **A twin of `VideoTranscoder`, not a flag on it.** The video pipeline cannot open a file that
 * is sound and nothing else (`probe` answers `clip.noVideoStream`, and its demuxer table has no
 * Ogg, which is what desktop Firefox records), and the two answer different questions for
 * different pipelines. The codes are closed and carry the `voice.` prefix.
 *
 * The obligations are the video port's, each closing something a naive adapter gets wrong:
 *
 * 1. **Re-encode, never remux.** `-c copy` keeps the `free`, `skip` and `udta` boxes and the
 *    `moov/meta` atom, and what sits under a phone's recording can be more than the voice. The
 *    stored bytes are always this pipeline's output, in one format: AAC-LC mono in an MP4
 *    container (`audio/mp4`, `.m4a`).
 * 2. **Strip every stream and tag that is not the sound.** A recording carries no data, subtitle,
 *    chapter or cover stream out of here, and no metadata.
 * 3. **A duration is measured on the output, never copied.** A `MediaRecorder` WebM usually has no
 *    duration in its container at all, so an absent one is the normal case and **not a refusal**
 *    ({@link VoiceProbe.durationMs} is `null` then); the output is bounded by the spec and
 *    measured. What the header says is a claim by the file, and may be a lie.
 */

/** Containers the pipeline will open: an allow-list, pinned as the input demuxer. */
export const SUPPORTED_VOICE_CONTAINERS = ['mp4', 'matroska', 'ogg'] as const

export type VoiceContainer = (typeof SUPPORTED_VOICE_CONTAINERS)[number]

export interface VoiceProbe {
  readonly container: VoiceContainer
  /**
   * From the container's header, in milliseconds, or `null` when it carries none. May be a lie
   * (a truncated recording declares whatever it declared before the phone died), which is why
   * the cap is enforced here **and** as a hard bound on the output.
   */
  readonly durationMs: number | null
}

export interface TranscodeVoiceSpec {
  /** Hard bound on the output's duration, whatever the source header claimed (`-t`). */
  readonly maxDurationMs: number
  /** An output shorter than this is `voice.tooShort`: a stray tap is not a message. */
  readonly minDurationMs: number
  /** Hard bound on the output's size, so a pathological source cannot fill the disk (`-fs`). */
  readonly maxOutputBytes: number
}

export interface TranscodedVoice {
  readonly bytes: Uint8Array
  readonly byteSize: number
  /** **Measured on the output**, not copied from the source: `-t` and `-fs` both truncate. */
  readonly durationMs: number
}

export interface AudioTranscoder {
  /**
   * Whether this deployment can transcode audio at all: is there an encoder on this box.
   *
   * Decided once at boot and answered from a boolean, so it can be asked on the request path.
   * Unlike a clip, which refuses too late, a voice upload is **not offered** when this is false
   * (`voice.available` is false and the button is absent), and a request that arrives anyway is
   * refused before any byte is written (`voice.transcoderUnavailable`).
   */
  available(): boolean

  /**
   * Which container these bytes are, from their signature alone, or `null`.
   *
   * **The one cheap call on this port**, the only one on the request path: it reads a handful of
   * bytes and starts no process, which is what lets the upload refuse a renamed PDF before a byte
   * reaches the media store or a row the queue. The application layer cannot import the
   * signature table (it is infrastructure), so it asks here, as it asks `VideoTranscoder.identify`.
   */
  identify(bytes: Uint8Array): VoiceContainer | null

  /**
   * Identify the container and read its header, with `ffprobe` bounded by `-probesize`,
   * `-analyzeduration` and a wall-clock timeout (not a free call).
   *
   * Fails with `voice.unsupportedFormat` when the bytes are not a container this pipeline opens,
   * `voice.corrupt` when the header will not parse, `voice.notAudio` when the file carries a
   * **video** stream (this is not the route of clips), `voice.noAudioStream` when there is nothing
   * to hear, and `voice.transcoderUnavailable` when there is no encoder on this box.
   */
  probe(bytes: Uint8Array): Promise<Result<VoiceProbe, DomainError>>

  /**
   * Re-encode to AAC mono in MP4, bounded by the spec.
   *
   * Fails with the probe's codes, `voice.tooShort` when the output is shorter than the spec's
   * floor, `voice.transcodeFailed`, or `voice.transcodeTimedOut` when the encoder exceeded its
   * budget or stopped making progress. A failure must leave nothing behind (no scratch file, no
   * orphaned child process): the caller has written nothing to the store or the database yet.
   */
  transcode(
    bytes: Uint8Array,
    spec: TranscodeVoiceSpec,
  ): Promise<Result<TranscodedVoice, DomainError>>
}
