import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { takedownMail, type TakedownKind } from '../../../domain/mail/takedownMail'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import type { ClientId, EventId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository, UserRepository } from '../../ports/userRepository'

/**
 * Telling the host what the operator did (spec 32, A4): a photograph, a guestbook message or an event taken down, a client
 * suspended, resumed or put on the way out.
 *
 * The operator's use case hands the act to this **after it was done and audited**, only when the operator left "Prévenir l'hôte"
 * ticked, and never waits for it: the mail is a completion that catches everything.
 *
 * - **No family, no switch, `HOST_MAIL_NOTICES` does not stop it**: an act the host did not do is the one the box must say. It is
 *   **counted** in the day's budget and **never refused** by it. Not held for quiet hours, not noted (the act is its own guard).
 * - **Who**: for a removal, the event's active owners; for an act on a client, the client's active owners **and** its contact
 *   address. **One mail per address** (an owner who is also the contact is written to once).
 * - **What it says**: the event's name (or the space's), the day, the operator's reason for the host, how to contest. Never a
 *   guest's name, never the removed content (this never reads any).
 * - Without a relay nothing is read and nothing is sent.
 */

export type TakedownAct =
  | {
      readonly kind: 'photo' | 'guestbook' | 'event'
      readonly eventId: EventId
      readonly reason: string | null
      readonly at: Date
    }
  | {
      readonly kind: 'clientSuspended' | 'clientResumed' | 'clientOffboarded'
      readonly clientId: ClientId
      readonly reason: string | null
      readonly at: Date
    }

/** What an operator use case is given: the act, nothing else. Never awaited, never throws. */
export type TakedownHook = (act: TakedownAct) => void

export interface NotifyTakedown {
  readonly notify: TakedownHook
  /** Resolves when every mail started so far is over. For a test; nothing in the product waits for it. */
  idle(): Promise<void>
}

export interface NotifyTakedownDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'findById' | 'memberIds' | 'memberRole'>
  readonly users: Pick<UserRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly budget: Pick<MailBudget, 'count'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** The operator's contact address (`OPERATOR_CONTACT_EMAIL`): where a reply goes, `null` for none. */
  readonly operatorContact: EmailAddress | null
}

interface Audience {
  readonly name: string
  readonly locale: ClientLocale
  /** Stored addresses, as they are in the tables, possibly twice. */
  readonly addresses: readonly string[]
  readonly purgeAt: Date | null
}

export const makeNotifyTakedown = (deps: NotifyTakedownDeps): NotifyTakedown => {
  const { events, clients, users, memberships, budget, mailer, clock, logger, operatorContact } =
    deps
  const inFlight = new Set<Promise<void>>()

  const audienceOf = async (act: TakedownAct): Promise<Audience | null> => {
    if ('eventId' in act) {
      const event = await events.findById(act.eventId)
      if (event === null) return null
      const client = event.clientId === null ? null : await clients.findById(event.clientId)
      const owners = await memberships.ownersToNotify(act.eventId)
      return {
        name: event.name.value,
        locale: client?.locale ?? event.settings.wallLanguage,
        addresses: owners.map((owner) => owner.email),
        purgeAt: null,
      }
    }
    const client = await clients.findById(act.clientId)
    if (client === null) return null
    const addresses: string[] = []
    for (const userId of await clients.memberIds(act.clientId)) {
      if ((await clients.memberRole(act.clientId, userId)) !== 'owner') continue
      const user = await users.findById(userId)
      if (user !== null && user.canSignIn()) addresses.push(user.email.value)
    }
    if (client.contactEmail !== null) addresses.push(client.contactEmail.value)
    return {
      name: client.name.value,
      locale: client.locale,
      addresses,
      purgeAt: client.purgeAfter,
    }
  }

  const run = async (act: TakedownAct): Promise<void> => {
    if (!mailer.canDeliver) return
    const audience = await audienceOf(act)
    if (audience === null) return

    const seen = new Set<string>()
    const recipients: EmailAddress[] = []
    for (const stored of audience.addresses) {
      const key = stored.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const address = EmailAddress.fromStored(stored)
      if (address.ok) recipients.push(address.value)
    }
    if (recipients.length === 0) return

    // Counted, never refused: the budget only ever holds back the follow-up mails.
    await budget.count(budgetDayOf(clock.now()), recipients.length)
    for (const to of recipients) {
      const result = await mailer.send(
        takedownMail({
          to,
          locale: audience.locale,
          kind: act.kind,
          name: audience.name,
          at: act.at,
          reason: act.reason,
          replyTo: operatorContact,
          purgeAt: audience.purgeAt,
        }),
      )
      if (!result.ok) {
        logger.warn('a takedown notice was not sent', {
          kind: act.kind satisfies TakedownKind,
          code: result.error.code,
        })
      }
    }
  }

  return {
    notify: (act) => {
      const work = run(act).catch((error: unknown) => {
        // The name of the failure, never its message: a message may carry an address.
        logger.error('a takedown notice failed', {
          kind: act.kind,
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
