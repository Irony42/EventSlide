import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { z } from 'zod'
import type {
  AudioTranscoder,
  TranscodeVoiceSpec,
  TranscodedVoice,
  VoiceContainer,
  VoiceProbe,
} from '../../application/ports/audioTranscoder'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import { createChildRunner } from './childRunner'
import type { FfmpegPaths } from './ffmpegBinaries'
import { durationSecondsOf, probeSchema } from './ffmpegVideoTranscoder'
import { detectAudioContainer } from './magicBytes'
import type { RunProcessOptions, RunResult } from './runProcess'

/**
 * The audio pipeline of a guestbook voice message: **identify, probe, re-encode, measure** (spec 25).
 *
 * A twin of `ffmpegVideoTranscoder`, with the same guard rails and for the same reasons; the long
 * argument for each lives there and is not repeated. What is specific to a voice is below.
 *
 * ```
 * -nostdin -hide_banner -loglevel error -y
 * -progress pipe:1 -nostats
 * -protocol_whitelist file
 * -f <pinned demuxer>
 * -analyzeduration <us> -probesize <bytes>
 * -i file:<scratch in>
 * -t <cap seconds>
 * -map 0:a:0 -vn -dn -sn -map_metadata -1 -map_chapters -1
 * -ac 1 -ar 32000 -c:a aac -b:a 48k
 * -movflags +faststart -fs <cap bytes> -f mp4 file:<scratch out>
 * ```
 *
 * - **`-map 0:a:0` without a `?`.** The video route maps its audio optionally because a clip may be
 *   silent; a recording with no sound is not a message, and the probe has already refused it with
 *   `voice.noAudioStream`, so a failure here would be a bug rather than an input.
 * - **`-vn -dn -sn` beside `-map_metadata -1 -map_chapters -1`.** The same as the clip's: stripping
 *   tags does not strip streams, and what sits under a phone's recording can be more than the
 *   voice. Never `-c copy`: the `free`, `skip`, `udta` boxes and `moov/meta` survive a remux.
 * - **Mono, 32 kHz, 48 kbit/s, AAC-LC.** A voice, not music: about 6 kB a second, so a minute is
 *   around 360 kB. Every browser and phone plays AAC in MP4, which is why it is the one stored
 *   format whatever the browser recorded (Opus in WebM or Ogg, AAC in MP4).
 * - **`-protocol_whitelist file`, `file:` on both paths and a pinned demuxer**, exactly as for a
 *   clip: a crafted container otherwise makes ffmpeg open a network URL on the server's behalf.
 * - **`-probesize` and `-analyzeduration` before `-i`**, on the probe and on the encoder. They are
 *   input options: after the input they are globals that apply to nothing.
 * - **`-t` and `-fs`.** The cap is a bound on the **output** whatever the header claims, and `-fs`
 *   bounds its size. Both truncate, so the duration is measured on the file this wrote, and its
 *   size read back from the disk (`-fs` is a ceiling applied between packets, not a hard limit).
 * - **A duration the container does not declare is not a refusal.** A `MediaRecorder` WebM has
 *   none in its header; the probe answers `null` and the encoder's output is what is measured.
 */

/** Every exit path removes this. It is under MEDIA_ROOT, never `os.tmpdir()`. */
const SCRATCH_PREFIX = 'voice-'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_STALL_MS = 30_000
const PROBE_TIMEOUT_MS = 20_000

/** ffprobe's JSON for one short file is a few kilobytes; anything past this is reported as truncated. */
const PROBE_STDOUT_BYTES = 1024 * 1024

/**
 * How far into a guest's container the demuxer reads looking for streams. Two options in two
 * units (bytes and microseconds), so two constants: see the same pair in the video adapter. A
 * voice is a few hundred kilobytes, so these are smaller than a clip's and still generous.
 */
const INPUT_PROBE_BYTES = '5000000'
const INPUT_ANALYZE_MICROSECONDS = '5000000'

/** The demuxer each signature pins the input to. Never content sniffing. */
const DEMUXER: Readonly<Record<VoiceContainer, string>> = {
  mp4: 'mov,mp4,m4a,3gp,3g2,mj2',
  matroska: 'matroska,webm',
  ogg: 'ogg',
}

export interface FfmpegAudioTranscoderOptions {
  readonly paths: FfmpegPaths
  /** Under `MEDIA_ROOT`, never `os.tmpdir()`: see `FfmpegTranscoderOptions.scratchRoot`. */
  readonly scratchRoot: string
  /** The whole environment every child gets (menace T9), never the server's own. */
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly stallMs?: number
}

export interface FfmpegAudioTranscoder extends AudioTranscoder {
  /** Kill every child this adapter still has running (a container stop orphans a child). */
  close(): void
}

export interface VoiceEncodeRequest {
  readonly ffmpegInput: string
  readonly output: string
  readonly container: VoiceContainer
  readonly spec: TranscodeVoiceSpec
}

/** The whole argument list of the re-encode, pure so a test can read it. */
export const buildVoiceEncodeArgs = (request: VoiceEncodeRequest): string[] => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  // Progress on stdout feeds the stall detector.
  '-progress',
  'pipe:1',
  '-nostats',
  '-protocol_whitelist',
  'file',
  '-f',
  DEMUXER[request.container],
  // Before `-i`, or they apply to nothing.
  '-analyzeduration',
  INPUT_ANALYZE_MICROSECONDS,
  '-probesize',
  INPUT_PROBE_BYTES,
  '-i',
  `file:${request.ffmpegInput}`,
  // The cap on the output, whatever the header claimed.
  '-t',
  (request.spec.maxDurationMs / 1000).toFixed(3),
  '-map',
  '0:a:0',
  '-vn',
  '-dn',
  '-sn',
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
  '-ac',
  '1',
  '-ar',
  '32000',
  '-c:a',
  'aac',
  '-b:a',
  '48k',
  // The `moov` atom to the front, so a player starts before the download finishes.
  '-movflags',
  '+faststart',
  '-fs',
  String(request.spec.maxOutputBytes),
  '-f',
  'mp4',
  `file:${request.output}`,
]

/** The whole argument list of the header read, pure for the same reason. */
export const buildVoiceProbeArgs = (file: string, container: VoiceContainer): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  // No `-nostdin`: ffprobe has no such option, and `runProcess` gives every child no stdin.
  '-protocol_whitelist',
  'file',
  '-f',
  DEMUXER[container],
  '-analyzeduration',
  INPUT_ANALYZE_MICROSECONDS,
  '-probesize',
  INPUT_PROBE_BYTES,
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  `file:${file}`,
]

export const createFfmpegAudioTranscoder = ({
  paths,
  scratchRoot,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stallMs = DEFAULT_STALL_MS,
}: FfmpegAudioTranscoderOptions): FfmpegAudioTranscoder => {
  const children = createChildRunner(env)

  const run = (
    binary: string,
    args: readonly string[],
    bounds: Omit<RunProcessOptions, 'binary' | 'args' | 'env'>,
  ): Promise<RunResult> => children.run(binary, args, bounds)

  /** A scratch directory of its own per call, removed on **every** exit path. */
  const withScratch = async <T>(work: (directory: string) => Promise<T>): Promise<T> => {
    await mkdir(scratchRoot, { recursive: true })
    const directory = await mkdtemp(join(scratchRoot, SCRATCH_PREFIX))
    try {
      return await work(directory)
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {
        // A leaked scratch directory is emptied at the next boot, with the whole of
        // MEDIA_ROOT/.scratch; failing a guest's message over the cleanup would be worse.
      })
    }
  }

  /**
   * `withScratch`, with the filesystem's failures inside the `Result`: the port's contract is that
   * a transcode *answers*, and `mkdtemp`, `writeFile` and `readFile` reject. `voice.storageFailed`
   * is transient, so a full disk costs an attempt and the attempt count bounds it.
   */
  const onScratch = async <T>(
    work: (directory: string) => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> => {
    try {
      return await withScratch(work)
    } catch (cause) {
      return err(
        DomainError.unexpected('voice.storageFailed', { reason: String(cause).slice(0, 160) }),
      )
    }
  }

  /** What a child's failure to run says, in this port's closed vocabulary. */
  const failureOf = (result: RunResult, otherwise: string): DomainError => {
    if (result.failure === 'spawnFailed') return DomainError.unexpected('voice.transcoderUnavailable')
    if (result.failure === 'cancelled') return DomainError.unexpected('voice.transcodeCancelled')
    if (result.failure === 'timedOut') return DomainError.unexpected('voice.transcodeTimedOut')
    return DomainError.unexpected(otherwise, { reason: result.stderr.slice(0, 200) })
  }

  const probeFile = async (
    file: string,
    container: VoiceContainer,
  ): Promise<Result<VoiceProbe, DomainError>> => {
    const result = await run(
      paths.ffprobe,
      buildVoiceProbeArgs(file, container),
      { timeoutMs: PROBE_TIMEOUT_MS, stallMs: PROBE_TIMEOUT_MS, stdoutBytes: PROBE_STDOUT_BYTES },
    )

    if (!result.ok) {
      if (result.failure === 'exited') {
        // ffprobe itself refused the file: the one verdict **about the bytes**, and permanent.
        return err(DomainError.invalid('voice.corrupt', { reason: result.stderr.slice(0, 200) }))
      }
      return err(failureOf(result, 'voice.transcodeFailed'))
    }

    // A document we could not read is not a document that is malformed: transient, for the reason
    // `clip.probeUnreadable` is. Answering `voice.corrupt` here would end a guest's only recording.
    if (result.stdoutTruncated) {
      return err(
        DomainError.unexpected('voice.probeUnreadable', { reason: 'the header did not fit' }),
      )
    }
    let parsed: z.infer<typeof probeSchema>
    try {
      parsed = probeSchema.parse(JSON.parse(result.stdout))
    } catch {
      return err(
        DomainError.unexpected('voice.probeUnreadable', {
          reason: 'ffprobe answered a shape this build does not read',
        }),
      )
    }

    // A picture in the file is not a voice message, whatever sound comes with it: this is not
    // the route of clips, and none of their ceilings would apply.
    if (parsed.streams.some((stream) => stream.codec_type === 'video')) {
      return err(DomainError.invalid('voice.notAudio'))
    }
    const audio = parsed.streams.find((stream) => stream.codec_type === 'audio')
    if (audio === undefined) return err(DomainError.invalid('voice.noAudioStream'))

    // The first duration that is a number, not the first that is present (`N/A` is `NaN`).
    // Absent is the normal case of a browser recording, and says so with `null`.
    const seconds = durationSecondsOf(parsed, audio)
    return ok({
      container,
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    })
  }

  return {
    // Only reached when the capability check found both binaries and an AAC encoder; the box with
    // nothing on it gets `nullAudioTranscoder`.
    available: () => true,

    identify: detectAudioContainer,

    probe: async (bytes: Uint8Array): Promise<Result<VoiceProbe, DomainError>> => {
      const container = detectAudioContainer(bytes)
      // The signature decides, before a process is started.
      if (container === null) return err(DomainError.invalid('voice.unsupportedFormat'))

      return onScratch(async (directory) => {
        const input = join(directory, 'in.bin')
        await writeFile(input, bytes)
        return probeFile(input, container)
      })
    },

    transcode: async (
      bytes: Uint8Array,
      spec: TranscodeVoiceSpec,
    ): Promise<Result<TranscodedVoice, DomainError>> => {
      const container = detectAudioContainer(bytes)
      if (container === null) return err(DomainError.invalid('voice.unsupportedFormat'))

      return onScratch(async (directory) => {
        const input = join(directory, 'in.bin')
        const output = join(directory, 'out.m4a')
        await writeFile(input, bytes)

        const source = await probeFile(input, container)
        if (!source.ok) return source

        const encoded = await run(
          paths.ffmpeg,
          buildVoiceEncodeArgs({ ffmpegInput: input, output, container, spec }),
          { timeoutMs, stallMs },
        )
        if (!encoded.ok) return err(failureOf(encoded, 'voice.transcodeFailed'))

        // Probed rather than assumed: `-t` and `-fs` both truncate, so what was written is the
        // only honest answer, and a file that will not re-open here would not have played.
        const produced = await probeFile(output, 'mp4')
        if (!produced.ok || produced.value.durationMs === null) {
          return err(DomainError.unexpected('voice.transcodeFailed', { reason: 'unreadable output' }))
        }
        if (produced.value.durationMs < spec.minDurationMs) {
          return err(DomainError.invalid('voice.tooShort'))
        }

        const written = new Uint8Array(await readFile(output))
        // `-fs` is a ceiling applied between packets and `+faststart` rewrites the file after, so
        // the size that matters is the one on the disk. A refusal rather than a truncation: a
        // clipped message is one that plays until it stops.
        if (written.byteLength > spec.maxOutputBytes) {
          return err(
            DomainError.unexpected('voice.transcodeFailed', {
              reason: `output overshot its ceiling: ${written.byteLength} > ${spec.maxOutputBytes}`,
            }),
          )
        }

        return ok({
          bytes: written,
          byteSize: written.byteLength,
          durationMs: produced.value.durationMs,
        })
      })
    },

    close: () => {
      children.close()
    },
  }
}
