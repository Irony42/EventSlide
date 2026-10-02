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

  it('defaults to the tag of the version it was built at', () => {
    expect(bundleSays(undefined)).toBe('https://github.com/Irony42/EventSlide/tree/v7.8.9')
  })

  it('carries the version it was given', () => {
    expect(JSON.parse(buildDefines('1.2.3', undefined).__APP_VERSION__)).toBe('1.2.3')
  })
})
