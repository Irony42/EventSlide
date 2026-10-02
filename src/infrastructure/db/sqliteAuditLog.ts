import type Database from 'better-sqlite3'
import type {
  AuditListFilter,
  AuditLog,
  AuditPage,
  AuditRecord,
} from '../../application/ports/auditLog'
import { isAuditActorKind } from '../../domain/audit/auditActor'
import type { AuditDetails } from '../../domain/audit/auditDetails'
import type { AuditEntry } from '../../domain/audit/auditEntry'
import { isAuditSubjectType } from '../../domain/audit/auditSubjectType'
import { asClientId, asUserId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `AuditLog` over SQLite (roadmap §10.8; paid plan P3-07).
 *
 * **Append-only is the schema's job, not this class's.** There is no `UPDATE` and no
 * `DELETE` here other than {@link SqliteAuditLog.pruneOlderThan}, and even that one is
 * refused by a trigger unless the permanent `audit_prune_gate` row says otherwise. A bug in
 * this adapter, or in any other code holding the connection, therefore cannot rewrite
 * history: see migration 009 for the three triggers and what each is for.
 *
 * `list` is keyset-paginated on `seq`, which is unique and strictly increasing, so a page
 * boundary can neither repeat a row nor skip one when entries are written between two
 * requests. `at` is never a cursor: two actions in the same millisecond are ordinary.
 */

interface AuditRow {
  readonly seq: number
  readonly at: string
  readonly actor_user_id: string | null
  readonly actor_kind: string
  readonly actor_label: string | null
  readonly action: string
  readonly subject_type: string
  readonly subject_id: string
  readonly client_id: string | null
  readonly details: string
}

const COLUMNS = `seq, at, actor_user_id, actor_kind, actor_label, action, subject_type,
                 subject_id, client_id, details`

/**
 * `detail` is a closed tag, **never the offending value**: this message reaches the error
 * log, and although an audit row carries no personal data by construction, a hand-edited
 * one is exactly the row that might.
 */
const corrupt = (column: string, detail: string): Error =>
  new Error(`Corrupt audit_log.${column} in the database: ${detail}`)

/**
 * Read back without re-running the allow-list: a row written under an older version of it
 * must stay readable by a newer one. The column's own `CHECK` already guarantees a JSON
 * object, so only a hand-edited file can fail here.
 */
const parseDetails = (text: string): AuditDetails => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw corrupt('details', 'not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw corrupt('details', 'not an object')
  }
  return parsed as AuditDetails
}

const toRecord = (row: AuditRow): AuditRecord => {
  if (!isAuditActorKind(row.actor_kind)) throw corrupt('actor_kind', 'unknown kind')
  if (!isAuditSubjectType(row.subject_type)) throw corrupt('subject_type', 'unknown type')

  return {
    seq: row.seq,
    at: fromIsoText(row.at),
    actor: {
      kind: row.actor_kind,
      userId: row.actor_user_id === null ? null : asUserId(row.actor_user_id),
      label: row.actor_label,
    },
    action: row.action,
    subject: { type: row.subject_type, id: row.subject_id },
    clientId: row.client_id === null ? null : asClientId(row.client_id),
    details: parseDetails(row.details),
  }
}

export class SqliteAuditLog implements AuditLog {
  private readonly insert: Database.Statement<{
    at: string
    actorUserId: string | null
    actorKind: string
    actorLabel: string | null
    action: string
    subjectType: string
    subjectId: string
    clientId: string | null
    details: string
  }>
  private readonly selectAll: Database.Statement<[number, number], AuditRow>
  private readonly selectForClient: Database.Statement<[string, number, number], AuditRow>
  private readonly openGate: Database.Statement<[]>
  private readonly closeGate: Database.Statement<[]>
  private readonly deleteBefore: Database.Statement<[string]>
  private readonly pruneInOneTransaction: (cutoffText: string) => number

  constructor(db: Db) {
    this.insert = db.prepare(
      `INSERT INTO audit_log (at, actor_user_id, actor_kind, actor_label, action, subject_type,
                              subject_id, client_id, details)
            VALUES (@at, @actorUserId, @actorKind, @actorLabel, @action, @subjectType,
                    @subjectId, @clientId, @details)`,
    )

    // `?` for the cursor is a bound, not a flag: an absent `before` is `Number.MAX_SAFE_INTEGER`
    // at the call site, which keeps each of the two statements a single plan.
    this.selectAll = db.prepare<[number, number], AuditRow>(
      `SELECT ${COLUMNS} FROM audit_log
        WHERE seq < ?
        ORDER BY seq DESC
        LIMIT ?`,
    )

    this.selectForClient = db.prepare<[string, number, number], AuditRow>(
      `SELECT ${COLUMNS} FROM audit_log
        WHERE client_id = ? AND seq < ?
        ORDER BY seq DESC
        LIMIT ?`,
    )

    this.openGate = db.prepare(`UPDATE audit_prune_gate SET open = 1 WHERE id = 1`)
    this.closeGate = db.prepare(`UPDATE audit_prune_gate SET open = 0 WHERE id = 1`)
    this.deleteBefore = db.prepare<[string]>(`DELETE FROM audit_log WHERE at < ?`)

    /**
     * Open the gate, delete, shut the gate: **one transaction**, so the committed state of
     * the database always has the gate shut. A failing `DELETE` rolls the gate back with
     * it, and a crash between the first statement and the last leaves nothing open — the
     * reason the switch is a permanent row inside the same transaction as the delete and
     * not a flag held in this process.
     *
     * Nested inside a caller's transaction `better-sqlite3` turns this into a savepoint,
     * which keeps the same guarantee.
     */
    this.pruneInOneTransaction = db.transaction((cutoffText: string): number => {
      this.openGate.run()
      const removed = this.deleteBefore.run(cutoffText).changes
      this.closeGate.run()
      return removed
    })
  }

  async record(entry: AuditEntry): Promise<void> {
    const props = entry.toProps()
    this.insert.run({
      at: toIsoText(props.at),
      actorUserId: props.actor.userId,
      actorKind: props.actor.kind,
      actorLabel: props.actor.label,
      action: props.action,
      subjectType: props.subject.type,
      subjectId: props.subject.id,
      clientId: props.clientId,
      details: JSON.stringify(props.details),
    })
  }

  async list(filter: AuditListFilter): Promise<AuditPage> {
    // `LIMIT -1` is "no limit" in SQLite and `LIMIT 0` is an empty page; neither is what a
    // caller who passed one of them meant, so neither reaches the database.
    if (!Number.isInteger(filter.limit) || filter.limit < 1) {
      throw new RangeError(`AuditLog.list requires a positive integer limit, got ${filter.limit}`)
    }

    const before = filter.before ?? Number.MAX_SAFE_INTEGER
    // One more than asked for: its presence is the only thing that says there is a next page.
    const rows =
      filter.clientId === undefined
        ? this.selectAll.all(before, filter.limit + 1)
        : this.selectForClient.all(filter.clientId, before, filter.limit + 1)

    const hasMore = rows.length > filter.limit
    const items = (hasMore ? rows.slice(0, filter.limit) : rows).map(toRecord)
    const last = items[items.length - 1]
    return { items, next: hasMore && last !== undefined ? last.seq : null }
  }

  async pruneOlderThan(cutoff: Date): Promise<number> {
    // `toIsoText` throws a `RangeError` for an invalid date, which is the right answer:
    // `at < 'Invalid Date'` would compare as text and delete every row.
    if (!Number.isFinite(cutoff.getTime())) {
      throw new RangeError('AuditLog.pruneOlderThan requires a real cutoff date')
    }
    return this.pruneInOneTransaction(toIsoText(cutoff))
  }
}
