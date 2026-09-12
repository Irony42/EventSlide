import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeFfmpegCapability, resolveBinary } from './ffmpegBinaries'

/**
 * Finding the encoder, and deciding whether it can do the job.
 *
 * The cases that matter are the refusals: a configured path that is wrong must not fall
 * back to something else, and a box with no encoder must say so rather than fail at the
 * first guest's upload.
 *
 * `process.execPath` stands in for a real binary throughout — it exists on every machine
 * this suite runs on, and what is being tested is the resolution, not ffmpeg.
 */

/** Compared case-insensitively where the filesystem is: PATHEXT is upper case. */
const NODE = process.execPath
const sameFile = (left: string | null, right: string): boolean =>
  left !== null && left.toLowerCase() === right.toLowerCase()
const NODE_DIR = dirname(NODE)

// A test file, where  is off: production takes this from env.ts as
// configuration, and what is under test here is the resolution that consumes it.
const MACHINE = { path: process.env['PATH'] ?? '', extensions: process.env['PATHEXT'] ?? '' }

const NOWHERE = { path: '', extensions: '' }

describe('resolveBinary', () => {
  it('takes a configured path that exists', () => {
    expect(resolveBinary('ffmpeg', 'ffmpeg-static', NODE, NOWHERE).path).toBe(NODE)
  })

  it('refuses a configured path that does not, rather than looking elsewhere', () => {
    // An operator who set this wanted *that* build. Quietly encoding with another one is
    // how a deployment ends up using something nobody chose.
    const resolved = resolveBinary('ffmpeg', 'ffmpeg-static', '/no/such/ffmpeg', MACHINE)

    expect(resolved.path).toBeNull()
    expect(resolved.reason).toContain('/no/such/ffmpeg')
  })

  it('treats an empty configured value as no configuration at all', () => {
    // `compose.yaml` renders an unset variable as `""`, which is the ordinary case.
    const resolved = resolveBinary('node', 'no-such-package', '', { path: NODE_DIR, extensions: MACHINE.extensions })

    expect(sameFile(resolved.path, NODE)).toBe(true)
  })

  it('finds a binary on the search path when nothing is configured', () => {
    const resolved = resolveBinary('node', 'no-such-package', undefined, {
      path: NODE_DIR,
      extensions: MACHINE.extensions,
    })

    expect(sameFile(resolved.path, NODE)).toBe(true)
  })

  it('says plainly when there is nothing anywhere', () => {
    const resolved = resolveBinary('ffmpeg', 'no-such-package', undefined, NOWHERE)

    expect(resolved.path).toBeNull()
    expect(resolved.reason).toContain('not found on PATH')
  })

  it('ignores a package that is not installed rather than failing to load', () => {
    // `ffmpeg-static` is a devDependency and `npm prune --omit=dev` removes it, so the
    // production container genuinely does not have it. Resolving it through a `require`
    // in a `try` is what keeps this module loadable there.
    expect(resolveBinary('ffmpeg', 'no-such-package-at-all', undefined, NOWHERE).path).toBeNull()
  })
})

describe('probeFfmpegCapability', () => {
  it('reports what is missing when there is no encoder on the box', async () => {
    const capability = await probeFfmpegCapability({ search: NOWHERE })

    expect(capability.available).toBe(false)
    expect(!capability.available && capability.reason).toContain('ffmpeg')
  })

  it('reports the missing half when ffprobe is absent', async () => {
    // Half an installation is a real state: an operator who copied one binary across.
    const capability = await probeFfmpegCapability({ ffmpegPath: NODE, search: NOWHERE })

    expect(!capability.available && capability.reason).toContain('ffprobe')
  })

  it('refuses a binary that cannot list its encoders', async () => {
    const capability = await probeFfmpegCapability({
      ffmpegPath: NODE,
      ffprobePath: NODE,
      search: NOWHERE,
    })

    expect(capability.available).toBe(false)
  })

  it('asks what the build can do, never how new it is', async () => {
    // A distribution's patched build reports its own version, and a build compiled
    // without the non-free encoders reports a perfectly modern one right up until the
    // first transcode fails. The question is the encoder list.
    const capability = await probeFfmpegCapability({ search: MACHINE })

    if (!capability.available) {
      expect(capability.reason).toMatch(/ffmpeg|ffprobe|encoder/)
      return
    }
    expect(capability.paths.ffmpeg.length).toBeGreaterThan(0)
    expect(capability.paths.ffprobe.length).toBeGreaterThan(0)
  }, 30_000)
})
