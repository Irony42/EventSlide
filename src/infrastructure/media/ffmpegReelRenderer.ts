import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReelRenderer, ReelSpec, RenderedReel } from '../../application/ports/reelRenderer'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import type { FfmpegPaths } from './ffmpegBinaries'
import { startProcess, type RunProcessOptions, type RunResult } from './runProcess'

/**
 * The highlight reel's encoder: ffmpeg, one segment per photograph, then a copy-join (spec 08).
 *
 * **Why segments.** One `filter_complex` graph over sixty inputs decodes and buffers all sixty;
 * a segment per photograph keeps one decoded picture in memory at a time, gives each step its
 * own timeout, and makes a failure name the picture that broke. The join is `-c copy`, so the
 * pictures are encoded exactly once. Encoding runs at `-threads 1`: a montage must not starve
 * the web server and the wall of a two-core box (the queue runs one job at a time as well).
 *
 * **What the file is.** 1280x720, 25 frames a second, a fixed frame (no zoom or pan), the picture
 * fitted inside it with black bars rather than cropped, a half-second fade in and out of every
 * picture, H.264 `yuv420p`, no audio stream and no metadata. No text is drawn and none is passed
 * to ffmpeg in a filter expression.
 *
 * **Hardening, as for the clip transcoder.** The executable is resolved by `ffmpegBinaries`, the
 * environment is minimal, every protocol but `file` is refused, each demuxer is named rather than
 * probed (`image2` for a still, `concat` for the join), nothing is mapped but one video stream, and
 * the output is capped (`-fs`). The input is the `display` rendition the image pipeline produced,
 * never a byte a guest sent, which makes it a smaller surface than a clip.
 *
 * **Scratch** lives under `MEDIA_ROOT/.scratch` (the container root is read-only), in a directory
 * named `reel-…` that is removed in a `finally` and swept at boot. That tree is dot-prefixed, so
 * `usedBytes`, the orphan sweep and the backup all skip it.
 */

const SCRATCH_PREFIX = 'reel-'
const WIDTH = 1280
const HEIGHT = 720
const FPS = 25
const FADE_SECONDS = 0.5

/** One picture: a few seconds of a still, so a minute is far beyond what it needs. */
const SEGMENT_TIMEOUT_MS = 60_000
const SEGMENT_STALL_MS = 30_000
/** The join copies bytes: seconds even for the largest montage. */
const JOIN_TIMEOUT_MS = 120_000
const JOIN_STALL_MS = 30_000

export interface FfmpegReelRendererOptions {
  readonly paths: FfmpegPaths
  readonly scratchRoot: string
  readonly env: Readonly<Record<string, string>>
  readonly segmentTimeoutMs?: number
  readonly joinTimeoutMs?: number
}

export interface FfmpegReelRenderer extends ReelRenderer {
  /** Kills whatever is encoding, at shutdown: the job goes back to the queue at the next boot. */
  close(): void
}

/** What the segment filter does, as one string built from numbers only. */
const segmentFilter = (seconds: number): string => {
  const fadeOutAt = Math.max(0, seconds - FADE_SECONDS)
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fade=t=in:st=0:d=${FADE_SECONDS}`,
    `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${FADE_SECONDS}`,
    'format=yuv420p',
  ].join(',')
}

const failureCodeOf = (result: RunResult): string => {
  if (result.failure === 'spawnFailed') return 'reel.transcoderUnavailable'
  if (result.failure === 'cancelled') return 'reel.cancelled'
  if (result.failure === 'timedOut') return 'reel.timedOut'
  return 'reel.renderFailed'
}

export const createFfmpegReelRenderer = ({
  paths,
  scratchRoot,
  env,
  segmentTimeoutMs = SEGMENT_TIMEOUT_MS,
  joinTimeoutMs = JOIN_TIMEOUT_MS,
}: FfmpegReelRendererOptions): FfmpegReelRenderer => {
  const running = new Set<{ kill: () => void }>()

  const run = async (
    args: readonly string[],
    bounds: Pick<RunProcessOptions, 'timeoutMs' | 'stallMs'>,
  ): Promise<RunResult> => {
    const child = startProcess({ binary: paths.ffmpeg, args, env, ...bounds })
    running.add(child)
    try {
      return await child.finished
    } finally {
      running.delete(child)
    }
  }

  const render = async (
    frames: readonly Uint8Array[],
    spec: ReelSpec,
  ): Promise<Result<RenderedReel, DomainError>> => {
    if (frames.length === 0) return err(DomainError.invalid('reel.renderFailed'))

    let directory: string
    try {
      await mkdir(scratchRoot, { recursive: true })
      directory = await mkdtemp(join(scratchRoot, SCRATCH_PREFIX))
    } catch (cause) {
      return err(DomainError.unexpected('reel.storageFailed', { reason: String(cause).slice(0, 160) }))
    }

    try {
      const segments: string[] = []
      for (const [index, frame] of frames.entries()) {
        const still = join(directory, `frame-${index}.jpg`)
        const segment = join(directory, `segment-${index}.mp4`)
        await writeFile(still, frame)

        const made = await run(
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            // A picture that will not decode ends the run at once. Looping a still it cannot read
            // would otherwise repeat the error until the timeout.
            '-xerror',
            '-y',
            '-protocol_whitelist',
            'file',
            '-f',
            'image2',
            '-loop',
            '1',
            '-framerate',
            String(FPS),
            '-i',
            `file:${still}`,
            '-t',
            String(spec.secondsPerPhoto),
            '-map',
            '0:v:0',
            '-an',
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-vf',
            segmentFilter(spec.secondsPerPhoto),
            '-r',
            String(FPS),
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '26',
            '-maxrate',
            '2500k',
            '-bufsize',
            '5000k',
            '-threads',
            '1',
            // No encoder version string in the stream: nothing identifies the machine.
            '-flags',
            '+bitexact',
            '-fflags',
            '+bitexact',
            '-pix_fmt',
            'yuv420p',
            '-f',
            'mp4',
            `file:${segment}`,
          ],
          { timeoutMs: segmentTimeoutMs, stallMs: SEGMENT_STALL_MS },
        )
        if (!made.ok) {
          return err(
            DomainError.unexpected(failureCodeOf(made), {
              segment: index,
              reason: made.stderr.slice(0, 160),
            }),
          )
        }
        segments.push(segment)
        // The picture is not needed again: a sixty-picture montage keeps one on the disk.
        await rm(still, { force: true })
      }

      // The names are ours (`segment-N.mp4` under a directory we made), so the list needs no
      // escaping beyond the quotes the format asks for.
      const list = join(directory, 'list.txt')
      await writeFile(list, segments.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'\n`).join(''))

      const output = join(directory, 'reel.mp4')
      const joined = await run(
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-protocol_whitelist',
          'file',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          `file:${list}`,
          '-map',
          '0:v:0',
          '-an',
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-c',
          'copy',
          '-fflags',
          '+bitexact',
          '-movflags',
          '+faststart',
          '-fs',
          String(spec.maxOutputBytes),
          '-f',
          'mp4',
          `file:${output}`,
        ],
        { timeoutMs: joinTimeoutMs, stallMs: JOIN_STALL_MS },
      )
      if (!joined.ok) {
        return err(
          DomainError.unexpected(failureCodeOf(joined), { reason: joined.stderr.slice(0, 160) }),
        )
      }

      const bytes = new Uint8Array(await readFile(output))
      if (bytes.byteLength === 0 || bytes.byteLength > spec.maxOutputBytes) {
        return err(
          DomainError.unexpected('reel.renderFailed', {
            reason: `output of ${bytes.byteLength} bytes against a ceiling of ${spec.maxOutputBytes}`,
          }),
        )
      }

      return ok({
        bytes,
        byteSize: bytes.byteLength,
        durationMs: frames.length * spec.secondsPerPhoto * 1000,
      })
    } catch (cause) {
      return err(DomainError.unexpected('reel.storageFailed', { reason: String(cause).slice(0, 160) }))
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {
        // Left for the boot sweep; a failed removal must not turn a finished montage into an error.
      })
    }
  }

  return {
    available: () => true,
    render,
    close: () => {
      for (const child of [...running]) child.kill()
    },
  }
}
