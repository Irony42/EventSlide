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
 * - **Who**: the active accounts that own at least one client, **one mail per address**, never an address in copy. Read at each
 *   batch, so an account switched off meanwhile is not written to.
 * - **Noted first, then a place in the budget, then sent**: the delivery row is written first (the one that wrote it is the one
 *   that sends, so two sweepers never write to an account twice), then the mail takes one place in the day's budget
 *   (`MAIL_FOLLOWUP_MAX_PER_DAY`, family `announcement`, refusable). A **refusal takes the row back** (the account is still owed)
 *   and **stops the pass**: the rest goes on the next one, tomorrow if the day is full. A stored address that cannot be written to
 *   is noted as reached **without taking a place**. The operator's own words are not switchable by the host, and
 *   `HOST_MAIL_NOTICES` does not stop them.
 * - **A pass keeps sending batches** of {@link BATCH_SIZE} until the budget refuses, nobody is left owed, or {@link PASS_LIMIT_MS}
 *   is over: the next pass (or the next call, see below) goes on. A restart resumes with the accounts not yet reached.
 * - **A mail the relay refuses, or that throws, is that one address's**: counted `unsent`, logged by its code or the error's name,
 *   never retried, and the pass goes on. One address never marks an announcement failed.
 * - **One pass at a time.** A call that arrives while a pass runs (the operator's `kick` for a new announcement) is that pass's
 *   result **and asks for one more pass right after it**, so a new announcement starts at once instead of waiting for the hour.
 * - An announcement is **finished** (stamped, never reopened) once nobody is left owed. Without a relay nothing is read and
 *   nothing is stamped: the announcement waits.
 * - It never throws: an announcement that cannot be examined is `failed` and the others go on. The logs say counts, never an
 *   address and never the text.
 */

/** How many recipients one read takes. */
export const BATCH_SIZE = 100
/** How long one pass may go on sending, so a timer's pass never holds the process for a large audience. */
export const PASS_LIMIT_MS = 120_000

export interface SweepHostAnnouncementsReport {
  /** Mails the relay accepted. */
  readonly sent: number
  /** Mails the relay refused: noted, not retried. */
  readonly unsent: number
  /** Whether the day's budget stopped the pass. */
  readonly heldByBudget: boolean
  /** Whether the time limit stopped the pass. */
  readonly timedOut: boolean
  /** Announcements stamped as finished by this pass. */
  readonly finished: number
  /** Announcements this pass could not examine. */
  readonly failed: readonly string[]
}

export interface SweepHostAnnouncementsDeps {
  readonly announcements: Pick<
    HostAnnouncementRepository,
    'unfinished' | 'pendingRecipients' | 'recordDelivery' | 'forgetDelivery' | 'finish'
  >
  readonly budget: Pick<MailBudget, 'take'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** The operator's contact address, where a host's answer goes, `null` for none. */
  readonly operatorContact: EmailAddress | null
  /** Overrides {@link BATCH_SIZE}: for a test of the batching. */
  readonly batchSize?: number
  /** Overrides {@link PASS_LIMIT_MS}: for a test of the time limit. */
  readonly passLimitMs?: number
}

export type SweepHostAnnouncements = () => Promise<SweepHostAnnouncementsReport>

const NOTHING: SweepHostAnnouncementsReport = {
  sent: 0,
  unsent: 0,
  heldByBudget: false,
  timedOut: false,
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
  batchSize = BATCH_SIZE,
  passLimitMs = PASS_LIMIT_MS,
}: SweepHostAnnouncementsDeps): SweepHostAnnouncements => {
  let running: Promise<SweepHostAnnouncementsReport> | null = null
  let again = false

  const pass = async (): Promise<SweepHostAnnouncementsReport> => {
    if (!mailer.canDeliver) return NOTHING

    let sent = 0
    let unsent = 0
    let finished = 0
    let heldByBudget = false
    let timedOut = false
    const failed: string[] = []
    const deadline = clock.now().getTime() + passLimitMs

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
      if (heldByBudget || timedOut) break
      try {
        for (;;) {
          if (clock.now().getTime() >= deadline) {
            timedOut = true
            break
          }
          const recipients = await announcements.pendingRecipients(announcement.id, batchSize)
          if (recipients.length === 0) {
            // Nobody left owed: it is done, and stays done.
            await announcements.finish(announcement.id, clock.now())
            finished += 1
            break
          }
          let recorded = 0
          for (const recipient of recipients) {
            const now = clock.now()
            // Noted first: the one that wrote the row is the one that sends.
            if (!(await announcements.recordDelivery(announcement.id, recipient.userId, now)))
              continue
            recorded += 1
            const to = EmailAddress.fromStored(recipient.email)
            if (!to.ok) {
              // Reached as far as it ever will be, and it took no place in the day.
              unsent += 1
              continue
            }
            if (!(await budget.take(budgetDayOf(now), 1))) {
              // The day is full: this account is still owed, and the pass stops.
              await announcements.forgetDelivery(announcement.id, recipient.userId)
              heldByBudget = true
              break
            }
            try {
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
            } catch (error) {
              unsent += 1
              logger.error('a host announcement was not sent', {
                announcementId: announcement.id,
                error: error instanceof Error ? error.name : 'unknown',
              })
            }
          }
          if (heldByBudget) break
          // Every account of this batch was written to by someone else: nothing moved, so do not read the same batch again.
          if (recorded === 0) break
        }
      } catch (error) {
        failed.push(announcement.id)
        logger.error('a host announcement could not be examined', {
          announcementId: announcement.id,
          error: error instanceof Error ? error.name : 'unknown',
        })
      }
    }
    return { sent, unsent, heldByBudget, timedOut, finished, failed }
  }

  const chain = async (): Promise<SweepHostAnnouncementsReport> => {
    let report = await pass()
    while (again) {
      again = false
      report = await pass()
    }
    return report
  }

  // One pass at a time: the first batch started by the operator's request and the timer's pass never overlap, and a call that
  // arrived during a pass asks for one more right after it.
  return () => {
    if (running !== null) {
      again = true
      return running
    }
    running = chain().finally(() => {
      running = null
    })
    return running
  }
}
