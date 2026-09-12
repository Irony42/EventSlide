import type { Dimensions } from '../../domain/photos/dimensions'
import type { DomainError } from '../../domain/shared/errors'
import type { Result } from '../../domain/shared/result'

/**
 * The video pipeline, behind a port for the same reason `ImageProcessor` is: so the use
 * case can be tested without a real encoder in the test process, and so the composition
 * root can substitute a Null Object on a box where ffmpeg is not installed.
 *
 * Shaped like `imageProcessor.ts` — `probe` then `transcode`, bytes in and bytes out —
 * and the obligations are the same three, each closing something a naive implementation
 * gets wrong:
 *
 * 1. **Re-encode, never remux.** `-c copy` is fifty times cheaper and it is the first
 *    optimisation anyone proposes. It is also wrong: `free`, `skip` and `udta` boxes and
 *    the `moov/meta` atom survive a remux, so both the polyglot and the GPS of a guest's
 *    home come through intact. The stored bytes are always this pipeline's output.
 * 2. **Strip every stream that is not the picture and the sound.** `-map_metadata -1`
 *    does not remove *streams*: an iPhone writes a `mebx` timed-metadata track carrying
 *    per-frame gyroscope data and sometimes GPS, and a `tmcd` timecode track rides along
 *    beside it. Both survive a metadata strip and neither is visible in a player.
 * 3. **Produce something a browser will actually decode.** A phone in High Efficiency
 *    mode records 10-bit HEVC; encoded without a forced 8-bit 4:2:0 pixel format,
 *    `libx264` emits High 10, which passes every check this codebase can make and shows a
 *    black rectangle on the projector.
 *
 * Rotation deserves its own line, because it is CLAUDE.md trap 2 in a new costume.
 * `ffprobe`'s `streams[].width`/`height` are **pre-rotation**; the rotation lives in a
 * display matrix in `side_data_list`. A gate written off the raw stream fields judges a
 * portrait clip as landscape and scales it against the wrong axis. {@link ClipProbe}
 * therefore promises dimensions **as displayed**, and the adapter's ring-3 suite proves
 * it against a real clip carrying a rotation matrix rather than trusting a comment.
 */

/** Containers the pipeline will open. An allow-list, pinned as the input demuxer. */
export const SUPPORTED_CLIP_CONTAINERS = ['mp4', 'matroska'] as const

export type ClipContainer = (typeof SUPPORTED_CLIP_CONTAINERS)[number]

export interface ClipProbe {
  readonly container: ClipContainer
  /**
   * From the container header. May be a lie — a truncated recording declares whatever it
   * declared before the phone died — which is why the cap is enforced here **and** as a
   * hard bound on the encoder's output.
   */
  readonly durationMs: number
  /** **As displayed**: the rotation matrix has already been applied. See the class note. */
  readonly dimensions: Dimensions
  /** `-map 0:a:0?` is optional for exactly this reason: plenty of clips have no sound. */
  readonly hasAudio: boolean
}

export interface TranscodeSpec {
  /** The projected height. Width follows the source's aspect, rounded to an even number. */
  readonly maxHeight: number
  /** Hard bound on the output's duration, whatever the source header claimed. */
  readonly maxDurationMs: number
  /** Hard bound on the output's size, so a pathological source cannot fill the disk. */
  readonly maxOutputBytes: number
  /** Longest edge of the still frame the grid and the album render. */
  readonly posterMaxEdge: number
}

export interface TranscodedVideo {
  readonly bytes: Uint8Array
  readonly byteSize: number
  readonly dimensions: Dimensions
  /** Measured on the output, not copied from the source: `-t` and `-fs` both truncate. */
  readonly durationMs: number
}

export interface TranscodedPoster {
  readonly bytes: Uint8Array
  readonly byteSize: number
  readonly dimensions: Dimensions
}

export interface TranscodedClip {
  readonly video: TranscodedVideo
  readonly poster: TranscodedPoster
}

export interface VideoTranscoder {
  /**
   * Which container these bytes are, from their signature alone — or `null`.
   *
   * **The one call on this port that is cheap**, and the only one on the request path.
   * It reads a handful of bytes and starts no process, which is what lets the upload
   * route refuse a renamed PDF before a single byte is written to the media store or a
   * row to the queue — the same ordering the photo path uses, where magic bytes decide
   * before `sharp` ever sees the file.
   *
   * It cannot be folded into {@link VideoTranscoder.probe}: `probe` runs `ffprobe`, and
   * running a subprocess per upload on the guest's request is exactly what the queue
   * exists to avoid. The two gates are cheap-then-thorough, as they are for images; only
   * the split between the request and the worker is new.
   *
   * `ftyp` sits at **offset 4**, not 0, which is why this is not a one-line addition to
   * an image signature table built for offset zero.
   */
  identify(bytes: Uint8Array): ClipContainer | null

  /**
   * Identify the container and read its header.
   *
   * Called first, and its answer is what the duration cap is applied to — before any
   * frame is decoded, exactly as the image pipeline refuses a decompression bomb from
   * its header.
   *
   * **Unlike `sharp.metadata()`, this is not a cheap header read.** `ffprobe` is the same
   * demuxer as `ffmpeg` and at its defaults it decodes enough of the stream to answer;
   * the adapter bounds it with `-probesize` and `-analyzeduration` and with a wall-clock
   * timeout. Do not reason about this call as if it were free.
   *
   * Fails with `clip.unsupportedFormat` when the bytes are not a container this pipeline
   * opens, `clip.corrupt` when the header will not parse, `clip.noVideoStream` when
   * there is nothing to project, and `clip.transcoderUnavailable` when there is no
   * encoder on this box at all.
   */
  probe(bytes: Uint8Array): Promise<Result<ClipProbe, DomainError>>

  /**
   * Re-encode to a web-friendly H.264/AAC mp4, and cut a poster frame from the result.
   *
   * The poster comes from the **output**, never from the source: by then the bytes have
   * been through the pipeline once already, so the frame extractor is pointed at a file
   * this process wrote rather than at a stranger's container.
   *
   * Fails with `clip.transcodeFailed`, or `clip.transcodeTimedOut` when the encoder
   * exceeded its wall-clock budget or stopped making progress. A failure must leave
   * nothing behind — no scratch file, no orphaned child process — because the caller has
   * written nothing to the media store or the database at this point.
   */
  transcode(bytes: Uint8Array, spec: TranscodeSpec): Promise<Result<TranscodedClip, DomainError>>
}
