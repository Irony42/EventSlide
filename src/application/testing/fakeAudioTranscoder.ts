import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import type {
  AudioTranscoder,
  TranscodeVoiceSpec,
  TranscodedVoice,
  VoiceContainer,
  VoiceProbe,
} from '../ports/audioTranscoder'

/**
 * An `AudioTranscoder` that does the arithmetic without the encoder.
 *
 * A fake and not a stub, as `FakeVideoTranscoder` is: it really bounds the output by the spec,
 * really measures the duration on what it produced (and not on the header the source claims),
 * really refuses a stray tap and a video, and really reports the size of its output, because that
 * arithmetic is what every caller depends on. The same shared contract suite runs against this
 * and against real ffmpeg.
 *
 * Its "bytes" are a JSON descriptor behind a marker, so a test writes a recording as data:
 * `fakeVoiceBytes({ audioMs: 4_000 })`. Anything else is `voice.unsupportedFormat`, which is what
 * real ffmpeg answers for a JPEG.
 */

const MARKER = 'VOICEFAKE:'

export interface FakeVoiceSource {
  /** How long the sound really is: what the output is measured from. */
  readonly audioMs: number
  /**
   * What the container's header claims. Defaults to `audioMs`; `null` is the normal case of a
   * browser recording, which declares no duration at all; a larger number is a header that lies.
   */
  readonly declaredMs?: number | null
  readonly container?: VoiceContainer
  /** The header will not parse: a recording the phone never finalised. */
  readonly corrupt?: boolean
  /** A picture and sound: a video sent to the route of voices. */
  readonly hasVideo?: boolean
  /** A container with no sound in it. */
  readonly noAudio?: boolean
  /** The encoder fails on this input, whatever its header claims. */
  readonly transcodeError?: string
  /** The file's size, padded with whitespace (which `JSON.parse` ignores) to reach it. */
  readonly byteSize?: number
}

export const fakeVoiceBytes = (source: FakeVoiceSource): Uint8Array => {
  const body = `${MARKER}${JSON.stringify(source)}`
  return new TextEncoder().encode(body.padEnd(source.byteSize ?? body.length, ' '))
}

/** Bytes that are not a recording at all, which is what a renamed PDF is. */
export const notARecording = (): Uint8Array => new TextEncoder().encode('%PDF-1.7 not a voice')

const parse = (bytes: Uint8Array): FakeVoiceSource | null => {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith(MARKER)) return null
  try {
    return JSON.parse(text.slice(MARKER.length)) as FakeVoiceSource
  } catch {
    return null
  }
}

/** Roughly 48 kbit/s mono, so a ten-second recording is about 60 kB. */
const BYTES_PER_MS = 6

export class FakeAudioTranscoder implements AudioTranscoder {
  /** Every call, in order, so a test can prove the pipeline probes before it encodes. */
  readonly calls: string[] = []

  /** The spec of the last `transcode`, so a test can prove the bounds reached the encoder. */
  lastSpec: TranscodeVoiceSpec | null = null

  private unavailableReason: string | null = null

  /** Models a box with no ffmpeg: every call is refused with the Null Object adapter's code. */
  unavailable(): this {
    this.unavailableReason = 'voice.transcoderUnavailable'
    return this
  }

  available(): boolean {
    return this.unavailableReason === null
  }

  identify(bytes: Uint8Array): VoiceContainer | null {
    this.calls.push('identify')
    const source = parse(bytes)
    return source === null ? null : (source.container ?? 'mp4')
  }

  async probe(bytes: Uint8Array): Promise<Result<VoiceProbe, DomainError>> {
    this.calls.push('probe')
    const source = this.read(bytes)
    if (!source.ok) return source
    return ok({
      container: source.value.container ?? 'mp4',
      durationMs:
        source.value.declaredMs === undefined ? source.value.audioMs : source.value.declaredMs,
    })
  }

  async transcode(
    bytes: Uint8Array,
    spec: TranscodeVoiceSpec,
  ): Promise<Result<TranscodedVoice, DomainError>> {
    this.calls.push('transcode')
    this.lastSpec = spec
    const source = this.read(bytes)
    if (!source.ok) return source
    if (source.value.transcodeError !== undefined) {
      return err(DomainError.unexpected(source.value.transcodeError))
    }

    // Bounded by the spec, as `-t` bounds the encoder, and measured on the output: the header is
    // a claim by the file and is never what is stored.
    const durationMs = Math.min(source.value.audioMs, spec.maxDurationMs)
    if (durationMs < spec.minDurationMs) return err(DomainError.invalid('voice.tooShort'))

    const size = Math.min(spec.maxOutputBytes, Math.max(1, Math.round(durationMs * BYTES_PER_MS)))
    const output = fakeVoiceBytes({ audioMs: durationMs, container: 'mp4', byteSize: size })
    return ok({ bytes: output, byteSize: output.length, durationMs })
  }

  /** The refusals both entry points share, in the order real ffmpeg reaches them. */
  private read(bytes: Uint8Array): Result<FakeVoiceSource, DomainError> {
    if (this.unavailableReason !== null) return err(DomainError.unexpected(this.unavailableReason))
    const source = parse(bytes)
    if (source === null) return err(DomainError.invalid('voice.unsupportedFormat'))
    if (source.corrupt === true) return err(DomainError.invalid('voice.corrupt'))
    if (source.hasVideo === true) return err(DomainError.invalid('voice.notAudio'))
    if (source.noAudio === true) return err(DomainError.invalid('voice.noAudioStream'))
    return ok(source)
  }
}
