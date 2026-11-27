import { hostAnnouncementMail } from '../../../domain/mail/hostAnnouncementMail'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Clock } from '../../ports/clock'
import type { HostAnnouncementRepository } from '../../ports/hostAnnouncementRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'

/**
 * Sends the announcements the operator wrote to the hosts (spec 32, lot 2, A8), **by batches, within the day's budget**.
 *
 * - **Who**: the active accounts that own at least one client, **one mail each** (an address belongs to one account), never an
 *   address in copy. Read at each batch, so an account switched off meanwhile is not written to.
 * - **Family `announcement`, refusable**: every mail takes one place in the day's budget (`MAIL_FOLLOWUP_MAX_PER_DAY`) **before**
 *   it is noted and sent; a refusal **stops the pass** and the rest goes on the next one, tomorrow if the day is full. The
 *   operator's own words are not switchable by the host, and `HOST_MAIL_NOTICES` does not stop them.
 * - **Noted before sent, and resumable**: a delivery row is written before the relay is handed the mail, so a restart that
 *   interrupts a sending resumes with the accounts not yet reached, and **no account is ever written to twice**. A mail the
 *   relay refuses is logged by its code and not retried.
 * - **A pass sends at most {@link BATCH_PER_PASS} mails** so that a large audience is spread over the passes, and an
 *   announcement is **finished** (stamped, never reopened) once nobody is left owed.
 * - Without a relay nothing is read and nothing is stamped: the announcement waits.
 * - It never throws: an announcement that cannot be examined is `failed` and the others go on. The logs say counts, never an
 *   address and never the text.
 */

/** The most mails one pass sends, across announcements. */
export const BATCH_PER_PASS = 100

export interface SweepHostAnnouncementsReport {
  /** Mails the relay accepted. */
  readonly sent: number
  /** Mails the relay refused: noted, not retried. */
  readonly unsent: number
  /** Whether the day's budget stopped the pass. */
  readonly heldByBudget: boolean
  /** Announcements stamped as finished by this pass. */
  readonly finished: number
  /** Announcements this pass could not examine. */
  readonly failed: readonly string[]
}

export interface SweepHostAnnouncementsDeps {
  readonly announcements: Pick<
    HostAnnouncementRepository,
    'unfinished' | 'pendingRecipients' | 'recordDelivery' | 'finish'
  >
  readonly budget: Pick<MailBudget, 'take'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** The operator's contact address, where a host's answer goes, `null` for none. */
  readonly operatorContact: EmailAddress | null
  /** Overrides {@link BATCH_PER_PASS}: for a test of the batching. */
  readonly batchPerPass?: number
}

export type SweepHostAnnouncements = () => Promise<SweepHostAnnouncementsReport>

const NOTHING: SweepHostAnnouncementsReport = {
  sent: 0,
  unsent: 0,
  heldByBudget: false,
  finished: 0,
  failed: [],
}

export const makeSweepHostAnnouncements = ({
  announcements,
  budget,
  mailer,
  clock,
  logger,
  operatorContact,
  batchPerPass = BATCH_PER_PASS,
}: SweepHostAnnouncementsDeps): SweepHostAnnouncements => {
  let running: Promise<SweepHostAnnouncementsReport> | null = null

  const pass = async (): Promise<SweepHostAnnouncementsReport> => {
    if (!mailer.canDeliver) return NOTHING

    let sent = 0
    let unsent = 0
    let finished = 0
    let heldByBudget = false
    const failed: string[] = []
    let room = batchPerPass

    let pending
    try {
      pending = await announcements.unfinished()
    } catch (error) {
      logger.error('host announcements could not be listed', {
        error: error instanceof Error ? error.name : 'unknown',
      })
      return NOTHING
    }

    for (const announcement of pending) {
      if (heldByBudget || room === 0) break
      try {
        const recipients = await announcements.pendingRecipients(announcement.id, room)
        for (const recipient of recipients) {
          const now = clock.now()
          // A place in the day's budget first: a refusal stops the pass, the rest goes on tomorrow.
          if (!(await budget.take(budgetDayOf(now), 1))) {
            heldByBudget = true
            break
          }
          // Noted before sent: the one that wrote the row is the one that sends.
          if (!(await announcements.recordDelivery(announcement.id, recipient.userId, now)))
            continue
          room -= 1
          const to = EmailAddress.fromStored(recipient.email)
          if (!to.ok) {
            unsent += 1
            continue
          }
          const result = await mailer.send(
            hostAnnouncementMail({ to: to.value, announcement, replyTo: operatorContact }),
          )
          if (result.ok) {
            sent += 1
          } else {
            unsent += 1
            logger.warn('a host announcement was not sent', {
              announcementId: announcement.id,
              code: result.error.code,
            })
          }
        }
        if (heldByBudget) break
        // Nobody left owed: it is done, and stays done.
        if ((await announcements.pendingRecipients(announcement.id, 1)).length === 0) {
          await announcements.finish(announcement.id, clock.now())
          finished += 1
        }
      } catch (error) {
        failed.push(announcement.id)
        logger.error('a host announcement could not be examined', {
          announcementId: announcement.id,
          error: error instanceof Error ? error.name : 'unknown',
        })
      }
    }
    return { sent, unsent, heldByBudget, finished, failed }
  }

  // One pass at a time: the first batch started by the operator's request and the timer's pass never overlap.
  return () => {
    running ??= pass().finally(() => {
      running = null
    })
    return running
  }
}
