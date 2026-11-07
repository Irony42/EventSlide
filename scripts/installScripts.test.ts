import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What `npm ci` is allowed to run, and which copies of `minimatch` it installs.
 *
 * A plain `npm ci` used to fail on a Windows box without Visual Studio: `better-sqlite3`
 * ships a `binding.gyp` and prebuilt binaries, npm runs `node-gyp rebuild` for it anyway,
 * and the failure rolls `node_modules` back to nothing. `allowScripts` in package.json
 * says, package by package, which install steps run. npm versions that do not know the
 * key ignore it and keep the old behaviour, which is harmless where a toolchain exists
 * (CI, the Docker `deps` stage).
 *
 * The map must stay complete: a new dependency with an install step has to be answered
 * `true` or `false` by a person, not skipped or run by default without anyone reading it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Manifest {
  readonly allowScripts?: Readonly<Record<string, boolean>>
  readonly overrides?: Readonly<Record<string, unknown>>
}
interface Lockfile {
  readonly packages: Readonly<Record<string, { version?: string; hasInstallScript?: boolean }>>
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest
const lockfile = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile

/** `node_modules/a/node_modules/@s/b` -> `@s/b` */
const nameOf = (path: string): string =>
  path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)

describe('allowScripts', () => {
  it('answers, explicitly, for every locked package that declares an install step', () => {
    const declared = Object.entries(lockfile.packages)
      .filter(([, entry]) => entry.hasInstallScript === true)
      .map(([path]) => nameOf(path))
    const unanswered = [...new Set(declared)].filter(
      (name) => manifest.allowScripts?.[name] === undefined,
    )
    expect(unanswered).toEqual([])
  })

  it('keeps the install steps the app needs: ffmpeg download, esbuild check, bcrypt prebuild', () => {
    expect(manifest.allowScripts?.['ffmpeg-static']).toBe(true)
    expect(manifest.allowScripts?.['esbuild']).toBe(true)
    expect(manifest.allowScripts?.['bcrypt']).toBe(true)
  })

  it('denies the node-gyp rebuild of better-sqlite3, which loads its shipped prebuild', () => {
    expect(manifest.allowScripts?.['better-sqlite3']).toBe(false)
  })
})

describe('minimatch', () => {
  it('is installed at 11 or later everywhere, the 10.x range being the one with the ReDoS advisory', () => {
    const copies = Object.entries(lockfile.packages)
      .filter(([path]) => nameOf(path) === 'minimatch')
      .map(([path, entry]) => ({ path, major: Number((entry.version ?? '0').split('.')[0]) }))
    expect(copies.length).toBeGreaterThan(0)
    expect(copies.filter((copy) => copy.major < 11)).toEqual([])
  })

  it('is forced by a top-level override, not one scoped under a single parent', () => {
    expect(manifest.overrides?.['minimatch']).toBe('^11.0.1')
  })
})
