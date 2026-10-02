import {
  CLIP_JOB_STATUSES,
  blocksReupload,
  holdsStagedBytes,
} from '../../domain/clips/clipJobStatus'

/**
 * The two status sets, rendered once, from the domain predicates that define them.
 *
 * Every live query about the queue asks one of two questions — "is this job still holding
 * bytes?" and "does this job block the same upload?" — and each was spelled out as a
 * literal `IN` list in three or four statements. That is one rule with six spellings, and
 * the failure mode is silent: a status added to `CLIP_JOB_STATUSES` and to one predicate
 * would be counted by the quota and ignored by the backpressure count, or blocked by the
 * unique index and invisible to the dedupe. Deriving both lists from the predicates means
 * there is one place to be wrong.
 *
 * **The migrations deliberately do not use these.** A migration is append-only and has to
 * mean the same thing for ever, so its `CHECK` and its partial indexes carry frozen
 * literals; `migrator.test.ts` pins those literals against these sets, which is what turns
 * "they agree today" into a test rather than a hope.
 */

const quoted = (statuses: readonly string[]): string =>
  statuses.map((status) => `'${status}'`).join(', ')

/** Statuses whose staged source is still on the disk, and still charged to the quota. */
export const HOLDING_BYTES_SQL = quoted(CLIP_JOB_STATUSES.filter(holdsStagedBytes))

/** Statuses that stop the same bytes being staged again — the partial unique index's set. */
export const BLOCKING_REUPLOAD_SQL = quoted(CLIP_JOB_STATUSES.filter(blocksReupload))

/**
 * **The event byte sum, written once**: what an event has spent, as an SQL expression.
 *
 * Photographs of every status **plus** the staged source of every clip that still holds one
 * ({@link HOLDING_BYTES_SQL}). A source is on the disk from the moment its row exists and
 * has no `photos` row until the transcode succeeds, so a sum over `photos` alone
 * under-reports an event by the whole contents of its queue, and the byte quota is exactly
 * "what is on the disk for this event".
 *
 * It used to be spelled out per reader, and the reader that disagreed was the one the host
 * sees: the upload paths (`SqlitePhotoRepository`, `SqliteClipJobRepository`) summed both
 * tables, and the dashboard (`SqliteEventRepository`) summed photographs only, so an event
 * could show a gigabyte free and refuse the next upload as full. Every reader — the
 * dashboard row, both admissions, and the operator's overview and the per-client ceiling
 * that come with roadmap §10.4–§10.5 — builds from this function, and
 * `eventBytesSum.test.ts` is what holds them to one number.
 *
 * @param eventIdExpr What the event id is spelled as at the call site: a named parameter
 *   (`:eventId`) for an admission, the outer row's column (`e.id`) for a listing.
 * @param creditedClipJobExpr Optional, for the transcode worker alone: a clip job whose
 *   own staged source is **not** charged, because its output is being inserted while it is
 *   still `running`. Spelled `IS NOT`, which is the null-safe comparison — bound to NULL it
 *   is `id IS NOT NULL`, true of every row, so one statement serves both callers.
 *
 * Returns a parenthesised expression, not a statement: it goes inside a `SELECT` list.
 */
export const eventHoldingBytesSum = (eventIdExpr: string, creditedClipJobExpr?: string): string => {
  const credited = creditedClipJobExpr === undefined ? '' : ` AND id IS NOT ${creditedClipJobExpr}`
  return `((SELECT COALESCE(SUM(byte_size), 0) FROM photos WHERE event_id = ${eventIdExpr})
       + (SELECT COALESCE(SUM(source_byte_size), 0)
            FROM clip_jobs
           WHERE event_id = ${eventIdExpr} AND status IN (${HOLDING_BYTES_SQL})${credited}))`
}
