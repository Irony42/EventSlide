import { MS_PER_DAY } from '../shared/time'
import type { NoticeKind } from './noticeKind'

/**
 * How long a notice stays worth sending (spec 32, principle 7). Past it, the notice is **noted as
 * served without being sent**: a box updated after months, a relay down for a week or a daily ceiling
 * reached several days running never sends the summary of replies already erased, nor an "after the
 * party" for an album that is gone.
 *
 * Each value is an offset from the instant the notice is about (its `trigger`):
 *
 * | kind           | trigger                                       | stays valid until           |
 * | -------------- | --------------------------------------------- | --------------------------- |
 * | `rsvpErasure`  | the erasure instant                           | that instant                |
 * | `rsvpDeadline` | the instant replies stop                      | that instant                |
 * | `rsvpStopped`  | the instant replies stopped (the deadline)    | 24 hours after it           |
 * | `rsvpFull`     | the instant the house filled (latest `yes`)   | 24 hours after it           |
 * | `eventClosed`  | the instant the event closed                  | 48 hours after it           |
 * | `windowEnding` | the end of the live window                    | that instant                |
 * | `jobDone`      | the instant the job finished                  | 24 hours after it           |
 */
const VALID_FOR_MS: Readonly<Record<NoticeKind, number>> = {
  rsvpErasure: 0,
  rsvpDeadline: 0,
  rsvpStopped: MS_PER_DAY,
  rsvpFull: MS_PER_DAY,
  eventClosed: 2 * MS_PER_DAY,
  windowEnding: 0,
  jobDone: MS_PER_DAY,
}

/** The first instant at which the notice is no longer worth sending. */
export const freshUntil = (kind: NoticeKind, trigger: Date): Date =>
  new Date(trigger.getTime() + VALID_FOR_MS[kind])

/** Whether the notice may still go out: strictly before {@link freshUntil}. */
export const isFresh = (kind: NoticeKind, trigger: Date, now: Date): boolean =>
  now.getTime() < freshUntil(kind, trigger).getTime()
