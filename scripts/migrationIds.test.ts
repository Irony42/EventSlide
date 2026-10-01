import { describe, expect, it } from 'vitest'
import { migrations } from '../src/infrastructure/db/migrations'
import type { Migration } from '../src/infrastructure/db/migrator'

/**
 * The migration numbering rule (docs: `.claude/skills/eventslide-migration/SKILL.md`,
 * `CONTRIBUTING.md`), checked mechanically rather than trusted to review.
 *
 * Two or more branches routinely add "the next migration" in parallel — each one
 * correct in isolation, against whatever `main` looked like when the branch was cut.
 * The convention that keeps that honest is that the number is a placeholder until the
 * final rebase: whichever pull request merges last renumbers its migration to the
 * actual next integer, immediately before merging. Nothing in the type system enforces
 * that a human did this correctly, so this file is the enforcement: it fails loudly, by
 * name, the moment the ledger would otherwise go in with a hole, a collision, or a
 * parent read before it exists.
 *
 * `migrator.ts`'s own `assertWellFormed` already refuses a non-positive id and a
 * duplicate id at runtime — this file is stricter (contiguous, not just distinct) and
 * runs in CI rather than only at boot, and it adds the one check runtime cannot: a
 * migration that references a table before the migration that creates it exists. SQLite
 * does not reject that at `CREATE TABLE` time — `connection.ts:54` turns
 * `PRAGMA foreign_keys` on per connection, and that pragma is only consulted on a write,
 * so a forward reference passes every migration test that only checks the schema
 * applies, and fails for real the first time a guest's upload tries to insert a row.
 */

/**
 * Strips SQL comments before any text analysis below.
 *
 * Every migration in this codebase is heavily prose-commented (house style), and that
 * prose says things like "alongside a REFERENCES clause" in English sentences that are
 * not a foreign key. Scanning the raw SQL for the word `REFERENCES` would read "clause"
 * out of that sentence as a table name. Line comments and block comments are stripped
 * first so only statements SQLite itself would execute are considered a claim about
 * the schema.
 */
const withoutSqlComments = (sql: string): string =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Every table name in this schema is a bare, unquoted identifier (CLAUDE.md's own
// schema conventions never quote one), so that is the only shape matched.
const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
const REFERENCES = /REFERENCES\s+(\w+)/gi

const isString = (value: string | undefined): value is string => value !== undefined

/** Every table name a migration's SQL creates with `CREATE TABLE`. */
const tablesCreatedBy = (migration: Migration): string[] =>
  [...withoutSqlComments(migration.sql).matchAll(CREATE_TABLE)]
    .map((match) => match[1])
    .filter(isString)

/** Every table name a migration's SQL names in a `REFERENCES` clause, foreign key or not. */
const tablesReferencedBy = (migration: Migration): string[] =>
  [...withoutSqlComments(migration.sql).matchAll(REFERENCES)]
    .map((match) => match[1])
    .filter(isString)

/** The id of the migration that first creates each table, across the whole ledger. */
const creatorIdByTable = (all: readonly Migration[]): ReadonlyMap<string, number> => {
  const creators = new Map<string, number>()
  for (const migration of all) {
    for (const table of tablesCreatedBy(migration)) {
      const existing = creators.get(table)
      if (existing === undefined || migration.id < existing) creators.set(table, migration.id)
    }
  }
  return creators
}

describe('migration id assignment (scripts/migrationIds.test.ts)', () => {
  it('never reuses an id across two migrations', () => {
    const seen = new Map<number, string[]>()
    for (const migration of migrations) {
      seen.set(migration.id, [...(seen.get(migration.id) ?? []), migration.name])
    }
    const collisions = [...seen.entries()].filter(([, names]) => names.length > 1)

    expect(
      collisions,
      collisions
        .map(([id, names]) => `id ${id} is shared by ${names.join(', ')}`)
        .join('; '),
    ).toEqual([])
  })

  it('numbers migrations contiguously from 1, leaving no gap for a later merge to fill', () => {
    const ids = migrations.map((migration) => migration.id).sort((a, b) => a - b)
    const expected = ids.map((_, index) => index + 1)

    expect(ids, `ids were [${ids.join(', ')}], expected [${expected.join(', ')}]`).toEqual(
      expected,
    )
  })

  it('orders every migration no earlier than the tables its SQL references', () => {
    const creatorId = creatorIdByTable(migrations)
    const violations: string[] = []

    for (const migration of migrations) {
      for (const table of tablesReferencedBy(migration)) {
        const createdAt = creatorId.get(table)
        if (createdAt === undefined) {
          violations.push(
            `${String(migration.id).padStart(3, '0')}_${migration.name} references "${table}", ` +
              `which no migration creates`,
          )
        } else if (migration.id < createdAt) {
          violations.push(
            `${String(migration.id).padStart(3, '0')}_${migration.name} references "${table}", ` +
              `created only in migration ${createdAt} (a parent must carry the smaller id)`,
          )
        }
      }
    }

    expect(violations).toEqual([])
  })
})
