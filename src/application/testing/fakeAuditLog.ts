import type { AuditEntry } from '../../domain/audit/auditEntry'
import type { AuditListFilter, AuditLog, AuditPage, AuditRecord } from '../ports/auditLog'

/**
 * An in-memory `AuditLog`, held to the same contract as the SQLite adapter.
 *
 * It enforces what the database enforces and a use case could otherwise get wrong without
 * a test noticing: a `limit` that is not a positive integer is refused (an unchecked
 * `slice(0, 0)` would answer an empty page where SQLite's `LIMIT -1` answers everything),
 * a cutoff that is not a real date is refused (`at < NaN` is `false`, so it would quietly
 * prune nothing where SQLite throws), and a sequence number is never handed out twice,
 * including after a prune, which is what `AUTOINCREMENT` is there for.
 *
 * Rows are stored oldest first in the order they were recorded, which *is* sequence order.
 */
export class FakeAuditLog implements AuditLog {
  private rows: AuditRecord[] = []
  private nextSeq = 1

  async record(entry: AuditEntry): Promise<void> {
    const props = entry.toProps()
    this.rows.push({
      seq: this.nextSeq,
      at: new Date(props.at.getTime()),
      actor: { ...props.actor },
      action: props.action,
      subject: { ...props.subject },
      clientId: props.clientId,
      details: JSON.parse(JSON.stringify(props.details)) as AuditRecord['details'],
    })
    this.nextSeq += 1
  }

  async list(filter: AuditListFilter): Promise<AuditPage> {
    if (!Number.isInteger(filter.limit) || filter.limit < 1) {
      throw new RangeError(`AuditLog.list requires a positive integer limit, got ${filter.limit}`)
    }

    const matching = this.rows
      .filter((row) => filter.clientId === undefined || row.clientId === filter.clientId)
      .filter((row) => filter.before === undefined || row.seq < filter.before)
      .reverse()

    const items = matching.slice(0, filter.limit)
    const last = items[items.length - 1]
    return {
      items,
      next: matching.length > filter.limit && last !== undefined ? last.seq : null,
    }
  }

  async pruneOlderThan(cutoff: Date): Promise<number> {
    if (!Number.isFinite(cutoff.getTime())) {
      throw new RangeError('AuditLog.pruneOlderThan requires a real cutoff date')
    }

    const kept = this.rows.filter((row) => row.at.getTime() >= cutoff.getTime())
    const removed = this.rows.length - kept.length
    this.rows = kept
    return removed
  }

  /** Every row, oldest first, for a test that wants to read the log without paging it. */
  all(): readonly AuditRecord[] {
    return [...this.rows]
  }
}
