import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The product has one version, and it is written in one place: `package.json` (roadmap
 * G1-04 / P1-05, finding A-04).
 *
 * Before this the number `2.0.0` was typed into `src/main/container.ts`, into
 * `scripts/backup.ts` and into the image tag in `compose.yaml`, and a release bumped
 * whichever of them somebody remembered. `/api/health` then reported one version, the
 * backup manifest another, and — once `/api/about` exists to publish the source of *this*
 * build — the AGPL §13 offer would have pointed at the wrong tag. `src/main/version.ts`
 * is the single reader; `version.test.ts` proves it finds the manifest at every depth the
 * code runs from.
 *
 * What it cannot prove is that nobody writes the number down again, and that is the
 * mutation that matters: a literal pasted back into `container.ts` passes every test that
 * compares the version to itself. So this reads the source instead.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

const packageVersion = (): string => {
  const manifest: unknown = JSON.parse(read('package.json'))
  const version =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : null
  if (typeof version !== 'string') throw new Error('package.json has no version')
  return version
}

/** Production TypeScript: no tests, no test harnesses, no fixtures. */
const productionSources = (): readonly string[] => {
  const roots = ['src', 'scripts', join('web', 'src')]
  const files = roots.flatMap((root) =>
    readdirSync(join(ROOT, root), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name)),
  )
  return files
    .map((file) => relative(ROOT, file))
    .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
    .filter((file) => !/[\\/]testing[\\/]/.test(file))
}

/** A line that is prose rather than code: a line comment, or inside a block comment. */
const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line)

describe('the product version', () => {
  it('is not typed into any production source file', () => {
    // A quoted semantic version is a version somebody will forget to bump. The only
    // legitimate quoted ones in the tree are inside comments that explain why not.
    const literal = /['"`]\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?['"`]/
    const offenders = productionSources().flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, index) => ({ file, line, number: index + 1 }))
        .filter(({ line }) => !isComment(line) && literal.test(line))
        .map(({ file: where, number, line }) => `${where}:${number}: ${line.trim()}`),
    )

    expect(offenders, 'a version literal in production code').toEqual([])
  })

  it('is the tag of the image compose.yaml builds', () => {
    // `image: eventslide:<version>` is a name a human reads in `docker images`. It cannot
    // be derived from package.json, so it is held to it instead: bumping one and not the
    // other fails here rather than shipping a 2.1.0 build labelled 2.0.0.
    const tag = /^\s*image:\s*eventslide:(\S+)\s*$/m.exec(read('compose.yaml'))?.[1]

    expect(tag, 'the eventslide image tag in compose.yaml').toBeDefined()
    expect(tag).toBe(packageVersion())
  })
})
