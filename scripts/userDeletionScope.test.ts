import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * "Exactly two use cases delete an account" (migration 013, narrowed by 014), checked on the
 * source rather than trusted to review.
 *
 * An account is switched off (`users.disabled_at`) and kept, **except** in two places, both named
 * below: the operator's `deleteAccount`, which answers a person's erasure request (GDPR, G2-14 part
 * 3), and `finalizeOffboardedClients`, which the retention sweep runs for a client whose engagement
 * has ended. Migration 013 left the foreign keys that point at `users` without an index on the ground
 * that nothing deleted an account; 014 indexes them, and this test is what keeps the new ground true:
 * a use case, a route or a script that deletes an account anywhere else makes it red, and it points at
 * the allow-list so that widening it is a decision somebody makes on purpose and not a line nobody
 * read. The detector is exercised against a file outside the list below, so the allow-list is known to
 * bite and not only to be satisfied.
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

/**
 * The only files that delete an account, with what each does. **Widening this is the decision the
 * test exists for**: say in the pull request why a third place may delete an account, and add the
 * mutation that shows a fourth still cannot.
 */
const ALLOWED_DELETIONS: Readonly<Record<string, readonly string[]>> = {
  'src/application/usecases/clients/finalizeOffboardedClients.ts': ['users.delete(...)'],
  'src/application/usecases/site/deleteAccount.ts': ['users.delete(...)'],
  'src/infrastructure/db/sqliteUserRepository.ts': ['DELETE FROM users'],
}

interface Deletion {
  readonly path: string
  readonly found: readonly string[]
}

/** What is found in a file that the allow-list above does not name, or names for something else. */
const unexpectedDeletions = (deletions: readonly Deletion[]): readonly Deletion[] =>
  deletions.filter(
    ({ path, found }) => JSON.stringify(ALLOWED_DELETIONS[path] ?? []) !== JSON.stringify(found),
  )

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

  it('finds no deletion in the server or its scripts but the three the allow-list names, and finds those three', () => {
    const deletions = productionSources()
      .map((path) => ({
        path: relative(ROOT, path).replace(/\\/g, '/'),
        found: accountDeletions(path, readFileSync(path, 'utf8')),
      }))
      .filter(({ found }) => found.length > 0)

    expect(unexpectedDeletions(deletions)).toEqual([])
    // The list is also what is there: an entry for a file that no longer deletes is a stale
    // allowance, and a stale allowance is the one a new deletion would hide behind.
    expect(deletions.map(({ path }) => path).sort()).toEqual(Object.keys(ALLOWED_DELETIONS).sort())
  })

  it('reports a deletion in any other file, whatever the use case around it', () => {
    const elsewhere: Deletion = {
      path: 'src/application/usecases/auth/disableAccount.ts',
      found: accountDeletions('a.ts', 'await users.delete(userId)'),
    }

    expect(unexpectedDeletions([elsewhere])).toEqual([elsewhere])
  })

  it('reports a second deletion in a file that is allowed one, and a different one than the list names', () => {
    expect(
      unexpectedDeletions([
        {
          path: 'src/application/usecases/site/deleteAccount.ts',
          found: ['users.delete(...)', 'DELETE FROM users'],
        },
        { path: 'src/infrastructure/db/sqliteUserRepository.ts', found: ['users.delete(...)'] },
      ]),
    ).toHaveLength(2)
  })
})
