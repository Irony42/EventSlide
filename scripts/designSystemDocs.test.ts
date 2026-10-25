import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What the design-system document and the UI recipe say about the web app, held to the code.
 *
 * Both described a `Grid` primitive that was never built, a `web/src/lib/api/photos.ts`
 * that has never existed, and a test helper `fakeTransport` where the repository has
 * `fakeApi`. The recipe is the first thing an agent reads before touching `web/src`, so a
 * sentence in it that names something absent sends the reader to write the absent thing.
 * `docDrift.test.ts` pins single claims and `architectureDocs.test.ts` the two architecture
 * documents; this is the same rule for the two that describe the UI:
 *
 *  - every primitive in the table of `docs/DESIGN-SYSTEM.md` §5, and in the list the recipe
 *    opens with, is exported by a file in `web/src/design-system/components/`;
 *  - every `web/…` file the recipe names exists;
 *  - every helper its test sample imports from `renderWithProviders` is exported there.
 *
 * What it does not check is the other direction: a primitive in the folder that no document
 * lists (`ConfirmDialog`, `CloseIcon`, `StatusIcon`, `ToastProvider` today).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

const DESIGN_SYSTEM = read('docs', 'DESIGN-SYSTEM.md')
const RECIPE_PATH = ['.claude', 'skills', 'eventslide-ui-component', 'SKILL.md'] as const
const RECIPE = read(...RECIPE_PATH)

const COMPONENTS = join('web', 'src', 'design-system', 'components')

/** Every component a production file of the folder exports: `export function X` or `export const X`. */
const exportedPrimitives = (): ReadonlySet<string> =>
  new Set(
    readdirSync(join(ROOT, COMPONENTS))
      .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
      .flatMap((file) =>
        [...read(COMPONENTS, file).matchAll(/^export (?:function|const) ([A-Z]\w*)/gm)].map(
          ([, name = '']) => name,
        ),
      ),
  )

/** The first cell of each row of the primitives table in §5: the rows between its header and its end. */
const tablePrimitives = (markdown: string): readonly string[] => {
  const lines = markdown.split('\n')
  const header = lines.findIndex((line) => /^\|\s*Primitive\s*\|/.test(line))
  if (header < 0) return []
  const names: string[] = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const name = /^\|\s*`([A-Za-z]+)`/.exec(line)?.[1]
    if (name !== undefined) names.push(name)
  }
  return names
}

/** The backticked names of "`…/components/` holds `A`, `B` and `C`." in the recipe, as running text. */
const listedPrimitives = (markdown: string): readonly string[] => {
  const sentence = /components\/` holds ([^.]*)\./.exec(markdown.replace(/\s+/g, ' '))?.[1] ?? ''
  return [...sentence.matchAll(/`([A-Za-z]+)`/g)].map(([, name = '']) => name)
}

/** The `web/…` files a document names, in backticks, in a code comment or in running text. */
const namedFiles = (markdown: string): readonly string[] => [
  ...new Set(markdown.match(/\bweb\/[A-Za-z0-9_./-]+\.(?:tsx?|css)\b/g) ?? []),
]

/** The names a document's code sample imports from the shared render helper. */
const importedFromRenderHelper = (markdown: string): readonly string[] => {
  const imported = /import \{([^}]*)\} from '[./]*\/testing\/renderWithProviders'/.exec(markdown)
  return (imported?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

describe('docs/DESIGN-SYSTEM.md and the UI recipe', () => {
  const primitives = exportedPrimitives()

  it('can read the folder and both lists, rather than checking nothing', () => {
    expect(primitives.size).toBeGreaterThan(15)
    expect(primitives).toContain('Button')
    expect(primitives).toContain('LoadFailure')
    expect(tablePrimitives(DESIGN_SYSTEM).length).toBeGreaterThan(15)
    expect(listedPrimitives(RECIPE).length).toBeGreaterThan(12)
    expect(namedFiles(RECIPE).length).toBeGreaterThan(4)
    expect(importedFromRenderHelper(RECIPE).length).toBeGreaterThan(0)
  })

  it('reads the shapes of those lists and nothing else', () => {
    // The parsers pointed at known texts: without this, "every primitive exists" below is as
    // green for a parser that reads nothing as for a document that is true.
    expect(
      tablePrimitives('| Primitive | Purpose |\n| --- | --- |\n| `A` | x |\n| `B` | y |\n\nz'),
    ).toEqual(['A', 'B'])
    expect(tablePrimitives('| Other | x |\n| --- | --- |\n| `A` | x |')).toEqual([])
    expect(
      listedPrimitives('`web/x/components/` holds `A`, `B`,\n`C` and `D`.\n\nNot `E`.'),
    ).toEqual(['A', 'B', 'C', 'D'])
    expect(namedFiles('see `web/src/lib/http.ts` and // web/src/x/y.tsx, not web/src/z/')).toEqual([
      'web/src/lib/http.ts',
      'web/src/x/y.tsx',
    ])
    expect(
      importedFromRenderHelper(
        "import { renderWithProviders, fakeApi } from '../../testing/renderWithProviders'",
      ),
    ).toEqual(['renderWithProviders', 'fakeApi'])
  })

  it('lists, in the table of §5, only primitives a file of the folder exports', () => {
    const absent = tablePrimitives(DESIGN_SYSTEM).filter((name) => !primitives.has(name))

    expect(
      absent,
      `docs/DESIGN-SYSTEM.md §5 names primitives with no file in ${COMPONENTS}`,
    ).toEqual([])
  })

  it('lists, in the recipe, only primitives a file of the folder exports', () => {
    const absent = listedPrimitives(RECIPE).filter((name) => !primitives.has(name))

    expect(absent, `the recipe names primitives with no file in ${COMPONENTS}`).toEqual([])
  })

  it('names, in the recipe, only files that exist', () => {
    const missing = namedFiles(RECIPE).filter((file) => !existsSync(join(ROOT, file)))

    expect(missing, 'files the recipe names that the repository does not have').toEqual([])
  })

  it('imports, in the recipe’s test sample, only helpers the render module exports', () => {
    const helpers = read('web', 'src', 'testing', 'renderWithProviders.tsx')
    const absent = importedFromRenderHelper(RECIPE).filter(
      (name) => !new RegExp(`^export (?:const|function) ${name}\\b`, 'm').test(helpers),
    )

    expect(
      absent,
      'helpers the recipe imports from testing/renderWithProviders that it lacks',
    ).toEqual([])
  })
})
