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
