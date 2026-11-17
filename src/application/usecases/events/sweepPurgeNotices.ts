import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import {
  daysLeftUntil,
  nextNotice,
  PURGE_NOTICE_LEVELS,
  type PurgeNoticeLevel,
} from '../../../domain/clients/purgeNotice'
import type { Event } from '../../../domain/events/event'
import { purgeNoticeMail, purgeNoticePageUrl } from '../../../domain/mail/purgeNoticeMail'
import type { EventId } from '../../../domain/shared/ids'
import { addDays } from '../../../domain/shared/time'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { PurgeNoticeLedger } from '../../ports/purgeNoticeLedger'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The warning before a purge (spec 22): the owners of an album that is about to be deleted are
 * written to at 14, 3 and 1 day before, so that nobody loses an album without having been told.
 *
 * **A convenience, never the way the host finds out.** The event's page shows the date all the
 * time; this is the nudge for the host who is not looking. Hence:
 *
 * - **Without a relay (`NullMailer`, the self-hoster's usual case) nothing is sent and nothing is
 *   noted.** A simulated send would note a threshold as served that nobody received, and the day
 *   an operator configured SMTP the owners would skip a warning. The page does the work.
 * - **The threshold is noted before the message is handed to the relay** (rule 9): a crash in
 *   between costs a lost message, never a second one. No acknowledgement, no reminder, no other
 *   address than the event's owners'.
 * - **Which events** is `listDueForPurge` asked with a clock moved 14 days on, "deadline at most
 *   now + 14 days" being the same question as "deadline at most now": the rule of the deadline
 *   stays written in one pair of places, not a third. An event the operator holds is never listed
 *   (so is never written about) and neither is one with no deadline; an album whose deadline has
 *   already arrived is the purge's business and gets no warning.
 * - **An album whose deadline shows up late gets the most urgent threshold that applies, once**,
 *   not the 14 and the 3 it has already passed (`nextNotice`).
 * - The mail carries no photograph, no caption and no guest's name (`purgeNoticeMail`).
 *
 * It never throws: one event's failure is data (`failed`) and does not stop the others, and it
 * runs after the purge in the retention follow-up, where a throw would replace the purge's own
 * outcome. It never changes what the purge did.
 */

/** The furthest threshold: events whose deadline is further than this are not looked at. */
const HORIZON_DAYS = Math.max(...PURGE_NOTICE_LEVELS)

export interface SweepPurgeNoticesReport {
  /** The events a threshold was noted for this run, with the threshold. */
  readonly noticed: readonly { readonly eventId: EventId; readonly level: PurgeNoticeLevel }[]
  /** Messages the relay accepted. */
  readonly sent: number
  /** Messages the relay refused or could not take: not retried, the page remains. */
  readonly unsent: number
  /** Events the sweep could not examine (a read failed). */
  readonly failed: readonly EventId[]
}

export interface SweepPurgeNoticesDeps {
  readonly events: Pick<EventRepository, 'listDueForPurge'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'listForEvent'>
  readonly notices: PurgeNoticeLedger
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `RETENTION_CAP_NOTICE_DAYS`, the same number the purge lists with. */
  readonly capNoticeDays: number
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
}

export type SweepPurgeNotices = () => Promise<SweepPurgeNoticesReport>

const NOTHING: SweepPurgeNoticesReport = { noticed: [], sent: 0, unsent: 0, failed: [] }

export const makeSweepPurgeNotices =
  ({
    events,
    clients,
    memberships,
    notices,
    mailer,
    clock,
    logger,
    capNoticeDays,
    publicUrl,
  }: SweepPurgeNoticesDeps): SweepPurgeNotices =>
  async () => {
    if (!mailer.canDeliver) return NOTHING

    const noticed: { eventId: EventId; level: PurgeNoticeLevel }[] = []
    const failed: EventId[] = []
    let sent = 0
    let unsent = 0

    const now = clock.now()

    let candidates: readonly Event[]
    try {
      candidates = await events.listDueForPurge(addDays(now, HORIZON_DAYS), { capNoticeDays })
    } catch (error) {
      logger.error('purge notices could not list the albums due', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NOTHING
    }

    for (const event of candidates) {
      try {
        const client = event.clientId === null ? null : await clients.findById(event.clientId)
        const deadline = purgeDeadline(event, client, capNoticeDays)
        if (deadline === null) continue

        const level = nextNotice(daysLeftUntil(deadline, now), await notices.lastLevel(event.id))
        if (level === null) continue

        // Noted first, whatever follows: see the file comment.
        await notices.note(event.id, level, now)
        noticed.push({ eventId: event.id, level })

        const owners = (await memberships.listForEvent(event.id)).filter(
          (member) => member.role === 'owner',
        )
        for (const owner of owners) {
          const to = EmailAddress.fromStored(owner.email)
          if (!to.ok) {
            unsent += 1
            continue
          }
          const result = await mailer.send(
            purgeNoticeMail({
              to: to.value,
              locale: client?.locale ?? event.settings.wallLanguage,
              eventName: event.name.value,
              deleteAt: deadline,
              pageUrl: purgeNoticePageUrl(publicUrl, event.slug.value),
            }),
          )
          if (result.ok) {
            sent += 1
          } else {
            unsent += 1
            logger.warn('a purge notice was not sent', {
              eventId: event.id,
              code: result.error.code,
            })
          }
        }
      } catch {
        failed.push(event.id)
      }
    }

    return { noticed, sent, unsent, failed }
  }
