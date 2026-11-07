import { addDays } from '../shared/time'
/**
 * When a finished book stops being served: `min(doneAt + ttl, purge date)`.
 *
 * The purge date only counts when it is **in the future of `doneAt`**. It is `null` for a
 * retention of "for ever", and already past when the purge is held (`purgeHeldAt`); the hold
 * does not shorten a reading, so the book then lives its whole `ttlDays`.
 */
export const bookExpiresAt = (doneAt: Date, ttlDays: number, purgeDate: Date | null): Date => {
  const ttlEnd = addDays(doneAt, ttlDays)
  if (purgeDate === null || purgeDate.getTime() <= doneAt.getTime()) return ttlEnd
  return purgeDate.getTime() < ttlEnd.getTime() ? purgeDate : ttlEnd
}

export const isBookExpired = (expiresAt: Date, now: Date): boolean =>
  expiresAt.getTime() <= now.getTime()
