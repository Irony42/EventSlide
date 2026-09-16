import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

// A test file, where the ban on reading `process.env` is off: production takes this from
// env.ts as configuration, and what is under test here is the resolution that consumes it.
const MACHINE = { path: process.env['PATH'] ?? '', extensions: process.env['PATHEXT'] ?? '' }

const NOWHERE = { path: '', extensions: '' }

/**
 * Both bundled-binary fallbacks turned off.
 *
 * **An empty `PATH` is only half of "there is nothing on this box".** `ffmpeg-static` and
 * `ffprobe-static` are devDependencies, so whether the fallback finds one is a property of
 * the machine — and the two are installed on CI and were absent from the worktree these
 * tests were written in. Two assertions about absence therefore described the developer's
 * `node_modules` rather than the product, and CI read them as failures.
 *
 * Every case about absence names these instead, so what it asserts is the same everywhere.
 */
const NO_PACKAGES = { ffmpeg: 'no-such-package', ffprobe: 'no-such-package' }

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

  it('answers with nothing in a pruned image, never with some other executable', () => {
    // **The production question a red CI raised.** A reason string carrying the path to
    // the node executable looked, for a moment, like a resolver that could hand back
    // something which is not ffmpeg — it was the test's own override, but the claim is
    // worth a test rather than a reading. `npm prune --omit=dev` takes both static
    // packages, so a pruned image with no `FFMPEG_PATH` and no apt ffmpeg is exactly
    // this: an unresolvable package name and a search path full of other binaries.
    //
    // The `PATH` search only ever joins the name it was asked for, so a directory
    // holding node, npm and npx yields nothing for `ffmpeg`. The Null Object transcoder
    // and the readiness detail follow from that null, and the room keeps its photographs.
    const resolved = resolveBinary('ffmpeg', 'no-such-package', undefined, {
      path: NODE_DIR,
      extensions: MACHINE.extensions,
    })

    expect(resolved.path).toBeNull()
    expect(resolved.reason).toContain('not found on PATH')
  })

  it('ignores a package that is not installed rather than failing to load', () => {
    // `ffmpeg-static` is a devDependency and `npm prune --omit=dev` removes it, so the
    // production container genuinely does not have it. Resolving it through a `require`
    // in a `try` is what keeps this module loadable there.
    expect(resolveBinary('ffmpeg', 'no-such-package-at-all', undefined, NOWHERE).path).toBeNull()
  })

  describe('the bundled-binary fallback', () => {
    /**
     * The two packages export their path differently — `ffmpeg-static` default-exports
     * the string, `ffprobe-static` exports `{ path }` — and both shapes were handled on
     * the strength of their READMEs, by a branch nothing exercised: the only test naming
     * a package named one that does not exist. A module written here stands in for each,
     * so the branch is pinned without the suite depending on a devDependency being
     * installed, which is precisely the coupling that turned CI red.
     */
    let directory: string

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'eventslide-ffmpeg-'))
    })

    afterAll(async () => {
      await rm(directory, { recursive: true, force: true })
    })

    it('takes the path a package default-exports, as ffmpeg-static does', async () => {
      const module = join(directory, 'default-export.js')
      await writeFile(module, `module.exports = ${JSON.stringify(NODE)}\n`)

      expect(sameFile(resolveBinary('ffmpeg', module, undefined, NOWHERE).path, NODE)).toBe(true)
    })

    it('takes the path a package exports as { path }, as ffprobe-static does', async () => {
      const module = join(directory, 'path-property.json')
      await writeFile(module, JSON.stringify({ path: NODE }))

      expect(sameFile(resolveBinary('ffprobe', module, undefined, NOWHERE).path, NODE)).toBe(true)
    })

    it('ignores a package whose path is not executable, rather than trusting it', async () => {
      // A half-extracted install: the package is there and names a binary its postinstall
      // never downloaded. Falling through to `PATH` is the honest answer, and reporting
      // the miss is what an operator needs to see.
      const module = join(directory, 'missing-binary.json')
      await writeFile(module, JSON.stringify({ path: join(directory, 'not-here') }))

      const resolved = resolveBinary('ffmpeg', module, undefined, NOWHERE)

      expect(resolved.path).toBeNull()
      expect(resolved.reason).toContain('not found on PATH')
    })
  })
})

describe('probeFfmpegCapability', () => {
  it('reports what is missing when there is no encoder on the box', async () => {
    const capability = await probeFfmpegCapability({ search: NOWHERE, packages: NO_PACKAGES })

    expect(capability.available).toBe(false)
    expect(!capability.available && capability.reason).toContain('ffmpeg')
  })

  it('reports the missing half when ffprobe is absent', async () => {
    // Half an installation is a real state: an operator who copied one binary across.
    const capability = await probeFfmpegCapability({
      ffmpegPath: NODE,
      search: NOWHERE,
      packages: NO_PACKAGES,
    })

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
    //
    // **The one case here that is allowed to see the machine**, and it is written to be
    // true of any of them: an answer either way is a pass, and what it pins is the shape
    // of the answer. That is why every case about absence overrides both sources instead
    // — an assertion that depends on what happens to be installed is a report about a
    // laptop, which is how two of these came to disagree with CI.
    const capability = await probeFfmpegCapability({ search: MACHINE })

    if (!capability.available) {
      expect(capability.reason).toMatch(/ffmpeg|ffprobe|encoder/)
      return
    }
    expect(capability.paths.ffmpeg.length).toBeGreaterThan(0)
    expect(capability.paths.ffprobe.length).toBeGreaterThan(0)
  }, 30_000)
})
