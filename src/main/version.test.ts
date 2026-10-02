import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appVersion, findPackageVersion } from './version'

/**
 * Ring 3 (real directories). The product has one version, and it is the one in
 * `package.json`: `/api/health`, `/api/about`, the backup manifest and the default source
 * link all read it from here instead of carrying a constant of their own (roadmap
 * G1-04 / P1-05, finding A-04).
 *
 * The walk exists because the same module runs from four depths. Under `tsx` it is
 * `src/main`; the server build puts it at `dist/server/main`; the operator commands are
 * compiled with `rootDir: '.'`, so it lands at `dist/ops/src/main`; and in the image
 * `package.json` sits beside `dist/`. A relative `../..` is right for exactly one of them.
 *
 * The temp trees below reproduce those depths with a manifest whose version nothing else
 * in the repository has, so a hit cannot be the real `package.json` by coincidence.
 */

const A_VERSION = '9.8.7'

const manifest = (name: string, version?: string): string =>
  JSON.stringify(version === undefined ? { name } : { name, version })

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eventslide-version-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A directory (and the ones above it) inside the temp root. */
const dirAt = (...segments: string[]): string => {
  const path = join(root, ...segments)
  mkdirSync(path, { recursive: true })
  return path
}

const writeManifest = (dir: string, contents: string): void =>
  writeFileSync(join(dir, 'package.json'), contents)

describe('findPackageVersion', () => {
  it('finds the manifest from the depth tsx runs at, src/main', () => {
    writeManifest(root, manifest('eventslide', A_VERSION))

    expect(findPackageVersion(dirAt('src', 'main'))).toBe(A_VERSION)
  })

  it('finds it from the server build, dist/server/main', () => {
    writeManifest(root, manifest('eventslide', A_VERSION))

    expect(findPackageVersion(dirAt('dist', 'server', 'main'))).toBe(A_VERSION)
  })

  it('finds it from the operator build, dist/ops/src/main, which is one level deeper', () => {
    writeManifest(root, manifest('eventslide', A_VERSION))

    expect(findPackageVersion(dirAt('dist', 'ops', 'src', 'main'))).toBe(A_VERSION)
  })

  it('finds it in the image layout, where package.json sits beside dist/', () => {
    // `COPY package.json ./` into /app, with the build at /app/dist.
    writeManifest(dirAt('app'), manifest('eventslide', A_VERSION))

    expect(findPackageVersion(dirAt('app', 'dist', 'server', 'main'))).toBe(A_VERSION)
  })

  it('skips a manifest that belongs to some other package on the way up', () => {
    // A nested `package.json` is how a directory declares a module type or a workspace.
    // Taking the first one found would report that package's version as the product's.
    writeManifest(root, manifest('eventslide', A_VERSION))
    const nested = dirAt('dist', 'server')
    writeManifest(nested, manifest('not-eventslide', '0.0.1'))

    expect(findPackageVersion(dirAt('dist', 'server', 'main'))).toBe(A_VERSION)
  })

  it('skips a manifest that is not JSON, since it cannot be shown to be ours', () => {
    writeManifest(root, manifest('eventslide', A_VERSION))
    writeManifest(dirAt('dist'), '{ this is not json')

    expect(findPackageVersion(dirAt('dist', 'server', 'main'))).toBe(A_VERSION)
  })

  it('takes the nearest manifest of the product, not the outermost', () => {
    writeManifest(root, manifest('eventslide', '1.0.0'))
    const inner = dirAt('vendor', 'eventslide')
    writeManifest(inner, manifest('eventslide', A_VERSION))

    expect(findPackageVersion(dirAt('vendor', 'eventslide', 'dist'))).toBe(A_VERSION)
  })

  it('also recognises the core when it is installed as a library', () => {
    // The core may be installed as a package another program composes. Its manifest
    // carries a scoped name, and the version it reports must still be found.
    writeManifest(root, manifest('@eventslide/core', A_VERSION))

    expect(findPackageVersion(dirAt('dist', 'server', 'main'))).toBe(A_VERSION)
  })

  it('accepts a pre-release, which is a legitimate version of the product', () => {
    writeManifest(root, manifest('eventslide', '2.1.0-rc.1'))

    expect(findPackageVersion(dirAt('src', 'main'))).toBe('2.1.0-rc.1')
  })

  it('throws, naming where it started, when no manifest of the product is above', () => {
    // A silent fallback (`'0.0.0'`, `'unknown'`) would publish a wrong version on the
    // source offer, and the offer is the one place a wrong answer has legal weight.
    writeManifest(root, manifest('someone-else', '1.0.0'))
    const start = dirAt('dist', 'server', 'main')

    expect(() => findPackageVersion(start)).toThrow(start)
  })

  it.each([
    ['has no version', manifest('eventslide')],
    ['has an empty version', manifest('eventslide', '')],
    ['has a version that is not semver', manifest('eventslide', 'latest')],
    // The version is interpolated into a URL path and printed on a public endpoint.
    ['has a version that smuggles a path', manifest('eventslide', '1.0.0/../../x')],
  ])('refuses a manifest of the product that %s', (_reason, contents) => {
    writeManifest(root, contents)

    expect(() => findPackageVersion(dirAt('src', 'main'))).toThrow(/version/)
  })
})

describe('appVersion', () => {
  it('is the version in the repository package.json, from wherever this file runs', () => {
    // The integration claim: the walk, started from the real `__dirname`, lands on the
    // real manifest. Read independently here, so a wrong answer cannot agree with itself.
    const repoManifest = join(dirname(__dirname), '..', 'package.json')
    const expected: unknown = JSON.parse(readFileSync(repoManifest, 'utf8'))
    const version =
      typeof expected === 'object' && expected !== null ? Reflect.get(expected, 'version') : null

    expect(typeof version).toBe('string')
    expect(appVersion()).toBe(version)
  })

  it('answers the same value every time', () => {
    expect(appVersion()).toBe(appVersion())
  })
})
