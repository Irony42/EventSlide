import { eventPageUrl, invitationAcceptedMail } from '../../../domain/mail/eventNoticeMails'
import type { InvitedRole } from '../../../domain/mail/eventNoticeMails'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * Telling the host that somebody accepted their invitation to an event (spec 32, A6).
 *
 * `acceptInvitation` hands this the acceptance **after its transaction** and never waits for it: the mail is a completion
 * that catches everything, so a relay that is down never touches the acceptance and nothing rejects in the background.
 *
 * - **To the account that wrote the invitation** (`created_by`) and to nobody else, when it still exists, is **still an active
 *   owner** of the event (read now), has not switched the `event` family off, and is not the account that just accepted.
 * - **Sent at once** (no quiet hours: somebody is waiting to be let in) and **never noted**: the acceptance itself is the guard
 *   (a link is spent once). It takes one place in the day's budget like every family notice; a day that is full drops the mail
 *   (there is nothing to come back to), and the page lists the new moderator.
 * - **Whom it names**: the name the person gave themselves, else the address the inviter typed.
 * - Without a relay, or with `HOST_MAIL_NOTICES=off`, nothing is read.
 */

export interface InvitationAccepted {
  readonly eventId: EventId
  /** `created_by` of the invitation: who wrote it, `null` when unknown. */
  readonly createdBy: UserId | null
  /** The account that accepted. */
  readonly acceptedBy: UserId
  readonly role: InvitedRole
  /** The name that account gave, else the address the invitation was written to. */
  readonly who: string
}

/** What `acceptInvitation` is given: the acceptance, nothing else. Never awaited, never throws. */
export type InvitationAcceptedHook = (accepted: InvitationAccepted) => void

export interface NotifyInvitationAccepted {
  readonly notify: InvitationAcceptedHook
  /** Resolves when every mail started so far is over. For a test; nothing in the product waits for it. */
  idle(): Promise<void>
}

export interface NotifyInvitationAcceptedDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly budget: Pick<MailBudget, 'take'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
  /** `HOST_MAIL_NOTICES` is not `off`. */
  readonly hostMailNotices: boolean
}

export const makeNotifyInvitationAccepted = (
  deps: NotifyInvitationAcceptedDeps,
): NotifyInvitationAccepted => {
  const { events, clients, memberships, budget, mailer, clock, logger, publicUrl } = deps
  const inFlight = new Set<Promise<void>>()

  const run = async (accepted: InvitationAccepted): Promise<void> => {
    if (!deps.hostMailNotices || !mailer.canDeliver) return
    if (accepted.createdBy === null || accepted.createdBy === accepted.acceptedBy) return
    const event = await events.findById(accepted.eventId)
    if (event === null || event.isTakenDown() || event.isClientSuspended()) return
    const client = event.clientId === null ? null : await clients.findById(event.clientId)
    if (client?.isOffboarding() === true) return

    const inviter = (await memberships.ownersToNotify(accepted.eventId)).find(
      (owner) => owner.userId === accepted.createdBy,
    )
    if (inviter === undefined || !inviter.mail.event) return
    const to = EmailAddress.fromStored(inviter.email)
    if (!to.ok) return
    if (!(await budget.take(budgetDayOf(clock.now()), 1))) return

    const result = await mailer.send(
      invitationAcceptedMail({
        to: to.value,
        locale: client?.locale ?? event.settings.wallLanguage,
        eventName: event.name.value,
        pageUrl: eventPageUrl(publicUrl, event.slug.value, 'settings'),
        who: accepted.who,
        role: accepted.role,
      }),
    )
    if (!result.ok) {
      logger.warn('an invitation notice was not sent', { code: result.error.code })
    }
  }

  return {
    notify: (accepted) => {
      const work = run(accepted).catch((error: unknown) => {
        // The name of the failure, never its message: a message may carry an address.
        logger.error('an invitation notice failed', {
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
