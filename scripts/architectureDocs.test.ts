import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What docs/ARCHITECTURE.md and docs/TESTING.md say about the code, held to the code.
 *
 * `docDrift.test.ts` pins single claims by a substring, so it cannot notice a catalogue that is
 * twelve ports short or a snippet that describes classes that do not exist: a table that omits
 * a port contains every substring a claim about the others looks for. This reads the folders.
 *
 *  - every port file under `src/application/ports/` has an interface in the §4 table, and every
 *    row of the table names an interface that exists there;
 *  - every file path the two documents quote in backticks exists somewhere in the repository;
 *  - the composition-root section names only identifiers that exist in the source.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

const SKIPPED = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'graphify-out',
  'test-results',
])

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })

const repositoryFiles = (): string[] =>
  walk(ROOT).map((path) => relative(ROOT, path).replace(/\\/g, '/'))

const architecture = read('docs', 'ARCHITECTURE.md')
const testing = read('docs', 'TESTING.md')

describe('the ports catalogue of docs/ARCHITECTURE.md §4', () => {
  const section = architecture.slice(
    architecture.indexOf('## 4. Ports catalogue'),
    architecture.indexOf('## 5. Domain model'),
  )
  const rows = section
    .split('\n')
    .filter((line) => /^\| `[A-Z][A-Za-z0-9]+`\s+\|/.test(line))
    .map((line) => /^\| `([A-Za-z0-9]+)`/.exec(line)?.[1] ?? '')

  const portFiles = walk(join(ROOT, 'src', 'application', 'ports'))
    .filter((path) => /\.m?ts$/.test(path) && !/\.test\.m?ts$/.test(path))
    .map((path) => relative(join(ROOT, 'src', 'application', 'ports'), path).replace(/\\/g, '/'))

  /**
   * The ports a file declares: its exported interfaces that have a method. A value a port
   * returns (a page, a probe, a record) has only fields, so it is not a port and needs no row;
   * an interface with a method is, whatever it is called and however many share a file.
   */
  /**
   * An interface with a method that has no adapter and needs no row: a seam between two fakes.
   * `FakePhotoRepository` is given one so that an event's byte total can see the clip queue.
   */
  const NOT_PORTS = new Set(['StagedByteSource', 'ReelByteSource'])

  const portsIn = (file: string): string[] => {
    const text = read('src', 'application', 'ports', file)
    return [...text.matchAll(/^export interface ([A-Za-z0-9]+)[^{]*\{\n([\s\S]*?)\n\}/gm)]
      .filter((match) => !NOT_PORTS.has(match[1] ?? ''))
      .filter((match) => /^ {2}(?:readonly )?[A-Za-z0-9]+(?:<[^>]*>)?\(/m.test(match[2] ?? ''))
      .map((match) => match[1] ?? '')
  }

  it('reads its rows, or this guard checks nothing', () => {
    expect(rows.length).toBeGreaterThan(30)
  })

  it('finds a port in every port file, so no file escapes the comparison below', () => {
    expect(portFiles.filter((file) => portsIn(file).length === 0)).toEqual([])
  })

  it.each(portFiles)('has a row for every port declared in %s', (file) => {
    expect(portsIn(file).filter((name) => !rows.includes(name))).toEqual([])
  })

  it('names, in every row, a port that a port file declares', () => {
    const declared = new Set(portFiles.flatMap(portsIn))

    expect(rows.filter((name) => !declared.has(name))).toEqual([])
  })

  it('lists each port once', () => {
    expect(rows.filter((name, index) => rows.indexOf(name) !== index)).toEqual([])
  })
})

describe('the file paths docs/ARCHITECTURE.md and docs/TESTING.md quote', () => {
  const files = repositoryFiles()

  /**
   * Quoted paths are written in full (`src/main/container.ts`) or from the layer they are in
   * (`db/sqliteEventRepository.ts`), so a path exists when some file of the repository ends with
   * it. A placeholder, a glob or an extension alone is not a path.
   */
  const SOURCE_EXTENSIONS = 'ts|tsx|mts|cts|js|mjs|cjs|sh|css|yaml|yml|json|md|sql'

  /**
   * Files that are gone on purpose and named anyway: the ones of 1.0, where a document says what
   * the rewrite replaced, and the old name of the lint config, where it tells the story of its
   * rename. Each is listed in full, so a typo of a live path is not excused by it.
   */
  const GONE = new Set([
    'src/index.ts',
    'src/database.ts',
    'src/routes/pictures.ts',
    'routes/pictures.ts',
    'public/app.css',
    'pictureStorage.ts',
    'frontend/pages/QRCodePage.tsx',
    'frontend/pages/UploadPage.tsx',
    'frontend/hooks/useSessionIndex.ts',
    'eslint.config.js',
    // A call, not a file.
    'express.json',
  ])

  /** The paths a text quotes in backticks. An extension alone (`.spec.ts`) is not a path. */
  const quotedPaths = (text: string): string[] => [
    ...new Set(
      [...text.matchAll(new RegExp(`\`([A-Za-z0-9_@./-]+\\.(?:${SOURCE_EXTENSIONS}))\``, 'g'))]
        .map((match) => match[1] ?? '')
        .filter((path) => !GONE.has(path) && !path.startsWith('/'))
        .filter((path) => !(path.startsWith('.') && !path.includes('/'))),
    ),
  ]

  const missing = (text: string): string[] =>
    quotedPaths(text).filter(
      (path) => !files.some((file) => file === path || file.endsWith(`/${path}`)),
    )

  it('all exist in docs/ARCHITECTURE.md', () => {
    expect(missing(architecture)).toEqual([])
  })

  it('all exist in docs/TESTING.md', () => {
    expect(missing(testing)).toEqual([])
  })

  it('finds a path that is not there, which is what makes the two checks above mean something', () => {
    expect(missing('see `crypto/cryptoIdGenerator.ts` and `src/main/container.ts`')).toEqual([
      'crypto/cryptoIdGenerator.ts',
    ])
    expect(missing('the 1.0 `src/database.ts` and `.claude/skills/nothing/SKILL.md`')).toEqual([
      '.claude/skills/nothing/SKILL.md',
    ])
  })

  it('has paths to resolve', () => {
    expect(existsSync(join(ROOT, 'docs', 'ARCHITECTURE.md'))).toBe(true)
    expect(quotedPaths(architecture).length).toBeGreaterThan(30)
  })
})

describe('the composition root of docs/ARCHITECTURE.md §8', () => {
  const section = architecture.slice(
    architecture.indexOf('## 8. Composition root'),
    architecture.indexOf('### Graceful shutdown'),
  )

  /** Everything the server is built from, as one string to look names up in. */
  const source = walk(join(ROOT, 'src'))
    .filter((path) => /\.ts$/.test(path) && !/\.test\.ts$/.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  // A name in backticks with a capital in it is a class, a function or a type; the section used
  // to show a constructor list (`SystemClock`, `InProcessEventBus`, `SseHub`, `sweepTempDir`)
  // that matched nothing, so a reader copying it wrote code that did not compile.
  const identifiers = [
    ...new Set(
      [...section.matchAll(/`([A-Za-z]+[A-Z][A-Za-z]*)(?:\(\))?`/g)].map((match) => match[1] ?? ''),
    ),
  ]

  it('has identifiers to check', () => {
    expect(identifiers.length).toBeGreaterThan(5)
  })

  it('names only identifiers that exist in src/', () => {
    expect(identifiers.filter((name) => !new RegExp(`\\b${name}\\b`).test(source))).toEqual([])
  })
})
