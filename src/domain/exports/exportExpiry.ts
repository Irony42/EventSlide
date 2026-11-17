import { addDays } from '../shared/time'

/** How long an archive lives once it has been sent in full: long enough to repeat a failed download. */
export const EXPORT_SERVED_GRACE_MS = 48 * 60 * 60 * 1000

export interface ExportExpiryInput {
  readonly sealedAt: Date
  /** The last complete send, or `null` when it was never sent in full. */
  readonly servedAt: Date | null
  /** The album's purge date; `null` for a retention of "for ever". */
  readonly deadline: Date | null
  readonly ttlDays: number
}

/**
 * When a sealed archive stops being served and is deleted: **the first of three dates**
 * (spec 22, rule 2): `EXPORT_TTL_DAYS` after it was sealed, 48 hours after it was sent in full, and
 * the album's own deadline. It never has a life of its own after the purge.
 *
 * The deadline only counts when it is **in the future of the instant it is measured from** (the
 * seal, or the send once there is one). It is `null` for a retention of "for ever" and already past
 * when the purge is held; a hold does not shorten a reading, so the archive then lives its ttl.
 */
export const exportExpiresAt = ({
  sealedAt,
  servedAt,
  deadline,
  ttlDays,
}: ExportExpiryInput): Date => {
  const from = servedAt ?? sealedAt
  const candidates: Date[] = [addDays(sealedAt, ttlDays)]
  if (servedAt !== null) candidates.push(new Date(servedAt.getTime() + EXPORT_SERVED_GRACE_MS))
  if (deadline !== null && deadline.getTime() > from.getTime()) candidates.push(deadline)
  return new Date(Math.min(...candidates.map((date) => date.getTime())))
}

export const isExportExpired = (expiresAt: Date, now: Date): boolean =>
  expiresAt.getTime() <= now.getTime()
