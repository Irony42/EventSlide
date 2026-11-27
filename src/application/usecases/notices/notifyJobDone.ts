import {
  eventPageUrl,
  jobDoneMail,
  type JobKind,
  type JobOutcome,
} from '../../../domain/mail/eventNoticeMails'
import { jobWorthAMail } from '../../../domain/notices/eventNotices'
import { isFresh } from '../../../domain/notices/noticeFreshness'
import type { EventId, UserId } from '../../../domain/shared/ids'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository } from '../../ports/userRepository'
import { deliverNotice } from './noticeDelivery'

/**
 * Telling the host that a long job is over (spec 32, A2): the archive, the photo book or the highlight film is ready, or
 * could not be made.
 *
 * A builder hands the end of a job to this **after its final transition** and never waits for it: the mail is a completion
 * that catches everything (the reads included), so a relay that is down, a ledger that cannot be written or an event that
 * vanished never breaks the worker, and nothing rejects in the background.
 *
 * - **Only a job that took more than two minutes** (`jobWorthAMail`): the host who clicked and waited on the page needs no mail.
 * - **Family `event`**: an owner who switched it off is not written to, and `HOST_MAIL_NOTICES=off` sends nothing. Never held
 *   back for quiet hours (a host who left is waiting for it), counted in the day's budget like every family notice.
 * - **Noted before sent**, under the key `<job>@<requested_at>`: a job put back in the queue at boot and finished twice
 *   sends one mail.
 * - **Who**: for an archive, the owner who asked for it when they are still an active owner, else the owners; for a book and a
 *   film (nobody asked by name), the owners. Read at the moment of sending.
 * - **An event the operator took down, of a suspended client or of a client being closed** gets nothing.
 * - Without a relay nothing is read and nothing is noted.
 */

export interface JobFinished {
  readonly job: JobKind
  readonly eventId: EventId
  /** The instant the job was asked for: the ledger key and the start of the two minutes. */
  readonly requestedAt: Date
  /** Who asked, when the job knows (the archive does), else `null`. */
  readonly requestedBy: UserId | null
  readonly outcome: JobOutcome
  readonly finishedAt: Date
}

/** What a builder is given: the end of a job, nothing else. Never awaited, never throws. */
export type JobFinishedHook = (finished: JobFinished) => void

export interface NotifyJobDone {
  readonly notify: JobFinishedHook
  /** Resolves when every mail started so far is over. For a test; nothing in the product waits for it. */
  idle(): Promise<void>
}

export interface NotifyJobDoneDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly notices: EventMailNoticeLedger
  readonly budget: Pick<MailBudget, 'take' | 'count'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
  /** `HOST_MAIL_NOTICES` is not `off`. */
  readonly hostMailNotices: boolean
}

/** Where the host finds the result of each job. */
const PAGE_OF: Readonly<Record<JobKind, string>> = {
  archive: 'album',
  book: 'book',
  reel: 'best-of',
}

export const makeNotifyJobDone = (deps: NotifyJobDoneDeps): NotifyJobDone => {
  const { events, clients, memberships, mailer, clock, logger, publicUrl, hostMailNotices } = deps
  const inFlight = new Set<Promise<void>>()

  const run = async (finished: JobFinished): Promise<void> => {
    if (!hostMailNotices || !mailer.canDeliver) return
    if (!jobWorthAMail(finished.requestedAt, finished.finishedAt)) return
    const event = await events.findById(finished.eventId)
    if (event === null || event.isTakenDown() || event.isClientSuspended()) return
    const client = event.clientId === null ? null : await clients.findById(event.clientId)
    if (client?.isOffboarding() === true) return

    const owners = await memberships.ownersToNotify(finished.eventId)
    const asker = owners.filter((owner) => owner.userId === finished.requestedBy)
    const recipients = finished.job === 'archive' && asker.length > 0 ? asker : owners
    const now = clock.now()
    const locale = client?.locale ?? event.settings.wallLanguage
    const eventName = event.name.value
    const pageUrl = eventPageUrl(publicUrl, event.slug.value, PAGE_OF[finished.job])

    await deliverNotice(deps, {
      eventId: finished.eventId,
      kind: 'jobDone',
      key: `${finished.job}@${finished.requestedAt.toISOString()}`,
      family: 'event',
      owners: recipients,
      fresh: isFresh('jobDone', finished.finishedAt, now),
      quiet: false,
      now,
      build: (to) =>
        jobDoneMail({
          to,
          locale,
          eventName,
          pageUrl,
          job: finished.job,
          outcome: finished.outcome,
        }),
    })
  }

  return {
    notify: (finished) => {
      const work = run(finished).catch((error: unknown) => {
        // The name of the failure, never its message: a message may carry an address.
        logger.error('a job notice failed', {
          job: finished.job,
          error: error instanceof Error ? error.name : 'unknown',
        })
      })
      inFlight.add(work)
      void work.finally(() => inFlight.delete(work))
    },
    idle: async () => {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}
