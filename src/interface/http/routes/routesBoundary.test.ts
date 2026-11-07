import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The ESLint rules `ROUTES_NO_PEER` and `INTERFACE_NO_FS` catch static imports only, and an
 * `eslint-disable` comment turns them off. This guard reads the route sources themselves, so a
 * dynamic `import()`, a deep relative path or a disable comment cannot slip a route past them.
 */
const dir = import.meta.dirname
const routeSources = readdirSync(dir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:from|import\s*\(|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')

describe('route files boundary', () => {
  it('sees the route files', () => {
    expect(routeSources.length).toBeGreaterThan(10)
  })

  it.each(routeSources)('$name imports no other route file', ({ text }) => {
    const peers = specifiers(text).filter(
      (s) => s.startsWith('./') || /(^|\/)routes\/[^/]+$/.test(s),
    )
    expect(peers).toEqual([])
  })

  it.each(routeSources)('$name never touches the filesystem', ({ text }) => {
    const fs = specifiers(text).filter((s) => /^(node:)?fs(\/|$)/.test(s))
    expect(fs).toEqual([])
  })

  it.each(routeSources)('$name does not disable the boundary rules', ({ text }) => {
    expect(text).not.toMatch(/eslint-disable[^\n]*no-restricted-imports/)
  })
})
