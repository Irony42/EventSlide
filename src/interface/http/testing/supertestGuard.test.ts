import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No test sends its requests through `supertest` directly: it goes through `./request`, which
 * keeps one listening server per Express app. A bare `supertest(app)` binds a port per request,
 * and on Windows that exhausts the dynamic range during a full run (`EADDRINUSE`, a thousand
 * unrelated tests red). A type-only import is fine; the value is what this refuses.
 */

const SRC = path.resolve(__dirname, '../../..')
const ROOT = path.resolve(SRC, '..')
const HELPER = path.join(SRC, 'interface/http/testing/request.ts')

/** Where a test may live: the server, the scripts' own tests and the end-to-end suite. */
const SCANNED = [SRC, path.join(ROOT, 'scripts'), path.join(ROOT, 'tests')]

/** A TypeScript source in any of the spellings this repository uses. */
const isTypeScriptSource = (name: string): boolean => /\.(?:ts|tsx|mts)$/.test(name)

const sourcesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourcesUnder(full)
    return isTypeScriptSource(entry.name) ? [full] : []
  })

/**
 * A value import of `supertest`: `import x from`, `import x, { type T } from`, `export ... from`,
 * `require(...)` and a dynamic `import(...)`.
 */
const importsSupertestForItsValue = (text: string): boolean =>
  /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+['"]supertest['"]/m.test(text) ||
  /\b(?:require|import)\(\s*['"]supertest['"]\s*\)/.test(text)

describe('how a test reaches supertest', () => {
  const files = SCANNED.flatMap(sourcesUnder)
  const offenders = files
    .filter((file) => file !== HELPER && file !== __filename)
    .filter((file) => importsSupertestForItsValue(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))

  it('is through the shared helper, which holds one server per app', () => {
    expect(offenders).toEqual([])
  })

  it('reads the server, the scripts and the end-to-end suite, in every TypeScript spelling', () => {
    const relative = files.map((file) => path.relative(ROOT, file).split(path.sep).join('/'))

    expect(relative.some((file) => file.startsWith('src/'))).toBe(true)
    expect(relative.some((file) => file.startsWith('scripts/'))).toBe(true)
    expect(relative.some((file) => file.startsWith('tests/'))).toBe(true)
    expect(isTypeScriptSource('a.ts')).toBe(true)
    expect(isTypeScriptSource('a.tsx')).toBe(true)
    expect(isTypeScriptSource('a.mts')).toBe(true)
    expect(isTypeScriptSource('a.js')).toBe(false)
    expect(isTypeScriptSource('a.ts.snap')).toBe(false)
  })

  it('recognises the shapes an import takes', () => {
    expect(importsSupertestForItsValue("import request from 'supertest'")).toBe(true)
    expect(importsSupertestForItsValue("import request, { type Agent } from 'supertest'")).toBe(
      true,
    )
    expect(importsSupertestForItsValue("const request = require('supertest')")).toBe(true)
    expect(importsSupertestForItsValue("const m = await import('supertest')")).toBe(true)
    expect(importsSupertestForItsValue("export { default } from 'supertest'")).toBe(true)
    expect(importsSupertestForItsValue("import {\n  agent,\n} from 'supertest'")).toBe(true)
    expect(importsSupertestForItsValue("import type {\n  Test,\n} from 'supertest'")).toBe(false)
    expect(importsSupertestForItsValue("import type request from 'supertest'")).toBe(false)
    expect(importsSupertestForItsValue("import request from '../testing/request'")).toBe(false)
  })
})
