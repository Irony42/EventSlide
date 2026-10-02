import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
 * **It reads the syntax tree, not the text.** A comment that *names* a thing is prose, not a
 * use of it, and a regular expression that strips comments is wrong in exactly the files
 * where it matters: a glob inside a string that happens to contain a star-slash makes the
 * expression eat everything up to the next real comment end. So the identifiers and the
 * string literals of every file are collected from the parser, and comments never reach
 * them. A bracket call (`log['pruneOlderThan'](cutoff)`) and a call broken over two lines
 * are found as the name they are.
 *
 * What it cannot find is a name assembled at runtime. That is the honest limit of a static
 * check, and the reason §17 of docs/SECURITY.md says the gate guards against code that does
 * not know about it, not against code written to get round it.
 *
 * Tests are excluded: a test is allowed to open the gate by hand, that is how it proves the
 * database refuses everyone else. So are the fakes and contract suites under `testing/`,
 * which exist to call these things from outside.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return [path]
  })

interface Names {
  readonly path: string
  readonly identifiers: ReadonlySet<string>
  readonly literals: readonly string[]
}

const namesIn = (path: string): Names => {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const identifiers = new Set<string>()
  const literals: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return { path: relative(ROOT, path).replace(/\\/g, '/'), identifiers, literals }
}

/**
 * Every file the server and its tools are built from, slash-separated: not a test, and not
 * a test double or a contract suite (`testing/`).
 */
const productionSources = (): Names[] =>
  [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
    .filter((path) => /\.(m?ts|m?js|cjs)$/.test(path) && !/\.(test|spec)\.[mc]?[jt]s$/.test(path))
    .filter((path) => !/[\\/]testing[\\/]/.test(path))
    .map(namesIn)

/** Files that use `name` as an identifier, or inside a string such as SQL or an import path. */
const filesNaming = (name: string): string[] =>
  productionSources()
    .filter(
      ({ identifiers, literals }) =>
        identifiers.has(name) || literals.some((literal) => literal.includes(name)),
    )
    .map(({ path }) => path)
    .sort()

describe('the audit log can be pruned only through the pruning use case', () => {
  it('names the retention gate in the adapter and its migration, and nowhere else', () => {
    expect(filesNaming('audit_prune_gate')).toEqual([
      'src/infrastructure/db/migrations/009_audit_log.ts',
      'src/infrastructure/db/sqliteAuditLog.ts',
    ])
  })

  it('mentions AuditLog.pruneOlderThan only where it is declared, implemented and called', () => {
    expect(filesNaming('pruneOlderThan')).toEqual([
      'src/application/ports/auditLog.ts',
      'src/application/usecases/audit/pruneAuditLog.ts',
      'src/infrastructure/db/sqliteAuditLog.ts',
    ])
  })

  it('reaches the pruning use case from the composition root and the retention sweep, and from no route', () => {
    expect(filesNaming('pruneAuditLog')).toEqual([
      'src/main/container.ts',
      'src/main/retentionSweeper.ts',
      'src/main/usecases.ts',
    ])
  })

  it('has the walk find files at all, so an empty list is not mistaken for a clean one', () => {
    expect(productionSources().length).toBeGreaterThan(100)
    expect(filesNaming('makePruneAuditLog')).toContain(
      'src/application/usecases/audit/pruneAuditLog.ts',
    )
  })

  it('does not mistake a comment for a use: this very file names all three things and is not listed', () => {
    const listed = [
      ...filesNaming('audit_prune_gate'),
      ...filesNaming('pruneOlderThan'),
      ...filesNaming('pruneAuditLog'),
    ]

    expect(listed.some((path) => path.startsWith('scripts/'))).toBe(false)
  })
})
