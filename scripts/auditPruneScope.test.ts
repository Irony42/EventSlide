import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * "Retention pruning works only through the pruning use case" (roadmap §10.8; G2-06),
 * checked on the source rather than trusted to review.
 *
 * The audit log is append-only because the database says so. The single door that says
 * otherwise is the permanent `audit_prune_gate` row, and nothing in SQLite can tell *who*
 * opened it: any code holding the connection could. What keeps that door narrow is that
 * only one adapter method ever opens it, only one use case ever calls that method, and only
 * the retention sweep ever calls the use case. Each of those is a sentence in a comment
 * until something fails when it stops being true, and this is that something.
 *
 * Comments are stripped before searching, so prose that *names* a thing (a doc comment
 * explaining the gate) is not mistaken for a use of it. Test files are excluded: a test is
 * allowed to open the gate by hand, that is how it proves the database refuses everyone
 * else, and so are the fakes and contract suites under `testing/`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return [path]
  })

/**
 * Every TypeScript file the server and its tools are built from, slash-separated: not a
 * test, and not a test double or a contract suite (`testing/`), which exist to call these
 * things from outside.
 */
const productionSources = (): { path: string; code: string }[] =>
  [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
    .filter((path) => /\.m?ts$/.test(path) && !/\.test\.m?ts$/.test(path))
    .filter((path) => !/[\\/]testing[\\/]/.test(path))
    .map((path) => ({
      path: relative(ROOT, path).replace(/\\/g, '/'),
      code: withoutComments(readFileSync(path, 'utf8')),
    }))

const filesMatching = (pattern: RegExp): string[] =>
  productionSources()
    .filter(({ code }) => pattern.test(code))
    .map(({ path }) => path)
    .sort()

describe('the audit log can be pruned only through the pruning use case', () => {
  it('names the retention gate in the adapter and its migration, and nowhere else', () => {
    expect(filesMatching(/audit_prune_gate/)).toEqual([
      'src/infrastructure/db/migrations/009_audit_log.ts',
      'src/infrastructure/db/sqliteAuditLog.ts',
    ])
  })

  it('calls AuditLog.pruneOlderThan from the pruning use case only', () => {
    expect(filesMatching(/\.pruneOlderThan\(/)).toEqual([
      'src/application/usecases/audit/pruneAuditLog.ts',
    ])
  })

  it('reaches the pruning use case from the composition root and the retention sweep, and from no route', () => {
    expect(filesMatching(/\bpruneAuditLog\b/)).toEqual([
      'src/main/container.ts',
      'src/main/retentionSweeper.ts',
      'src/main/usecases.ts',
    ])
  })

  it('has the source walk find files at all, so an empty list is not mistaken for a clean one', () => {
    expect(productionSources().length).toBeGreaterThan(100)
    expect(filesMatching(/\bmakePruneAuditLog\b/)).toContain(
      'src/application/usecases/audit/pruneAuditLog.ts',
    )
  })
})
