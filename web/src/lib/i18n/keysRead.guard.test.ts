import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withoutComments } from '../../testing/withoutComments'
import { fr } from './fr'

/**
 * Every sentence in `fr.ts` is read by something that ships — the source, read.
 *
 * `fr.ts` decides which keys exist and the compiler makes the four other tables follow, so a
 * key costs five sentences, five translations to keep correct and one line in `fr.test.ts`
 * for as long as it stays. The compiler cannot see that nothing reads it, so a sentence for
 * a screen that was never built, for a region that is gone, or for a refusal the server never
 * sends stays in five tables until someone counts. This is the count, taken on every run.
 *
 * **What counts as a read.**
 *
 * - A leaf of a section is read when a production module spells it **on the section**:
 *   `.upload.thanks`, or `copy.thanks` where `const copy = text.upload`, or `{ thanks }`
 *   destructured out of `text.upload`. A leaf that is not an identifier is looked for as a
 *   quoted key (`['storage.boxFull']`). The section is part of the spelling because a bare
 *   `.back` or `.title` is read by anything, and a guard that accepted it said "read" of
 *   nine sentences nothing showed.
 * - A leaf of a table nested inside a section (`wall.layoutNames.mosaic`) is read when the
 *   table is (`.wall.layoutNames`): it is indexed by a value, so its members are never
 *   spelled. Most of these tables are typed `satisfies Record<Union, string>` in `fr.ts`, so
 *   the compiler holds their members; what this does not see is a member a union has lost.
 * - A page's title (`titles.security`) is read when a route names it, `titled('security', …)`,
 *   so the key is looked for as a quoted string.
 * - An error sentence (`errors['photo.notFound']`) is looked up by the code an answer
 *   carries, so it is read when the server can send the code: its quoted spelling is in a
 *   source file under `src/`, or in a production module that names it itself (the three
 *   password pages raise `password.mismatch` without a request). {@link COMPOSED_CODES} lists
 *   the codes a server builds from parts, each with where.
 *
 * Production means every module of `web/src` that is not a test, not under `testing/` and
 * not one of the five tables. Comments are stripped first, so explaining a key does not read
 * it. A module that reads a section by a route this does not follow (a parameter typed
 * `UiText['upload']`, say) is not seen, and fails loudly: spell it `text.upload.thanks`.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is: no
 * behaviour tells a sentence that is shown from one that is not.
 */

const MODULES = import.meta.glob<string>('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: `./x` is `lib/i18n/x`, `../x` is `lib/x`, `../../x` the rest. */
const named = (path: string): string =>
  path
    .replace(/^\.\.\/\.\.\//, '')
    .replace(/^\.\.\//, 'lib/')
    .replace(/^\.\//, 'lib/i18n/')

const web = Object.entries(MODULES)
  .map(([path, source]) => [named(path), source] as const)
  .filter(
    ([path]) =>
      !/\.test\.tsx?$/.test(path) &&
      !/(^|\/)testing\//.test(path) &&
      !/^lib\/i18n\/(fr|de|en|es|it)\.ts$/.test(path),
  )
  .map(([, source]) => withoutComments(source))

/** The server's own sources: where a code an answer carries is spelled. */
const SERVER_ROOT = join(process.cwd(), 'src')

const server = readdirSync(SERVER_ROOT, { recursive: true, encoding: 'utf8' })
  .map((path) => path.replace(/\\/g, '/'))
  .filter(
    (path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !/(^|\/)testing\//.test(path),
  )
  .map((path) => withoutComments(readFileSync(join(SERVER_ROOT, path), 'utf8')))

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** `name` spelled as a property of something: `.name`, ending where an identifier does. */
const property = (name: string): RegExp => new RegExp(`\\.${name}\\b`)

/** `key` as a whole quoted string, in any of the three quotes. */
const quoted = (key: string): RegExp =>
  new RegExp(`(['"\`])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`)

const anywhere = (pattern: RegExp, sources: readonly string[]): boolean =>
  sources.some((source) => pattern.test(source))

interface Leaf {
  /** The keys from the root: `['wall', 'layoutNames', 'mosaic']`. A key may itself contain dots. */
  readonly keys: readonly string[]
}

/** Every sentence, which is a string or a function; a table is not one. */
const leavesOf = (table: object, above: readonly string[] = []): readonly Leaf[] =>
  Object.entries(table).flatMap(([key, value]): readonly Leaf[] => {
    const keys = [...above, key]
    return typeof value === 'object' && value !== null ? leavesOf(value, keys) : [{ keys }]
  })

const LEAVES = leavesOf(fr)
const ERRORS = LEAVES.filter(({ keys }) => keys[0] === 'errors')
const SECTIONS = LEAVES.filter(({ keys }) => keys[0] !== 'errors')

/**
 * Does `source` read `leaf` of `section`: spelled on it, through a local alias of it, or
 * destructured out of it? The alias is `const copy = text.upload`, whose own uses are
 * `copy.leaf`.
 */
const readsLeaf = (section: string, leaf: string, source: string): boolean => {
  if (!IDENTIFIER.test(leaf)) return quoted(leaf).test(source)
  if (new RegExp(`\\.${section}\\.${leaf}\\b`).test(source)) return true
  const alias = new RegExp(`\\b(\\w+)\\s*=\\s*[\\w.]*\\.${section}\\b(?!\\.)`, 'g')
  for (const [, name = ''] of source.matchAll(alias)) {
    if (new RegExp(`\\b${name}\\.${leaf}\\b`).test(source)) return true
  }
  return new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=\\s*[\\w.]*\\.${section}\\b`).test(source)
}

/** Is this section leaf read by a module that ships? */
const isRead = (leaf: Leaf, sources: readonly string[] = web): boolean => {
  const { keys } = leaf
  const [section = '', second = ''] = keys
  const last = keys.at(-1) ?? ''
  if (section === 'titles') return anywhere(quoted(last), sources)
  // A table nested in a section is read as a whole: its members are the union's.
  const name = keys.length >= 3 ? second : last
  return sources.some((source) => readsLeaf(section, name, source))
}

/**
 * Can the server send this code, or does a production module raise it itself? `unknown` and
 * `network` are the client's own (`ApiError.network()`), and a bare key is also read as
 * `errors.unknown`.
 */
const isAnswered = (
  code: string,
  sources: readonly string[] = web,
  serverSources: readonly string[] = server,
): boolean =>
  anywhere(quoted(code), serverSources) ||
  anywhere(quoted(code), sources) ||
  (IDENTIFIER.test(code) && anywhere(property(`errors.${code}`), sources))

/**
 * The codes a server builds from parts, so that no source file spells them, each with where.
 * Exact in both directions: a code that is spelled somewhere has to leave the list, and a
 * name that is not an error sentence cannot be on it.
 */
const COMPOSED_CODES: Readonly<Record<string, string>> = {
  'client.liveNotAllowed':
    '`DomainError.forbidden(`client.${refusal}`)` in src/domain/events/event.ts, `refusal` being an `OpeningRefusal`',
  'client.liveWindowOver':
    '`DomainError.forbidden(`client.${refusal}`)` in src/domain/events/event.ts, `refusal` being an `OpeningRefusal`',
}

const codeOf = ({ keys }: Leaf): string => keys.slice(1).join('.')

describe('every sentence of fr.ts is read by something that ships', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(web.length).toBeGreaterThan(150)
    expect(server.length).toBeGreaterThan(100)
    expect(SECTIONS.length).toBeGreaterThan(500)
    expect(ERRORS.length).toBeGreaterThan(150)
    expect(web.some((source) => source.includes('useTranslations'))).toBe(true)
    expect(server.some((source) => source.includes('DomainError'))).toBe(true)
  })

  it('reads a leaf in the shapes this tree spells one, and nothing else', () => {
    // The detector pointed at known positives and known negatives: without this, "nothing
    // unread" below is as green for a broken pattern as for a table that is read.
    const read = (keys: readonly string[], source: string): boolean =>
      isRead({ keys }, [withoutComments(source)])

    expect(read(['upload', 'thanks'], '<p>{t.upload.thanks}</p>')).toBe(true)
    expect(read(['upload', 'sendCount'], 'text.upload.sendCount(n)')).toBe(true)
    expect(read(['upload', 'sendMore'], 't.upload.thanks')).toBe(false)
    expect(read(['upload', 'send'], 't.upload.sendMore')).toBe(false)
    expect(read(['upload', 'sendMore'], '// t.upload.sendMore')).toBe(false)
    // The section is part of the spelling: the same leaf name on another section is not a read.
    expect(read(['app', 'back'], '<a>{t.feed.back}</a>')).toBe(false)
    expect(read(['upload', 'title'], 'item.title')).toBe(false)
    expect(read(['upload', 'sending'], 't.upload.queue.sending')).toBe(false)
    // Through an alias of the section, and out of a destructuring of it.
    expect(read(['upload', 'thanks'], 'const copy = text.upload\nreturn copy.thanks')).toBe(true)
    expect(read(['upload', 'thanks'], 'const copy = text.upload\nreturn copy.title')).toBe(false)
    expect(read(['upload', 'thanks'], 'const { thanks, send } = t.upload')).toBe(true)
    expect(read(['upload', 'thanks'], 'const { send } = t.upload')).toBe(false)
    expect(read(['upload', 'storage.boxFull'], "t.upload['storage.boxFull']")).toBe(true)
    expect(read(['upload', 'storage.boxFull'], 't.upload.storage')).toBe(false)
    expect(read(['wall', 'layoutNames', 'mosaic'], 't.wall.layoutNames[layout]')).toBe(true)
    expect(read(['wall', 'layoutNames', 'mosaic'], 't.wall.title')).toBe(false)
    expect(read(['wall', 'layoutNames', 'mosaic'], 't.admin.layoutNames[layout]')).toBe(false)
    expect(read(['titles', 'security'], "titled('security', <SecurityPage />)")).toBe(true)
    expect(read(['titles', 'security'], 't.security')).toBe(false)
  })

  it('finds a code in the shapes the server and the client spell one, and nothing else', () => {
    const answered = (code: string, source: string): boolean =>
      isAnswered(code, [withoutComments(source)], [])

    expect(answered('unknown', 'text.errors.unknown')).toBe(true)
    expect(answered('unknown', 'text.errors.network')).toBe(false)
    expect(answered('password.mismatch', "t.errors['password.mismatch']")).toBe(true)
    expect(answered('password.mismatch', "t.errors['password.tooShort']")).toBe(false)
    expect(answered('photo.notFound', "// 'photo.notFound'")).toBe(false)
    expect(answered('photo.notFound', "'photo.notFoundAnymore'")).toBe(false)
    expect(answered('network', "new ApiError(0, 'network')")).toBe(true)

    const sentBy = (code: string, source: string): boolean =>
      isAnswered(code, [], [withoutComments(source)])

    expect(sentBy('photo.notFound', "DomainError.notFound('photo.notFound')")).toBe(true)
    expect(sentBy('photo.notFound', 'DomainError.notFound(`photo.${what}`)')).toBe(false)
    expect(sentBy('photo.notFound', "// 'photo.notFound'")).toBe(false)
  })

  it('has no section sentence that nothing in production reads', () => {
    const unread = SECTIONS.filter((leaf) => !isRead(leaf)).map(({ keys }) => keys.join('.'))

    expect(
      unread,
      'sentences of fr.ts no production module reads: delete each from fr.ts (the compiler then ' +
        'asks the same of de, en, es and it) and from fr.test.ts',
    ).toEqual([])
  })

  it('has no error sentence for a code nothing can send', () => {
    const unsent = ERRORS.filter(
      (leaf) => !isAnswered(codeOf(leaf)) && !(codeOf(leaf) in COMPOSED_CODES),
    ).map(codeOf)

    expect(
      unsent,
      'error sentences for codes no source under src/ spells and no production module names: ' +
        'delete each, or list it in COMPOSED_CODES with the place that builds it',
    ).toEqual([])
  })

  it('does not excuse a code that is spelled somewhere, or one that has no sentence', () => {
    const sentences = new Set(ERRORS.map(codeOf))
    const stale = Object.keys(COMPOSED_CODES).filter(
      (code) => !sentences.has(code) || isAnswered(code),
    )

    expect(
      stale,
      'COMPOSED_CODES entries to remove: spelled by a source now, or not a sentence',
    ).toEqual([])
  })
})
