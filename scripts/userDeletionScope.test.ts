import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * "No code path deletes an account" (migration 013), checked on the source rather than
 * trusted to review.
 *
 * An account is switched off (`users.disabled_at`) and kept. `migrator.test.ts` leaves the
 * foreign keys that point at `users` without an index on that ground (its
 * `PARENTS_NEVER_DELETED`), because deleting a `users` row is the only thing that looks
 * their children up. That ground is a sentence until something fails when it stops being
 * true, and this is that something: the day a use case, a route or a script deletes an
 * account, this test goes red and points at the allow-list and at migration 013, which is
 * where the indexes come from.
 *
 * It reads the syntax tree, as `auditPruneScope.test.ts` does, so a comment that names the
 * call is prose. It finds a call to a method named `delete` on something called `users`,
 * `userRepository` or `userRepo`, and the SQL text `DELETE FROM users`. It cannot find a
 * repository passed under another name; that is the limit of a static check, and the
 * reason this is a tripwire for the obvious spelling and not a proof.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const RECEIVER = /^(users|userRepository|userRepo)$/i
const USERS_SQL = /DELETE\s+FROM\s+users\b/i

/** What a source file does that deletes an account: a `.delete(` on a users repository, or SQL. */
const accountDeletions = (path: string, text: string): string[] => {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'delete'
    ) {
      const receiver = node.expression.expression
      const name = ts.isIdentifier(receiver)
        ? receiver.text
        : ts.isPropertyAccessExpression(receiver)
          ? receiver.name.text
          : ''
      if (RECEIVER.test(name)) found.push(`${name}.delete(...)`)
    } else if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node)) &&
      USERS_SQL.test(node.text)
    ) {
      found.push('DELETE FROM users')
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true))
  return found
}

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return [path]
  })

/** The files the server and its tools are built from: not a test, not a double (`testing/`). */
const productionSources = (): string[] =>
  [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
    .filter((path) => /\.(m?ts|m?js|cjs)$/.test(path) && !/\.(test|spec)\.[mc]?[jt]s$/.test(path))
    .filter((path) => !/[\\/]testing[\\/]/.test(path))

describe('no code path deletes an account', () => {
  it('sees a delete on a users repository, however the receiver is reached, and the SQL', () => {
    expect(accountDeletions('a.ts', 'await users.delete(id)')).toEqual(['users.delete(...)'])
    expect(accountDeletions('a.ts', 'await deps.users.delete(id)')).toEqual(['users.delete(...)'])
    expect(accountDeletions('a.ts', 'await this.userRepository.delete(id)')).toEqual([
      'userRepository.delete(...)',
    ])
    expect(accountDeletions('a.ts', 'db.prepare(`DELETE FROM users WHERE id = ?`)')).toEqual([
      'DELETE FROM users',
    ])
  })

  it('does not take prose, a method declaration or another repository for a deletion', () => {
    expect(
      accountDeletions(
        'a.ts',
        `// users.delete(id) is never called
         class R { async delete(id: string) { return id } }
         await guests.delete(eventId, guestId)
         await photos.delete(eventId, photoId)`,
      ),
    ).toEqual([])
  })

  it('finds none in the server or its scripts, except the adapter that implements the port', () => {
    const deletions = productionSources()
      .map((path) => ({
        path: relative(ROOT, path).replace(/\\/g, '/'),
        found: accountDeletions(path, readFileSync(path, 'utf8')),
      }))
      .filter(({ found }) => found.length > 0)

    expect(deletions).toEqual([
      { path: 'src/infrastructure/db/sqliteUserRepository.ts', found: ['DELETE FROM users'] },
    ])
  })
})
