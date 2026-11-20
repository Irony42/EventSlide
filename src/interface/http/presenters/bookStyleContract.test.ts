import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { THEME_AMBIANCES } from '../../../domain/events/eventTheme'
import { BOOK_SELECTION_TARGETS, defaultBookStyle } from '../../../domain/book/bookOptionsV2'
import { PRINT_MAX_PAGES } from '../../../domain/book/bookPrint'
import { BOOK_STYLE_DEFS } from '../../../domain/book/bookStyles'

/**
 * The web copy of the photo book's choices, held to the domain's own (spec 26).
 *
 * The web app cannot import `src/` (and a web test cannot either), so `web/src/lib/bookStyle.ts`
 * keeps its own copy of what the form offers: the style an ambiance suggests, the styles, the three
 * lengths and the printers' page ceiling. This file loads that module, **runs** it (it imports only
 * types, so the compiled text stands alone), and fails when a choice drifts from the server's. A
 * style or a length added to the domain fails here until the console offers it.
 */

const SOURCE = join(process.cwd(), 'web/src/lib/bookStyle.ts')

interface WebBookStyle {
  readonly defaultBookStyle: (ambiance: string) => string
  readonly BOOK_STYLES: readonly string[]
  readonly BOOK_LENGTHS: readonly string[]
  readonly BOOK_LENGTH_TARGET: Readonly<Record<string, number>>
  readonly BOOK_PRINT_MAX_PAGES: number
}

const load = (): WebBookStyle => {
  const compiled = ts.transpileModule(readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, unknown> = {}
  runInNewContext(compiled, { exports, module: { exports } })
  return exports as unknown as WebBookStyle
}

const web = load()

describe('the web copy of the photo book’s choices', () => {
  it('has something to read, rather than an empty module', () => {
    expect(web.BOOK_STYLES.length).toBeGreaterThan(0)
    expect(typeof web.defaultBookStyle).toBe('function')
  })

  it.each(THEME_AMBIANCES)('suggests, for %s, the style the server does', (ambiance) => {
    expect(web.defaultBookStyle(ambiance)).toBe(defaultBookStyle(ambiance))
  })

  it('offers exactly the styles the renderer has', () => {
    expect([...web.BOOK_STYLES].sort()).toEqual(Object.keys(BOOK_STYLE_DEFS).sort())
  })

  it('offers the three lengths the server accepts, shortest first', () => {
    expect(web.BOOK_LENGTHS.map((length) => web.BOOK_LENGTH_TARGET[length])).toEqual([
      ...BOOK_SELECTION_TARGETS,
    ])
  })

  it('says the printers’ page ceiling the server applies', () => {
    expect(web.BOOK_PRINT_MAX_PAGES).toBe(PRINT_MAX_PAGES)
  })
})
