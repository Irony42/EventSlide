import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDefines } from '../web/buildInfo'
import { loadConfig, resolveSourceUrl } from '../src/infrastructure/config/env'

/**
 * The two copies of "where is this build's source by default" agree (roadmap G1-04).
 *
 * The footer shows `__SOURCE_URL__` from its first paint, injected at build time by
 * `web/buildInfo.ts`; the server answers `GET /api/about` with `resolveSourceUrl`, which is
 * what replaces it a moment later. They are one rule written twice, because the web app
 * may not import the server and a config file is not worth a package — and a rule written
 * twice is a rule that drifts: a guest would see one address flash and another settle in,
 * and for a deployment that sets nothing the two should never differ at all.
 *
 * Compared over every shape the input can take rather than over one example, which is how
 * two copies of a string template come to disagree on the case nobody tried.
 */

const VERSION = '7.8.9'

/** What the server resolves for a box configured with exactly `SOURCE_REF=ref` (or none). */
const serverSays = (ref: string | undefined): string =>
  resolveSourceUrl(
    VERSION,
    loadConfig({ NODE_ENV: 'development', ...(ref === undefined ? {} : { SOURCE_REF: ref }) })
      .source,
  )

/** What the bundle is built with: the JSON-encoded constant, decoded. */
const bundleSays = (ref: string | undefined): string => {
  const encoded = buildDefines(VERSION, ref).__SOURCE_URL__
  const decoded: unknown = JSON.parse(encoded)
  if (typeof decoded !== 'string') throw new Error('__SOURCE_URL__ is not a string')
  return decoded
}

describe('the build-time source address and the server’s', () => {
  it.each([
    ['no ref at all', undefined],
    ['a blank ref, which an unset Docker build argument becomes', ''],
    ['a tag', 'v2.1.0'],
    ['a release branch', 'release/2.1'],
    ['a full commit', 'a'.repeat(40)],
  ])('agree for %s', (_name, ref) => {
    expect(bundleSays(ref)).toBe(serverSays(ref))
  })

  it.each(['v2.1.0?x=1', '../../other', 'a b', '/leading', 'trailing/', 'a//b', '.hidden', 'a..b'])(
    'both refuse the ref %j, so a bad build argument fails the build and not the page',
    (ref) => {
      expect(() => buildDefines(VERSION, ref)).toThrow(/SOURCE_REF/)
      expect(() => loadConfig({ NODE_ENV: 'development', SOURCE_REF: ref })).toThrow(/SOURCE_REF/)
    },
  )

  it('points into the repository package.json declares, in both copies', () => {
    // The upstream address is written in two files that may not import each other, and
    // tied to nothing else. A repository that moves would leave the default offering a
    // dead address in the server and in the bundle at once, so both are held to the one
    // place the project already says where it lives.
    const manifest: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const repository: unknown =
      typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'repository') : null
    const declared: unknown =
      typeof repository === 'object' && repository !== null ? Reflect.get(repository, 'url') : null
    if (typeof declared !== 'string') throw new Error('package.json declares no repository.url')
    const upstream = declared.replace(/^git\+/, '').replace(/\.git$/, '')

    expect(serverSays(undefined).startsWith(`${upstream}/tree/`)).toBe(true)
    expect(bundleSays(undefined).startsWith(`${upstream}/tree/`)).toBe(true)
  })

  it('defaults to the tag of the version it was built at', () => {
    expect(bundleSays(undefined)).toBe('https://github.com/Irony42/EventSlide/tree/v7.8.9')
  })

  it('carries the version it was given', () => {
    expect(JSON.parse(buildDefines('1.2.3', undefined).__APP_VERSION__)).toBe('1.2.3')
  })
})
