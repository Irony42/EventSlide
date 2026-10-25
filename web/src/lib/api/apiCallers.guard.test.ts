import { describe, expect, it } from 'vitest'
import { withoutComments } from '../../testing/withoutComments'
import { api } from './client'

/**
 * Every method of `Api` has a production caller, or a reason it has none — the source, read.
 *
 * `createApi` is "one typed function per endpoint", and an endpoint is cheap to add: the
 * method, its row in `client.test.ts` and its entry in the `fakeApi` of
 * `testing/renderWithProviders.tsx`. All three keep passing after the last screen that used
 * the method has gone, so a method nothing calls costs two more files and says an endpoint
 * is in use when it is not. This is the count, taken on every run: a method no production
 * module calls fails here until it is deleted or named in {@link UNCALLED} with the reason it
 * is kept.
 *
 * A caller is `api.name` or `useApi().name` in a production module, comments stripped. A
 * module that destructures (`const { name } = useApi()`) is not seen, and fails the other
 * way, loudly: write it as `api.name`.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is: no
 * behaviour tells a called method from an uncalled one.
 */

const MODULES = import.meta.glob<string>('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: `./x` for a sibling, `../x` for `lib/x`, `../../x` for the rest. */
const named = (path: string): string =>
  path
    .replace(/^\.\.\/\.\.\//, '')
    .replace(/^\.\.\//, 'lib/')
    .replace(/^\.\//, 'lib/api/')

/**
 * Production modules only: a test and a fake call whatever they like, which is how a
 * method with no caller kept two rows of "coverage". `client.ts` is where every method is
 * defined, so a method that names itself there is not a caller.
 */
const production = Object.entries(MODULES)
  .map(([path, source]) => [named(path), source] as const)
  .filter(
    ([path]) =>
      !/\.test\.tsx?$/.test(path) && !/(^|\/)testing\//.test(path) && path !== 'lib/api/client.ts',
  )
  .map(([path, source]) => [path, withoutComments(source)] as const)

/** `api.name` or `useApi().name`, the name ending where an identifier does (`react` is not `reactions`). */
const callOf = (method: string): RegExp => new RegExp(`(?:\\bapi|\\buseApi\\(\\))\\.${method}\\b`)

/** The modules, comments already stripped, that call `method`. */
const callers = (
  method: string,
  modules: readonly (readonly [string, string])[] = production,
): readonly string[] =>
  modules.filter(([, source]) => callOf(method).test(source)).map(([path]) => path)

/**
 * The methods kept without a caller, each with the reason. An exact list in both directions:
 * a method that gained a caller must leave it, and a name that is not a method must not be on
 * it.
 */
const UNCALLED: Readonly<Record<string, string>> = {
  topPhotos:
    'the highlights tallies (`GET /api/events/:slug/top-photos`, roadmap 2.5, a future highlights ' +
    "reel): whether the screen is built or the method deleted is Pierre's decision, recorded in " +
    'the pull request that wrote this guard',
}

const METHODS = Object.keys(api)

describe('every method of Api has a production caller, or a reason it has none', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(150)
    expect(production.map(([path]) => path)).toContain('features/admin/EventPage.tsx')
    expect(production.map(([path]) => path)).not.toContain('lib/api/client.ts')
    expect(METHODS.length).toBeGreaterThan(70)
  })

  it('finds a call in the shapes this tree spells one, and nothing else', () => {
    // The detector pointed at known positives and known negatives: without this, "no
    // method without a caller" below is as green for a broken pattern as for a clean tree.
    const seen = (source: string, method: string): boolean =>
      callers(method, [['x.ts', withoutComments(source)]]).length === 1

    expect(seen('await api.moderate(slug, id, decision)', 'moderate')).toBe(true)
    expect(seen('const url = useApi().albumUrl(slug)', 'albumUrl')).toBe(true)
    expect(seen('deps.api.session(signal)', 'session')).toBe(true)
    expect(seen('api\n  .moderate(slug)', 'moderate')).toBe(false)
    expect(seen('api.reactions(slug, id)', 'react')).toBe(false)
    expect(seen('myapi.react(slug, id, kind)', 'react')).toBe(false)
    expect(seen('// api.react(slug, id, kind)', 'react')).toBe(false)
    expect(seen('/* useApi().react(slug) */', 'react')).toBe(false)
    expect(seen('const { react } = useApi()', 'react')).toBe(false)
  })

  it('has no method that nothing in production calls, unless it says why', () => {
    const uncalled = METHODS.filter(
      (method) => callers(method).length === 0 && !(method in UNCALLED),
    )

    expect(
      uncalled,
      'Api methods no production module calls: delete each (with its row in client.test.ts and ' +
        'its entry in testing/renderWithProviders.tsx) or name it in UNCALLED with the reason',
    ).toEqual([])
  })

  it('does not excuse a method that has since gained a caller, or one that is not a method', () => {
    const stale = Object.keys(UNCALLED).filter(
      (name) => !METHODS.includes(name) || callers(name).length > 0,
    )

    expect(stale, 'UNCALLED entries to remove: called now, or no longer methods of Api').toEqual([])
  })

  it('gives every excuse a reason', () => {
    const blank = Object.entries(UNCALLED)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name)

    expect(blank, 'UNCALLED entries with no reason').toEqual([])
  })
})
