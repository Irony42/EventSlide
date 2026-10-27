/**
 * Code-unit order, not locale order: an id sort must not depend on the host's ICU.
 *
 * The domain's total orders (the playlist, the moderation queue, the reaction ranking) break a
 * tie on an id with it, so two machines holding the same rows agree on their order. It is also
 * what the test fakes use to stand in for SQLite, which orders a `TEXT` id by its bytes
 * (`BINARY` collation): `localeCompare` would put `a` before `B` where the database puts `B`
 * first, and a test that passes here would fail in CI on another locale.
 *
 * It compares UTF-16 code units, which is the byte order for the ASCII ids this application mints
 * (UUIDs, slugs, digests) and differs from UTF-8 only above U+E000, where no id goes.
 *
 * The tie direction is written at each call site, beside the sort it mirrors.
 */
export const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)
