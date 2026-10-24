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
    .filter((line) => /^\| `[A-Z][A-Za-z]+`\s+\|/.test(line))
    .map((line) => /^\| `([A-Za-z]+)`/.exec(line)?.[1] ?? '')

  const portFiles = readdirSync(join(ROOT, 'src', 'application', 'ports')).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )

  const interfacesIn = (file: string): string[] =>
    [...read('src', 'application', 'ports', file).matchAll(/^export interface ([A-Za-z]+)/gm)].map(
      (match) => match[1] ?? '',
    )

  it('reads its rows, or this guard checks nothing', () => {
    expect(rows.length).toBeGreaterThan(20)
  })

  it.each(portFiles)('has a row for the port declared in %s', (file) => {
    const named = interfacesIn(file).filter((name) => rows.includes(name))

    expect(named, `no interface of ${file} is a row of the table`).not.toEqual([])
  })

  it('names, in every row, an interface that a port file exports', () => {
    const exported = new Set(portFiles.flatMap(interfacesIn))

    expect(rows.filter((name) => !exported.has(name))).toEqual([])
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
  const quotedPaths = (text: string): string[] => [
    ...new Set(
      [...text.matchAll(/`([A-Za-z0-9_@./-]+\.(?:ts|tsx|mts|sh|css|yaml|yml|json|md))`/g)]
        .map((match) => match[1] ?? '')
        .filter((path) => !path.startsWith('.') && !path.startsWith('/') && path.includes('.'))
        // A call (`express.json`) is not a file: it has no folder and no source extension.
        .filter(
          (path) => !/^[a-z]+.json$/.test(path) || path.includes('/') || path === 'package.json',
        ),
    ),
  ]

  /**
   * Files of 1.0, named where a document says what the rewrite replaced. They are gone on
   * purpose, and a document that says so is not drifting.
   */
  const GONE_WITH_1_0 = new Set([
    'src/index.ts',
    'src/database.ts',
    'src/routes/pictures.ts',
    'routes/pictures.ts',
    'public/app.css',
    'frontend/pages/QRCodePage.tsx',
    'frontend/pages/UploadPage.tsx',
    'frontend/hooks/useSessionIndex.ts',
    'pictureStorage.ts',
  ])

  const missing = (text: string): string[] =>
    quotedPaths(text).filter(
      (path) =>
        !GONE_WITH_1_0.has(path) &&
        !files.some((file) => file === path || file.endsWith(`/${path}`)),
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
