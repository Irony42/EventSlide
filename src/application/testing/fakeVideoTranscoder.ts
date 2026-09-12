import { Dimensions } from '../../domain/photos/dimensions'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import type {
  ClipContainer,
  ClipProbe,
  TranscodeSpec,
  TranscodedClip,
  VideoTranscoder,
} from '../ports/videoTranscoder'

/**
 * A `VideoTranscoder` that does the arithmetic without the encoder.
 *
 * It is a fake and not a stub: it really scales, really bounds the duration to the spec,
 * really drops to even edges, and really reports the size of what it produced — because
 * that arithmetic is what every caller downstream depends on, and a double answering a
 * canned `TranscodedClip` would let the scaling and duration rules rot unnoticed. The
 * same shared contract suite runs against this and against real ffmpeg.
 *
 * Its "bytes" are a JSON descriptor behind a marker, so a test writes a clip as data:
 * `fakeClipBytes({ width: 1080, height: 1920, durationMs: 9_000 })`. Anything else is
 * refused as `clip.unsupportedFormat`, which is what real ffmpeg answers for a JPEG.
 */

const MARKER = 'CLIPFAKE:'

export interface FakeClipSource {
  /** As displayed: a portrait clip is taller than wide, rotation already applied. */
  readonly width: number
  readonly height: number
  readonly durationMs: number
  readonly hasAudio?: boolean
  readonly container?: ClipContainer
  /** The header will not parse — a recording the phone never finalised. */
  readonly corrupt?: boolean
  /** Sound and no picture. There is nothing to project. */
  readonly noVideo?: boolean
  /** The encoder fails on this input, whatever its header claims. */
  readonly transcodeError?: string
  /**
   * How large the file is. Padded with whitespace to reach it, which `JSON.parse`
   * ignores — so a test can make a clip cost a specific number of quota bytes.
   */
  readonly byteSize?: number
}

export const fakeClipBytes = (source: FakeClipSource): Uint8Array => {
  const body = `${MARKER}${JSON.stringify(source)}`
  const target = source.byteSize ?? body.length
  return new TextEncoder().encode(body.padEnd(target, ' '))
}

/** Bytes that are not a clip at all, which is what a screenshot of a PDF is. */
export const notAClip = (): Uint8Array => new TextEncoder().encode('%PDF-1.7 not a clip')

const parse = (bytes: Uint8Array): FakeClipSource | null => {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith(MARKER)) return null
  try {
    return JSON.parse(text.slice(MARKER.length)) as FakeClipSource
  } catch {
    return null
  }
}

/** Roughly a 320 kbit/s clip, so a ten-second fixture is about 400 kB. */
const DEFAULT_BYTES_PER_MS = 40

export class FakeVideoTranscoder implements VideoTranscoder {
  /** Every call, in order, so a test can prove the pipeline probes before it encodes. */
  readonly calls: string[] = []

  private unavailableReason: string | null = null

  /**
   * Models a box with no ffmpeg on it. Every call is refused with the code the Null
   * Object adapter answers with, so a use-case test and production agree on the wording.
   */
  unavailable(): this {
    this.unavailableReason = 'clip.transcoderUnavailable'
    return this
  }

  identify(bytes: Uint8Array): ClipContainer | null {
    this.calls.push('identify')
    const source = parse(bytes)
    if (source === null) return null
    return source.container ?? 'mp4'
  }

  async probe(bytes: Uint8Array): Promise<Result<ClipProbe, DomainError>> {
    this.calls.push('probe')

    const refusal = this.refuse(bytes)
    if (refusal !== null) return refusal

    const source = parse(bytes)
    if (source === null) return err(DomainError.invalid('clip.unsupportedFormat'))

    const dimensions = Dimensions.create(source.width, source.height)
    if (!dimensions.ok) return dimensions

    return ok({
      container: source.container ?? 'mp4',
      durationMs: source.durationMs,
      dimensions: dimensions.value,
      hasAudio: source.hasAudio ?? true,
    })
  }

  async transcode(
    bytes: Uint8Array,
    spec: TranscodeSpec,
  ): Promise<Result<TranscodedClip, DomainError>> {
    this.calls.push('transcode')

    const refusal = this.refuse(bytes)
    if (refusal !== null) return refusal

    const source = parse(bytes)
    if (source === null) return err(DomainError.invalid('clip.unsupportedFormat'))
    if (source.transcodeError !== undefined) {
      return err(DomainError.unexpected(source.transcodeError))
    }

    const sourceSize = Dimensions.create(source.width, source.height)
    if (!sourceSize.ok) return sourceSize

    // Only the height constrains, exactly as `scale=-2:<height>` does.
    const videoBox = Dimensions.create(Dimensions.maxEdge, spec.maxHeight)
    if (!videoBox.ok) return videoBox
    const videoSize = sourceSize.value.scaleToFit(videoBox.value).evenEdges()

    const posterBox = Dimensions.create(spec.posterMaxEdge, spec.posterMaxEdge)
    if (!posterBox.ok) return posterBox
    const posterSize = videoSize.scaleToFit(posterBox.value)

    // Bounded by the spec, exactly as `-t` bounds the encoder: a source header is a
    // claim by the file and may be a lie.
    const durationMs = Math.min(source.durationMs, spec.maxDurationMs)
    const byteSize = Math.min(
      spec.maxOutputBytes,
      Math.max(1, Math.round(durationMs * DEFAULT_BYTES_PER_MS)),
    )

    const videoBytes = fakeClipBytes({
      width: videoSize.width,
      height: videoSize.height,
      durationMs,
      hasAudio: source.hasAudio ?? true,
      byteSize,
    })
    const posterBytes = new TextEncoder().encode(`POSTER:${posterSize.toString()}`)

    return ok({
      video: {
        bytes: videoBytes,
        byteSize: videoBytes.length,
        dimensions: videoSize,
        durationMs,
      },
      poster: {
        bytes: posterBytes,
        byteSize: posterBytes.length,
        dimensions: posterSize,
      },
    })
  }

  /** The refusals both entry points share, in the order real ffmpeg reaches them. */
  private refuse(bytes: Uint8Array): Result<never, DomainError> | null {
    if (this.unavailableReason !== null) {
      return err(DomainError.unexpected(this.unavailableReason))
    }
    const source = parse(bytes)
    if (source === null) return null
    if (source.corrupt === true) return err(DomainError.invalid('clip.corrupt'))
    if (source.noVideo === true) return err(DomainError.invalid('clip.noVideoStream'))
    return null
  }
}
