import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFfmpegReelRenderer } from './ffmpegReelRenderer'
import { createFfmpegVideoTranscoder } from './ffmpegVideoTranscoder'

/**
 * A run started after `close()` is refused, not spawned (INFRA-03).
 *
 * The binaries are paths that do not exist. Were the run attempted, it would answer
 * `transcoderUnavailable`; a refusal because the adapter is closed answers `cancelled`,
 * and that difference is the whole assertion. No ffmpeg is needed, so this runs anywhere.
 */

const MISSING = { ffmpeg: join(tmpdir(), 'no-such-ffmpeg'), ffprobe: join(tmpdir(), 'no-such-ffprobe') }

// An ISO base media `ftyp` box: enough for the signature check that precedes any process.
const MP4_HEADER = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d,
  0x6d, 0x70, 0x34, 0x31,
])

describe('an ffmpeg adapter that has been closed', () => {
  let scratchRoot: string

  beforeEach(async () => {
    scratchRoot = await mkdtemp(join(tmpdir(), 'eventslide-closed-'))
  })

  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true })
  })

  it('answers a transcoder probe as cancelled instead of starting ffprobe', async () => {
    const transcoder = createFfmpegVideoTranscoder({ paths: MISSING, scratchRoot, env: {} })
    transcoder.close()

    const probed = await transcoder.probe(MP4_HEADER)

    expect(!probed.ok && probed.error.code).toBe('clip.transcodeCancelled')
  })

  it('answers a reel render as cancelled instead of starting ffmpeg', async () => {
    const renderer = createFfmpegReelRenderer({ paths: MISSING, scratchRoot, env: {} })
    renderer.close()
    const frame = new Uint8Array(
      await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } })
        .jpeg()
        .toBuffer(),
    )

    const made = await renderer.render([frame], { secondsPerPhoto: 1, maxOutputBytes: 1_000_000 })

    expect(!made.ok && made.error.code).toBe('reel.cancelled')
  })

  it('still answers unavailable, not cancelled, while open and the binary is missing', async () => {
    const transcoder = createFfmpegVideoTranscoder({ paths: MISSING, scratchRoot, env: {} })

    const probed = await transcoder.probe(MP4_HEADER)

    expect(!probed.ok && probed.error.code).toBe('clip.transcoderUnavailable')
  })
})
