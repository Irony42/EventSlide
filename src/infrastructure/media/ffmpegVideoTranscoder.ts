import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  ClipContainer,
  ClipProbe,
  TranscodeSpec,
  TranscodedClip,
  VideoTranscoder,
} from '../../application/ports/videoTranscoder'
import { Dimensions } from '../../domain/photos/dimensions'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import { detectVideoContainer } from './magicBytes'
import { startProcess, type RunProcessOptions, type RunResult } from './runProcess'
import type { FfmpegPaths } from './ffmpegBinaries'

/**
 * The video pipeline: **identify, probe, re-encode, cut a poster** — and every argument
 * below is there because leaving it out is a defect somebody has already shipped.
 *
 * ## The argument list, and why each part of it
 *
 * ```
 * -nostdin -hide_banner -loglevel error -y
 * -progress pipe:1 -nostats
 * -protocol_whitelist file
 * -f <pinned demuxer>
 * -i file:<scratch in>
 * -t <cap seconds>
 * -map 0:v:0 -map 0:a:0?
 * -dn -sn -map_metadata -1 -map_chapters -1
 * -vf scale=<w>:<h>,format=yuv420p
 * -c:v libx264 -profile:v high -level 4.0 -preset veryfast -crf 23 -pix_fmt yuv420p
 * -c:a aac -b:a 128k -ac 2 -ar 48000
 * -movflags +faststart -fs <cap bytes> -f mp4 file:<scratch out>
 * ```
 *
 * - **`-pix_fmt yuv420p` *and* `format=yuv420p` at the end of the filter chain.** An
 *   iPhone in High Efficiency records 10-bit HEVC. Without both, `libx264` happily emits
 *   High 10 — which transcodes without error, passes every check this codebase can make,
 *   and renders as a black rectangle on the projector because no browser decodes it.
 * - **The scale is computed here, not written as a filter expression.** `scale=-2:720`
 *   would do the arithmetic in ffmpeg, and `scale=-1:720` produces an odd width that
 *   `yuv420p` cannot represent at all. Computing both edges in TypeScript
 *   (`Dimensions.scaleToFit().evenEdges()`) makes the number testable and keeps commas
 *   out of a filter graph, where a comma is a separator and escaping is its own trap.
 * - **`-map 0:a:0?` with the question mark.** Plenty of clips have no audio track — a
 *   muted phone, a screen recording — and without the `?` ffmpeg fails outright.
 * - **`-dn -sn` beside `-map_metadata -1`.** Stripping metadata does **not** remove
 *   streams. An iPhone writes a `mebx` timed-metadata track carrying per-frame gyroscope
 *   data and sometimes location, with a `tmcd` timecode track beside it; both survive a
 *   metadata strip, neither is visible in a player, and both would be handed out in the
 *   host's ZIP export.
 * - **Never `-c copy`.** It is roughly fifty times cheaper and it is the first
 *   optimisation anyone proposes. It is also the one that undoes the whole control:
 *   `free`, `skip` and `udta` boxes and the `moov/meta` atom survive a remux, so both a
 *   polyglot payload and the GPS of a guest's home come through intact. The stored bytes
 *   are always this pipeline's output, exactly as they are for a photograph.
 * - **`-protocol_whitelist file`, `file:` on both paths, and a pinned input demuxer.**
 *   A crafted Matroska or a playlist otherwise makes ffmpeg open network URLs on the
 *   server's behalf — SSRF, from a guest upload. Pinning `-f` also stops content
 *   sniffing from choosing a demuxer the signature check did not authorise.
 * - **`-t` and `-fs`.** The duration cap is applied to the probed header *and* here,
 *   because a header is a claim; `-fs` bounds the output size whatever the input does.
 * - **`-movflags +faststart`** rewrites the `moov` atom to the front so a browser can
 *   start playing before the file has finished downloading. It is a second pass over the
 *   finished file, so the output must be **seekable** — a pipe cannot be. An mp4 input
 *   commonly has its own `moov` at the end, so neither side can be a pipe, which is why
 *   this adapter writes scratch files at all and why every exit path removes them.
 *
 * ## The poster
 *
 * Cut from the **output**, not from the source. By then the bytes have been through the
 * pipeline once, so the frame extractor is pointed at a file this process wrote rather
 * than at a stranger's container — and the frame it produces is already upright, already
 * 8-bit, already stripped. It is taken a second in (or at the midpoint of a shorter
 * clip) rather than at zero, because the first frame of a phone recording is very often
 * black.
 */

/** Every exit path removes this. It is under MEDIA_ROOT, never `os.tmpdir()`. */
const SCRATCH_PREFIX = 'clip-'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_STALL_MS = 30_000
const PROBE_TIMEOUT_MS = 20_000

/**
 * How much of ffprobe's JSON to keep. Generous, and bounded.
 *
 * A phone's clip is a few kilobytes of it; a container with hundreds of declared streams
 * is the case this ceiling exists for, and anything past it is reported as truncated so
 * the caller refuses rather than parses half a document.
 */
const PROBE_STDOUT_BYTES = 4 * 1024 * 1024

/**
 * The bound on how far into a **guest's** container the demuxer will read looking for
 * streams. Applied to the transcode's input as well as the probe's: without it a crafted
 * header can make the encoder read the whole file before it decodes a frame, which is
 * work the timeout eventually stops rather than work anything refuses.
 */
const INPUT_SCAN_BYTES = '10000000'

/** The demuxer each signature pins the input to. Never content sniffing. */
const DEMUXER: Readonly<Record<ClipContainer, string>> = {
  mp4: 'mov,mp4,m4a,3gp,3g2,mj2',
  matroska: 'matroska,webm',
}

/**
 * ffprobe's JSON, parsed rather than trusted.
 *
 * This is stdout from a process that was pointed at a guest's file, so it is a boundary
 * input in exactly the sense CLAUDE.md means — parsed with zod like `req.body`, and not
 * because ffprobe is expected to lie but because the shape genuinely varies between
 * builds and a missing key read as `undefined` is how a duration becomes `NaN` three
 * call sites away.
 */
const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value))

const sideDataSchema = z.object({
  side_data_type: z.string().optional(),
  rotation: numeric.optional(),
})

const streamSchema = z.object({
  codec_type: z.string().optional(),
  width: numeric.optional(),
  height: numeric.optional(),
  duration: numeric.optional(),
  side_data_list: z.array(sideDataSchema).optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
})

const probeSchema = z.object({
  streams: z.array(streamSchema).default([]),
  format: z.object({ duration: numeric.optional() }).optional(),
})

type ProbedStream = z.infer<typeof streamSchema>

/**
 * The rotation the container asks a player to apply, in degrees.
 *
 * **This is CLAUDE.md trap 2 in a new costume.** `streams[].width` and `height` are
 * *pre-rotation*: a phone records 1920x1080 frames and writes a display matrix saying
 * "turn this ninety degrees". A gate written off the raw fields judges a portrait clip
 * as landscape and scales it against the wrong axis, producing a letterboxed sliver on
 * the projector.
 *
 * Two spellings, because ffprobe has moved: modern builds report a `Display Matrix` entry
 * in `side_data_list`, older ones a `rotate` tag on the stream. Both are read, and the
 * ring-3 suite asserts the result against a real clip carrying a rotation matrix rather
 * than trusting this comment.
 */
const rotationOf = (stream: ProbedStream): number => {
  const matrix = stream.side_data_list?.find((entry) => entry.rotation !== undefined)
  if (matrix?.rotation !== undefined) return Math.abs(Math.round(matrix.rotation)) % 360

  const tag = stream.tags?.['rotate']
  const parsed = Number(typeof tag === 'string' || typeof tag === 'number' ? tag : Number.NaN)
  return Number.isFinite(parsed) ? Math.abs(Math.round(parsed)) % 360 : 0
}

const isQuarterTurn = (rotation: number): boolean => rotation === 90 || rotation === 270

export interface FfmpegTranscoderOptions {
  readonly paths: FfmpegPaths
  /**
   * Where scratch files go. **Under `MEDIA_ROOT`, never `os.tmpdir()`**: `compose.yaml`
   * runs the container `read_only: true` with a small tmpfs charged to the same memory
   * cgroup as the process, so a 60 MB clip written to `/tmp` is 60 MB off the heap
   * budget — and the container has nowhere else to write.
   */
  readonly scratchRoot: string
  readonly timeoutMs?: number
  readonly stallMs?: number
}

export interface FfmpegVideoTranscoder extends VideoTranscoder {
  /**
   * Kill every child this adapter still has running.
   *
   * A container stop **orphans** a child rather than stopping it. Without this, a new
   * container starts the same job while the old ffmpeg holds a core for the rest of the
   * evening — and the old one still holds the scratch directory the new one is about to
   * write into.
   */
  close(): void
}

export const createFfmpegVideoTranscoder = ({
  paths,
  scratchRoot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stallMs = DEFAULT_STALL_MS,
}: FfmpegTranscoderOptions): FfmpegVideoTranscoder => {
  const running = new Set<{ kill: () => void }>()

  const run = async (
    binary: string,
    args: readonly string[],
    /**
     * Every bound the run needs, forwarded whole.
     *
     * It used to be `{ timeoutMs, stallMs }` only, so a caller that carefully asked for a
     * bigger stdout budget had it silently dropped here — which is how ffprobe's answer
     * ended up capped at the 8 KB tail meant for a failure's last line, and an ordinary
     * iPhone clip was answered `clip.corrupt` and destroyed.
     */
    bounds: Omit<RunProcessOptions, 'binary' | 'args'>,
  ): Promise<RunResult> => {
    const process_ = startProcess({ binary, args, ...bounds })
    running.add(process_)
    try {
      return await process_.finished
    } finally {
      running.delete(process_)
    }
  }

  /** A scratch directory of its own per call, removed on **every** exit path. */
  const withScratch = async <T>(work: (directory: string) => Promise<T>): Promise<T> => {
    await mkdir(scratchRoot, { recursive: true })
    const directory = await mkdtemp(join(scratchRoot, SCRATCH_PREFIX))
    try {
      return await work(directory)
    } finally {
      // The thing 1.0 leaked. `force` so a run that never created its output is not an
      // error, and `recursive` because the directory holds up to three files.
      await rm(directory, { recursive: true, force: true }).catch(() => {
        // A leaked scratch directory is swept with the event's media; failing a guest's
        // clip over the cleanup would be worse.
      })
    }
  }

  const probeFile = async (
    file: string,
    container: ClipContainer,
  ): Promise<Result<ClipProbe, DomainError>> => {
    const result = await run(
      paths.ffprobe,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        // No `-nostdin` here, unlike the encoder below: `ffprobe` has no such option and
        // answers `Option not found` for it, which arrives as a refusal to read any
        // header at all. It does not need one — `runProcess` gives every child
        // `stdio[0]: 'ignore'`, so there is no stdin to read in the first place.
        //
        // No protocol but the local file, and a demuxer the signature already chose.
        '-protocol_whitelist',
        'file',
        '-f',
        DEMUXER[container],
        // ffprobe is the same demuxer as ffmpeg and at its defaults partially decodes.
        // Bounded so a crafted header cannot make it read the whole file looking for a
        // stream it will never find.
        '-analyzeduration',
        INPUT_SCAN_BYTES,
        '-probesize',
        INPUT_SCAN_BYTES,
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        `file:${file}`,
      ],
      {
        timeoutMs: PROBE_TIMEOUT_MS,
        stallMs: PROBE_TIMEOUT_MS,
        // **ffprobe's stdout is the answer, not a diagnostic tail.** A four-stream
        // iPhone clip's JSON is already 7.9 KB; spatial audio or a display matrix takes
        // it past 8. The default budget is megabytes and bounded, and a document that
        // still does not fit is reported as truncated rather than parsed.
        stdoutBytes: PROBE_STDOUT_BYTES,
      },
    )

    if (!result.ok) {
      if (result.failure === 'spawnFailed') {
        return err(DomainError.unexpected('clip.transcoderUnavailable'))
      }
      if (result.failure === 'cancelled') {
        return err(DomainError.unexpected('clip.transcodeCancelled'))
      }
      if (result.failure === 'timedOut') {
        return err(DomainError.unexpected('clip.transcodeTimedOut'))
      }
      // ffprobe itself refused the file. This is the one answer here that is a verdict
      // **about the bytes**, and the only one classified permanent.
      return err(DomainError.invalid('clip.corrupt', { reason: result.stderr.slice(0, 200) }))
    }

    /**
     * A document we could not read is not a document that is malformed.
     *
     * ffprobe exited zero, so the file was fine; if the JSON does not parse, the fault
     * is ours — a budget too small, a build printing a shape this schema has not been
     * taught. Answering `clip.corrupt` here is what destroyed an ordinary iPhone clip:
     * that code is permanent, so the job went straight to `failed` on attempt one and
     * the staged source was deleted, and re-uploading deduplicated onto the terminal row
     * forever. `clip.probeUnreadable` is transient, so the worst case is three attempts
     * and a refusal the guest can act on.
     */
    if (result.stdoutTruncated) {
      return err(
        DomainError.unexpected('clip.probeUnreadable', { reason: 'the header did not fit' }),
      )
    }

    let parsed: z.infer<typeof probeSchema>
    try {
      parsed = probeSchema.parse(JSON.parse(result.stdout))
    } catch {
      return err(
        DomainError.unexpected('clip.probeUnreadable', { reason: 'ffprobe answered a shape this build does not read' }),
      )
    }

    const video = parsed.streams.find((stream) => stream.codec_type === 'video')
    if (video === undefined) return err(DomainError.invalid('clip.noVideoStream'))

    const { width, height } = video
    if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) {
      return err(DomainError.invalid('clip.corrupt', { reason: 'the video stream declares no size' }))
    }

    // Rotation applied here, once, so nothing downstream ever sees the raw fields.
    const rotated = isQuarterTurn(rotationOf(video))
    const dimensions = Dimensions.create(
      Math.round(rotated ? height : width),
      Math.round(rotated ? width : height),
    )
    if (!dimensions.ok) return err(DomainError.invalid('clip.corrupt', { reason: 'impossible size' }))

    const seconds = parsed.format?.duration ?? video.duration ?? Number.NaN

    return ok({
      container,
      // Not defaulted to zero: `ClipDuration` refuses a duration the container did not
      // declare, and a zero here would be read as a clip of no length rather than as an
      // absent claim.
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : Number.NaN,
      dimensions: dimensions.value,
      hasAudio: parsed.streams.some((stream) => stream.codec_type === 'audio'),
    })
  }

  const identify = (bytes: Uint8Array): ClipContainer | null => detectVideoContainer(bytes)

  return {
    identify,

    probe: async (bytes: Uint8Array): Promise<Result<ClipProbe, DomainError>> => {
      const container = identify(bytes)
      // The signature decides, before a process is started. An unrecognised file never
      // reaches a demuxer at all, which is the same ordering the image path uses.
      if (container === null) return err(DomainError.invalid('clip.unsupportedFormat'))

      return withScratch(async (directory) => {
        const input = join(directory, 'in.bin')
        await writeFile(input, bytes)
        return probeFile(input, container)
      })
    },

    transcode: async (
      bytes: Uint8Array,
      spec: TranscodeSpec,
    ): Promise<Result<TranscodedClip, DomainError>> => {
      const container = identify(bytes)
      if (container === null) return err(DomainError.invalid('clip.unsupportedFormat'))

      return withScratch(async (directory) => {
        const input = join(directory, 'in.bin')
        const output = join(directory, 'out.mp4')
        const poster = join(directory, 'poster.jpg')
        await writeFile(input, bytes)

        const source = await probeFile(input, container)
        if (!source.ok) return source

        const box = Dimensions.create(Dimensions.maxEdge, spec.maxHeight)
        if (!box.ok) return box
        const target = source.value.dimensions.scaleToFit(box.value).evenEdges()

        const encoded = await run(
          paths.ffmpeg,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            // Progress on stdout is what feeds the stall detector: a wall clock generous
            // enough for a real 4K clip is far too generous for a wedged decoder.
            '-progress',
            'pipe:1',
            '-nostats',
            '-protocol_whitelist',
            'file',
            '-f',
            DEMUXER[container],
            '-i',
            `file:${input}`,
            // The cap, again. The header is a claim by the file.
            '-t',
            (spec.maxDurationMs / 1000).toFixed(3),
            '-map',
            '0:v:0',
            // The `?` is load-bearing: a clip with no audio must not fail outright.
            '-map',
            '0:a:0?',
            // Data and subtitle streams: `-map_metadata` does not remove these, and an
            // iPhone's `mebx` track carries gyroscope and sometimes location data.
            '-dn',
            '-sn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-vf',
            `scale=${target.width}:${target.height},format=yuv420p`,
            '-c:v',
            'libx264',
            '-profile:v',
            'high',
            '-level',
            '4.0',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            // Both this and `format=yuv420p` above: a 10-bit HEVC source otherwise
            // produces High 10, which no browser decodes.
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
            '-ar',
            '48000',
            // Rewrites moov to the front so playback starts before the download does.
            '-movflags',
            '+faststart',
            '-fs',
            String(spec.maxOutputBytes),
            '-f',
            'mp4',
            `file:${output}`,
          ],
          { timeoutMs, stallMs },
        )

        if (!encoded.ok) {
          if (encoded.failure === 'spawnFailed') {
            return err(DomainError.unexpected('clip.transcoderUnavailable'))
          }
          if (encoded.failure === 'cancelled') {
            // Shutdown asked it to stop. Not the clip's fault, and it must not be
            // classified like one — see `RunFailure`.
            return err(DomainError.unexpected('clip.transcodeCancelled'))
          }
          if (encoded.failure === 'timedOut') {
            return err(DomainError.unexpected('clip.transcodeTimedOut'))
          }
          return err(
            DomainError.unexpected('clip.transcodeFailed', {
              reason: encoded.stderr.slice(0, 200),
            }),
          )
        }

        // Probed rather than assumed: `-t` and `-fs` both truncate, so what was stored is
        // the only honest answer — and a file that will not re-open here is one that
        // would not have played on the wall either.
        const produced = await probeFile(output, 'mp4')
        if (!produced.ok) {
          return err(DomainError.unexpected('clip.transcodeFailed', { reason: 'unreadable output' }))
        }

        const posterBox = Dimensions.create(spec.posterMaxEdge, spec.posterMaxEdge)
        if (!posterBox.ok) return posterBox
        const posterSize = produced.value.dimensions.scaleToFit(posterBox.value)

        // A second in, or the midpoint of a shorter clip: the first frame of a phone
        // recording is very often black.
        const at = Math.min(1_000, Math.max(0, Math.floor(produced.value.durationMs / 2)))

        const framed = await run(
          paths.ffmpeg,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-protocol_whitelist',
            'file',
            '-f',
            DEMUXER.mp4,
            '-ss',
            (at / 1000).toFixed(3),
            '-i',
            `file:${output}`,
            '-frames:v',
            '1',
            '-vf',
            `scale=${posterSize.width}:${posterSize.height}`,
            '-an',
            '-dn',
            '-sn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-q:v',
            '4',
            '-f',
            'image2',
            `file:${poster}`,
          ],
          { timeoutMs: PROBE_TIMEOUT_MS, stallMs: PROBE_TIMEOUT_MS },
        )
        if (!framed.ok) {
          return err(
            DomainError.unexpected('clip.transcodeFailed', {
              reason: `poster: ${framed.stderr.slice(0, 160)}`,
            }),
          )
        }

        const videoBytes = new Uint8Array(await readFile(output))
        const posterBytes = new Uint8Array(await readFile(poster))

        return ok({
          video: {
            bytes: videoBytes,
            byteSize: videoBytes.byteLength,
            dimensions: produced.value.dimensions,
            durationMs: produced.value.durationMs,
          },
          poster: {
            bytes: posterBytes,
            byteSize: posterBytes.byteLength,
            dimensions: posterSize,
          },
        })
      })
    },

    close: () => {
      for (const child of [...running]) child.kill()
    },
  }
}
