/**
 * Code-unit order, not locale order: an id sort must not depend on the host's ICU.
 *
 * SQLite orders a `TEXT` id by its bytes (`BINARY` collation), so a fake that stands in for
 * one has to as well. `localeCompare` would put `a` before `B` where the database puts `B`
 * first, and would answer differently on a machine with another locale, which is a test that
 * passes here and fails in CI.
 *
 * Every fake that breaks a tie on an id uses this one function, in the direction its adapter's
 * `ORDER BY` states: the tie direction is written at the call site, beside the sort it mirrors.
 */
export const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)
