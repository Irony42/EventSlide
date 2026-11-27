/** The operator is written to at most once an hour about signups (spec 31 section 5). */
export const SIGNUP_NOTICE_MIN_INTERVAL_MS = 60 * 60 * 1000

/**
 * Whether a notice may go now: none was sent yet, or the last one is at least an hour old. The count
 * of what happened in between is the use case's, so a throttled notice is not lost, only merged.
 */
export const signupNoticeDue = (lastSentAt: Date | null, now: Date): boolean =>
  lastSentAt === null || now.getTime() - lastSentAt.getTime() >= SIGNUP_NOTICE_MIN_INTERVAL_MS
