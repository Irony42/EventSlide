import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, type Db } from './connection'
import { migratedDb } from './testing/sqliteSiteWorld'
import { asClientId, asUserId } from '../../domain/shared/ids'
import { SITE_OVERVIEW_QUERIES, SqliteSiteOverview, type DeclaredQuery } from './sqliteSiteOverview'

/**
 * Ring 3. **A query list per statement, compared with the statement's own text** (paid
 * plan P3-12: "chaque requête préparée déclare les colonnes qu'elle lit").
 *
 * The contract proves what comes *out* of the overview. This proves what the SQL *touches*,
 * which is the earlier and cheaper place to stop a leak: a column nobody declared cannot be
 * read by accident, and a content column cannot be declared by accident either.
 *
 * It reads the SQL as text — keywords and functions skipped, string literals and named
 * parameters removed, table aliases resolved from the `FROM` and `JOIN` clauses — and
 * compares what is left, in both directions:
 *
 * - every `table.column` the SQL names must be in `reads` (an undeclared read);
 * - every bare column the SQL names (`byte_size`, inside the shared byte-sum fragment) must
 *   be the name of a column in `reads`, and must **not** be a column whose name is also a
 *   content column elsewhere (`name`, `caption`…): those have to be written qualified, so
 *   which table's it is can be seen;
 * - every entry in `reads` must be named by the SQL (a stale declaration);
 * - every entry in `reads` must be a column that exists, on a table the overview may read,
 *   and not one of the content columns below, however it got there.
 *
 * **Why text and not `EXPLAIN`:** `EXPLAIN` lists the opcodes SQLite plans, whose shape is
 * an implementation detail of the query planner and changes with an index; the text is
 * what a reviewer sees in the diff, and the list sits beside it.
 */

/** The tables the overview may read at all. Anything else — `guests`, `event_missions`… — fails. */
const READABLE_TABLES = new Set([
  'clients',
  'client_members',
  'events',
  'photos',
  'clip_jobs',
  'users',
])

/**
 * Content-bearing columns, qualified, as a net behind the list (a qualified net, because an
 * unqualified `name` would also forbid `clients.name`, which the console must print).
 * Anything whose column name looks like a digest, a hash or a token is refused on top of it.
 */
const CONTENT_COLUMNS = new Set([
  'events.name',
  'events.slug',
  'events.join_code',
  'events.settings',
  'photos.id',
  'photos.caption',
  'photos.author_guest_id',
  'photos.author_user_id',
  'photos.reviewed_by_user_id',
  'photos.mission_id',
  'clip_jobs.id',
  'clip_jobs.photo_id',
  'clip_jobs.caption',
  'clip_jobs.author_guest_id',
  'clip_jobs.author_user_id',
  'clients.contact_email',
  'users.display_name',
])

const looksLikeASecret = (column: string): boolean => /hash|digest|token/.test(column)

/** Column names that are content *somewhere*: written bare, one could not tell whose. */
const SENSITIVE_BARE_NAMES = new Set([
  ...[...CONTENT_COLUMNS].map((qualified) => qualified.split('.')[1] ?? ''),
  'name',
  'email',
  'prompt',
  'content_hash',
  'poster_hash',
  'source_hash',
  'password_hash',
  'token_digest',
])

const SQL_WORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'null',
  'is',
  'as',
  'order',
  'by',
  'desc',
  'asc',
  'limit',
  'join',
  'left',
  'inner',
  'on',
  'in',
  'exists',
  'coalesce',
  'count',
  'max',
  'min',
  'sum',
  'case',
  'when',
  'then',
  'else',
  'end',
  'distinct',
  'json_each',
  'value',
])

interface References {
  readonly qualified: ReadonlySet<string>
  readonly bare: ReadonlySet<string>
  readonly unresolved: readonly string[]
  /** Every table named after `FROM` or `JOIN`, whether or not the list ever mentions it. */
  readonly fromTables: ReadonlySet<string>
  /** `SELECT *` or `e.*`: every column of a table, which no list can name. */
  readonly selectsEverything: boolean
}

/** What a statement names: `table.column` pairs, bare column names, and qualifiers it could not place. */
const referencesIn = (sql: string, tables: ReadonlySet<string>): References => {
  const cleaned = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/:[A-Za-z_]\w*/g, '')
    .toLowerCase()

  const aliasToTable = new Map<string, string>()
  const fromTables = new Set<string>()
  for (const match of cleaned.matchAll(
    /\b(?:from|join)\s+([a-z_]\w*)(?:\s+(?:as\s+)?([a-z_]\w*))?/g,
  )) {
    const table = match[1]
    const alias = match[2]
    // `json_each(…)` is a table-valued function, not a table: it is in SQL_WORDS.
    if (table !== undefined && !SQL_WORDS.has(table)) fromTables.add(table)
    if (table !== undefined && alias !== undefined && !SQL_WORDS.has(alias)) {
      aliasToTable.set(alias, table)
    }
  }
  // An output alias may not borrow the name of a content column: `… AS caption` would
  // otherwise make every bare `caption` in the statement look like a reference to itself.
  const outputAliases = new Set(
    [...cleaned.matchAll(/\bas\s+([a-z_]\w*)/g)]
      .map((match) => match[1] ?? '')
      .filter((alias) => !SENSITIVE_BARE_NAMES.has(alias)),
  )
  // `COUNT(*)` is the one star that names no column.
  const selectsEverything = /\*/.test(cleaned.replace(/count\s*\(\s*\*\s*\)/g, ''))

  const qualified = new Set<string>()
  const bare = new Set<string>()
  const unresolved: string[] = []
  for (const token of cleaned.match(/[a-z_]\w*(?:\.[a-z_]\w*)?/g) ?? []) {
    const [head = '', column] = token.split('.')
    if (column !== undefined) {
      const table = aliasToTable.get(head) ?? (tables.has(head) ? head : undefined)
      if (table === undefined) unresolved.push(token)
      else qualified.add(`${table}.${column}`)
      continue
    }
    if (SQL_WORDS.has(head) || tables.has(head) || aliasToTable.has(head)) continue
    if (outputAliases.has(head)) continue
    bare.add(head)
  }
  return { qualified, bare, unresolved, fromTables, selectsEverything }
}

/** Every way a declared query can be wrong; empty when its list and its text agree. */
const problemsWith = (
  query: DeclaredQuery,
  tables: ReadonlySet<string>,
  columnsOf: (table: string) => ReadonlySet<string>,
): readonly string[] => {
  const { qualified, bare, unresolved, fromTables, selectsEverything } = referencesIn(
    query.sql,
    tables,
  )
  const reads = new Set<string>(query.reads)
  const readNames = new Set([...reads].map((read) => read.split('.')[1] ?? ''))
  const problems: string[] = []

  if (selectsEverything) problems.push('selects *, which reads every column of a table')
  for (const table of fromTables) {
    if (!READABLE_TABLES.has(table)) problems.push(`reads from ${table}, a table it may not read`)
  }
  for (const token of unresolved) problems.push(`names ${token}, which resolves to no table`)
  for (const read of qualified) {
    if (!reads.has(read)) problems.push(`reads ${read}, which it does not declare`)
  }
  for (const name of bare) {
    if (SENSITIVE_BARE_NAMES.has(name)) {
      problems.push(`names ${name} without a table, and that name is content somewhere`)
    } else if (!readNames.has(name)) {
      problems.push(`names ${name}, which it does not declare`)
    }
  }
  for (const read of reads) {
    const [table = '', column = ''] = read.split('.')
    if (!qualified.has(read) && !bare.has(column)) {
      problems.push(`declares ${read}, which its SQL no longer touches`)
    }
    if (!READABLE_TABLES.has(table)) problems.push(`declares ${read}, on a table it may not read`)
    else if (!columnsOf(table).has(column)) problems.push(`declares ${read}, which is no column`)
    if (CONTENT_COLUMNS.has(read) || looksLikeASecret(column)) {
      problems.push(`declares ${read}, which carries content or a secret`)
    }
  }
  return problems
}

describe('the operator overview reads only the columns it declares', () => {
  let db: Db
  let tables: ReadonlySet<string>
  const columnsOf = (table: string): ReadonlySet<string> =>
    new Set(
      db
        .prepare<[string], { name: string }>(`SELECT name FROM pragma_table_info(?)`)
        .all(table)
        .map((column) => column.name),
    )

  beforeEach(() => {
    db = migratedDb()
    tables = new Set(
      db
        .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all()
        .map((table) => table.name),
    )
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it.each(Object.entries(SITE_OVERVIEW_QUERIES))(
    '%s names exactly the columns its list declares',
    (_name, query) => {
      expect(problemsWith(query, tables, columnsOf)).toEqual([])
    },
  )

  it('prepares no statement that is not in the declared list, constructing or calling', async () => {
    // "Every statement is listed" is otherwise a sentence: a `db.prepare` added to the
    // constructor, or inside a method, with no entry in the list is read by nothing above.
    const prepared: string[] = []
    const watched = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            prepared.push(sql)
            return target.prepare(sql)
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const overview = new SqliteSiteOverview(watched)
    const afterConstruction = prepared.length
    await overview.listClients({ limit: 1 })
    await overview.listClients({ limit: 1, after: asClientId('client-nobody') })
    await overview.clientEvents(asClientId('client-nobody'), { limit: 1 })
    await overview.listAccounts({ limit: 1 })
    await overview.listAccounts({ limit: 1, after: asUserId('user-nobody') })

    const declared = Object.values(SITE_OVERVIEW_QUERIES).map((query) => query.sql)
    expect([...prepared].sort()).toEqual([...declared].sort())
    expect(prepared.length, 'a statement was prepared by a method, not the constructor').toBe(
      afterConstruction,
    )
  })

  // ---------------------------------------------------- the check itself bites --
  //
  // A list-versus-text comparison that cannot fail is the failure this file exists to
  // prevent, so each way of being wrong is demonstrated on a statement of its own.

  const check = (sql: string, reads: readonly string[]): readonly string[] =>
    problemsWith({ sql, reads }, tables, columnsOf)

  it('accepts a statement whose text and list agree', () => {
    expect(check('SELECT c.id, c.name FROM clients c', ['clients.id', 'clients.name'])).toEqual([])
  })

  it('refuses a column the SQL reads and the list does not declare', () => {
    expect(check('SELECT e.id, e.status FROM events e', ['events.id'])).toEqual([
      'reads events.status, which it does not declare',
    ])
  })

  it('refuses an event name, even when the list was edited to declare it', () => {
    expect(check('SELECT e.id, e.name FROM events e', ['events.id', 'events.name'])).toEqual([
      'declares events.name, which carries content or a secret',
    ])
  })

  it('refuses a caption read inside a subquery, qualified or not', () => {
    expect(
      check(
        'SELECT e.id, (SELECT MAX(p.caption) FROM photos p WHERE p.event_id = e.id) FROM events e',
        ['events.id', 'photos.event_id'],
      ),
    ).toEqual(['reads photos.caption, which it does not declare'])
    expect(
      check('SELECT e.id, (SELECT caption FROM photos WHERE event_id = e.id) FROM events e', [
        'events.id',
        'photos.event_id',
      ]),
    ).toEqual(['names caption without a table, and that name is content somewhere'])
  })

  it('refuses a bare name that is content somewhere, which cannot be told apart from clients.name', () => {
    expect(check('SELECT c.id, name FROM clients c', ['clients.id', 'clients.name'])).toEqual([
      'names name without a table, and that name is content somewhere',
    ])
  })

  it('refuses a star, which reads every column of a table however the list reads', () => {
    expect(check('SELECT e.*, e.id FROM events e', ['events.id'])).toEqual([
      'selects *, which reads every column of a table',
    ])
    expect(check('SELECT * FROM users', ['users.id'])).toEqual([
      'selects *, which reads every column of a table',
      'declares users.id, which its SQL no longer touches',
    ])
  })

  it('accepts COUNT(*), the one star that names no column', () => {
    expect(
      check('SELECT (SELECT COUNT(*) FROM events ev WHERE ev.client_id = c.id) FROM clients c', [
        'events.client_id',
        'clients.id',
      ]),
    ).toEqual([])
  })

  it('refuses a content column hidden behind an alias of the same name', () => {
    expect(
      check(
        'SELECT e.id, (SELECT MAX(caption) FROM photos WHERE event_id = e.id) AS caption FROM events e',
        ['events.id', 'photos.event_id'],
      ),
    ).toEqual(['names caption without a table, and that name is content somewhere'])
  })

  it('refuses a table it may not read even when no list mentions it', () => {
    expect(
      check('SELECT e.id FROM events e JOIN guests g ON g.event_id = e.id', [
        'events.id',
        'guests.event_id',
      ]),
    ).toEqual(
      expect.arrayContaining([
        'reads from guests, a table it may not read',
        'declares guests.event_id, on a table it may not read',
      ]),
    )
    expect(
      check(
        'SELECT e.id, (SELECT COUNT(*) FROM event_missions m WHERE m.event_id = e.id) FROM events e',
        ['events.id'],
      ),
    ).toContain('reads from event_missions, a table it may not read')
  })

  it('refuses a stale declaration: a column the list names and the SQL no longer touches', () => {
    expect(check('SELECT c.id FROM clients c', ['clients.id', 'clients.suspended_at'])).toEqual([
      'declares clients.suspended_at, which its SQL no longer touches',
    ])
  })

  it('refuses a table the overview may not read at all', () => {
    expect(check('SELECT g.id FROM guests g', ['guests.id'])).toEqual([
      'reads from guests, a table it may not read',
      'declares guests.id, on a table it may not read',
    ])
  })

  it('refuses a hash or a digest or a token, whatever table it is on', () => {
    expect(
      check('SELECT u.id, u.password_hash FROM users u', ['users.id', 'users.password_hash']),
    ).toEqual(['declares users.password_hash, which carries content or a secret'])
    expect(
      check('SELECT p.id, p.content_hash FROM photos p', ['photos.id', 'photos.content_hash']),
    ).toEqual(
      expect.arrayContaining(['declares photos.content_hash, which carries content or a secret']),
    )
  })

  it('refuses a declaration that names no column that exists', () => {
    expect(check('SELECT c.idd FROM clients c', ['clients.idd'])).toEqual([
      'declares clients.idd, which is no column',
    ])
  })

  it('refuses a qualifier that is neither a table nor an alias', () => {
    expect(check('SELECT z.id FROM clients c', ['clients.id'])).toEqual([
      'names z.id, which resolves to no table',
      'declares clients.id, which its SQL no longer touches',
    ])
  })
})
