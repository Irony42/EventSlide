import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No test sends its requests through `supertest` directly: it goes through `./request`, which
 * keeps one listening server per Express app. A bare `supertest(app)` binds a port per request,
 * and on Windows that exhausts the dynamic range during a full run (`EADDRINUSE`, a thousand
 * unrelated tests red). A type-only import is fine; the value is what this refuses.
 *
 * Files outside `src/interface` that are not migrated yet are named, with the reason, so the list
 * can only shrink.
 */

const SRC = path.resolve(__dirname, '../../..')
const HELPER = path.join(SRC, 'interface/http/testing/request.ts')

/** Not part of this change: each is another lot's file. They send one request each. */
const NOT_MIGRATED_YET: readonly string[] = [
  'interface/http/clientCache.test.ts',
  'main/book.container.test.ts',
  'main/eventHostRoutes.container.test.ts',
  'main/offboarding.container.test.ts',
  'main/presence.container.test.ts',
  'main/reel.container.test.ts',
  'main/stats.container.test.ts',
  'main/suspension.container.test.ts',
  'main/takedown.container.test.ts',
]

const sourcesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourcesUnder(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })

/**
 * A value import of `supertest`: `import x from`, `import x, { type T } from`, `export ... from`,
 * `require(...)` and a dynamic `import(...)`.
 */
const importsSupertestForItsValue = (text: string): boolean =>
  /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+['"]supertest['"]/m.test(text) ||
  /\b(?:require|import)\(\s*['"]supertest['"]\s*\)/.test(text)

describe('how a test reaches supertest', () => {
  const offenders = sourcesUnder(SRC)
    .filter((file) => file !== HELPER && file !== __filename)
    .filter((file) => importsSupertestForItsValue(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))

  it('is through the shared helper, which holds one server per app', () => {
    expect(offenders.filter((file) => !NOT_MIGRATED_YET.includes(file))).toEqual([])
  })

  it('does not keep a file on the list once it has been migrated', () => {
    expect(NOT_MIGRATED_YET.filter((file) => !offenders.includes(file))).toEqual([])
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
