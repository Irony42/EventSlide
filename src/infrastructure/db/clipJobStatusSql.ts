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

/**
 * **The client byte sum, written once**: what every event of one client together has
 * spent, as an SQL expression (roadmap §10.5; `CLIENT_HOLDING_BYTES_SUM` in the paid plan).
 *
 * It is {@link eventHoldingBytesSum} summed over the client's events, **not a second
 * spelling of it**: the rule for what an event is charged (photographs of every status
 * plus the staged source of every clip still holding one) has one home, and a status added
 * to it reaches the client's total in the same edit. That is the whole reason this is a
 * `SUM` over a correlated call instead of two `JOIN`s that would restate the two tables.
 * `eventBytesSum.test.ts` holds it to the per-event number.
 *
 * `max_total_bytes` is enforced against this inside the same `.immediate()` transaction as
 * the event's own quota — `saveManyWithinLimits` for a photograph batch, `stage` for a clip
 * — and the dashboard and the operator's overview will read it too.
 *
 * @param clientIdExpr What the client id is spelled as at the call site: a named parameter
 *   (`:clientId`) for an admission, the outer row's column for a listing.
 * @param creditedClipJobExpr The transcode worker's credit, passed straight to the per-event
 *   sum — see {@link eventHoldingBytesSum}. A job belongs to exactly one event, so crediting
 *   it inside every event's sum credits it once, in the one event that holds it.
 *
 * Returns a parenthesised expression, not a statement: it goes inside a `SELECT` list.
 */
export const clientHoldingBytesSum = (clientIdExpr: string, creditedClipJobExpr?: string): string =>
  `(SELECT COALESCE(SUM(${eventHoldingBytesSum('ce.id', creditedClipJobExpr)}), 0)
      FROM events ce
     WHERE ce.client_id = ${clientIdExpr})`
