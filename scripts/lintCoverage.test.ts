import { readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Every source file under `scripts/` is linted, with the server rules.
 *
 * `toolsProject.test.ts` closed the typecheck half of this gap: `scripts/showcase.mts` was
 * in no TypeScript project because `tsconfig.tools.json` said `scripts/**\/*.ts`. The
 * lint half stayed open behind it. `eslint.config.mjs` said the same `scripts/**\/*.ts`,
 * and a flat config that matches no block for a file does not lint it and does not say so
 * — `npm run lint` over the whole tree stayed green while `showcase.mts` read
 * `process.env` in plain sight of the rule that bans it.
 *
 * So this asks ESLint itself, file by file, rather than reading globs out of the config:
 * a pattern that looks right and matches nothing is exactly the failure being guarded.
 * Two witnesses: `no-explicit-any` says the file was linted as TypeScript at all, and the
 * `process.env` ban says a script — not a test, which the tests block relaxes on purpose
 * — was linted as server code.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** Extensions ESLint could lint here. A `.sh` or a `.env` in this folder is not its job. */
const LINTABLE = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs'])

const sourcesUnderScripts = (): string[] => {
  const found: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (LINTABLE.has(extname(entry.name))) found.push(relative(ROOT, full))
    }
  }
  walk(HERE)
  return found.sort()
}

/** The severity ESLint resolved for `rule` on `source`, or `undefined` if it lints nothing there. */
const severityOf = async (eslint: ESLint, source: string, rule: string): Promise<unknown> => {
  const config: unknown = await eslint.calculateConfigForFile(source)
  const setting = (config as { rules?: Record<string, unknown> } | undefined)?.rules?.[rule]
  return Array.isArray(setting) ? setting[0] : setting
}

describe('eslint.config.mjs over scripts/', () => {
  const eslint = new ESLint({ cwd: ROOT })
  const sources = sourcesUnderScripts()

  it('lints every source file under scripts/ as TypeScript', async () => {
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(
        await severityOf(eslint, source, '@typescript-eslint/no-explicit-any'),
        `${source} is not linted`,
      ).toBe(2)
    }
  })

  it('holds every script, test files aside, to the ban on reading process.env', async () => {
    const scripts = sources.filter((source) => !/\.test\.[cm]?tsx?$/.test(source))

    expect(scripts.length).toBeGreaterThan(0)
    for (const source of scripts) {
      expect(
        await severityOf(eslint, source, 'no-restricted-syntax'),
        `${source} is not linted as server code`,
      ).toBe(2)
    }
  })
})
