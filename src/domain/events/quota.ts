/**
 * The two limits an event puts on ingest, as arithmetic over plain numbers.
 *
 * They live here, and not only as methods on {@link Event}, because each decision has
 * to be taken **twice** and the two answers must be identical:
 *
 * 1. by the use case, against the usage it read before rendering anything — the cheap
 *    check that refuses a file without decoding it;
 * 2. inside the repository's write transaction, where there is no aggregate to ask —
 *    only rows, a `SUM` and a `COUNT`.
 *
 * The second is the one that actually enforces the limit, because it is the only one
 * nothing can interleave with. Two implementations of the same comparison is how the
 * enforcing check and the advertised one drift apart, so there is one.
 */

/**
 * Clamped at zero. Usage can legitimately exceed the quota — the host lowered it after
 * the party — and a negative "remaining" shown to a guest, or fed back into this
 * arithmetic, is worse than an honest nothing left.
 */
export const remainingQuota = (quotaBytes: number, usedBytes: number): number =>
  Math.max(0, quotaBytes - usedBytes)

/** Whether `additionalBytes` more still fits under `quotaBytes`. */
export const fitsInQuota = (
  quotaBytes: number,
  usedBytes: number,
  additionalBytes: number,
): boolean => additionalBytes <= remainingQuota(quotaBytes, usedBytes)

/**
 * Whether an author holding `already` photos may add one more.
 *
 * `null` is no cap at all, which is the default: the limit is a fairness tool between
 * guests, not a storage control. Storage is the byte quota's job.
 */
export const allowsAnotherPhoto = (maxPhotosPerGuest: number | null, already: number): boolean =>
  maxPhotosPerGuest === null || already < maxPhotosPerGuest
