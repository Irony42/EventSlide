import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every source file under `scripts/` belongs to a TypeScript project.
 *
 * `scripts/showcase.mts` reached `main` typed by nothing. `tsconfig.tools.json` included
 * `scripts/**\/*.ts`, which does not match `.mts` — so the file was committed, formatted
 * and completely unchecked, and `npm run typecheck` stayed green while covering less than
 * the tree contained. (It was not linted either, for the same reason in a different
 * config; `lintCoverage.test.ts` is that half.) Proven rather than assumed: `tsc --listFiles` named it in
 * neither the tools project nor the server one.
 *
 * That is CLAUDE.md §9 trap 9 in its second costume. The first was an `include` entry
 * matching a file that no longer existed; this one is an `include` entry that never
 * matched a file that did. Both are silent — an `include` that covers nothing produces no
 * error, no warning and no failing job — and both end the same way: "typecheck passes"
 * and "this file is type-checked" are different claims, and only the second one is a
 * guard.
 *
 * So this asserts the second. A new extension under `scripts/` — `.cts`, `.tsx`, whatever
 * a future tool wants — fails here on the day it is added, naming itself, instead of
 * being discovered months later by somebody wondering why a broken script never went red.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const TSCONFIG_PATH = join(HERE, '..', 'tsconfig.tools.json')

/** Extensions TypeScript compiles. A `.json` or a `.md` in here is not our problem. */
const COMPILED = new Set(['.ts', '.mts', '.cts', '.tsx'])

const extensionsUnderScripts = (): string[] => {
  const found = new Set<string>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (COMPILED.has(extname(entry.name))) found.add(extname(entry.name))
    }
  }
  walk(HERE)
  return [...found].sort()
}

describe('tsconfig.tools.json', () => {
  const tsconfig = readFileSync(TSCONFIG_PATH, 'utf8')

  it('covers every compiled extension that exists under scripts/', () => {
    const present = extensionsUnderScripts()

    expect(present.length).toBeGreaterThan(0)
    for (const extension of present) {
      expect(tsconfig, `scripts/**/*${extension} is in the tree and in no project`).toContain(
        `scripts/**/*${extension}`,
      )
    }
  })
})
