/**
 * The column conversions every SQLite repository in this folder repeats.
 *
 * The schema stores timestamps as ISO-8601 UTC `TEXT` and booleans as `INTEGER` 0/1,
 * because SQLite has neither type (see `migrations/001_initial_schema.ts`). Letting
 * each repository do that for itself is how 1.0 ended up with one table holding local
 * time and another holding epoch seconds, with no way to tell them apart in a dump.
 *
 * A value these functions cannot read is a corrupt database rather than a user error:
 * a repository is handed rows it wrote itself, so throwing surfaces the bug where it
 * happened instead of returning an `Invalid Date` that only fails three screens later.
 */

export const toIsoText = (date: Date): string => date.toISOString()

export const fromIsoText = (text: string): Date => {
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Corrupt timestamp in the database: ${JSON.stringify(text)}`)
  }
  return date
}

/** For the nullable columns: `starts_at`, `closed_at`, `revoked_at`, `reviewed_at`. */
export const fromNullableIsoText = (text: string | null): Date | null =>
  text === null ? null : fromIsoText(text)

export const toSqliteBoolean = (value: boolean): number => (value ? 1 : 0)

/**
 * Anything other than 0 reads as true. The columns carry a `CHECK (… IN (0, 1))`, and
 * comparing against 0 means a hand-edited 2 cannot become a silent `false` — which is
 * the direction that matters for flags like `must_change_password`.
 */
export const fromSqliteBoolean = (value: number): boolean => value !== 0
