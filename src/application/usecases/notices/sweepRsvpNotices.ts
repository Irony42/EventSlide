import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import { rsvpExpiryOf } from '../../../domain/guestRsvps/rsvpExpiry'
import { rsvpErasureMail, rsvpErasurePageUrl } from '../../../domain/mail/rsvpNoticeMails'
import { DEFAULT_NOTICE_TIME_ZONE, inQuietHours } from '../../../domain/notices/quietHours'
import {
  rsvpErasureDate,
  rsvpErasureKey,
  rsvpErasureNotice,
  type RsvpErasureLevel,
} from '../../../domain/notices/rsvpErasureNotice'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import type { EventId } from '../../../domain/shared/ids'
import { addDays } from '../../../domain/shared/time'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * R1, the warning before the guests' replies are erased (spec 32, section 3.1): the owners of an event are
 * written to **7 days and 1 day before** the replies go, so that nobody loses the list without having been
 * told. Only R1 is swept here; the other notices of the replies come in later pull requests.
 *
 * - **No switch turns it off** (no family): every active owner is written to, whatever their e-mail
 *   preferences and `HOST_MAIL_NOTICES` say, like the warning before a purge. Without a relay nothing is sent
 *   **and nothing is noted**, so the day one is configured no notice has been skipped.
 * - **The date is the earlier of the replies' retention and the event's own purge** (`rsvpErasureDate`): the
 *   purge takes the replies sooner and its hold does not keep them. The ledger key carries the level **and the
 *   date** (`7@<instant>`), so a date that moves (reopening, an invitation moved) owes its levels again.
 * - **Noted before sent** (`EventMailNoticeLedger.note` is the decision: it answers `true` to one call only,
 *   so the timer and `npm run purge` running together send one mail). A notice for a date that has already
 *   arrived is owed nothing (`rsvpErasureNotice`): on the first run after an update, replies already due are
 *   the purge's business and nobody is told of what is gone.
 * - **Only an event with at least one reply** is written about, and none that the operator took down, whose
 *   client is suspended or being closed (they have nothing left to do in the console).
 * - **Quiet hours**: outside 08:00 to 21:00 in the invitation's zone (`Europe/Paris` without one) the notice
 *   waits for the next pass and is not noted.
 * - **Counted, never refused**: R1 counts in the day's mail budget but is not held by its ceiling.
 * - The mail carries a number and the event's name, never a guest's text (`rsvpErasureMail`). The recipients
 *   are read now (`ownersToNotify`), not when the notice became due.
 *
 * Run **before** `purgeExpiredRsvps` in the same pass: after it the replies are gone and the count is zero.
 * It never throws: an event that cannot be examined is `failed`, the others go on.
 */

/** How far ahead replies are looked for: the furthest level. */
const HORIZON_DAYS = 7

export interface SweepRsvpNoticesReport {
  /** The notices noted this run. */
  readonly noticed: readonly {
    readonly eventId: EventId
    readonly level: RsvpErasureLevel
  }[]
  /** Messages the relay accepted. */
  readonly sent: number
  /** Messages that could not be sent: not retried, the page remains. */
  readonly unsent: number
  /** Events the sweep could not examine. */
  readonly failed: readonly EventId[]
}

export interface SweepRsvpNoticesDeps {
  readonly events: Pick<EventRepository, 'listDueForPurge' | 'findById'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly invites: Pick<GuestInviteRepository, 'findByEvent'>
  readonly rsvps: Pick<GuestRsvpRepository, 'count' | 'eventsWithRepliesExpiringBefore'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly notices: EventMailNoticeLedger
  readonly budget: Pick<MailBudget, 'count'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `RETENTION_CAP_NOTICE_DAYS`, the same number the purge lists with. */
  readonly capNoticeDays: number
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
}

export type SweepRsvpNotices = () => Promise<SweepRsvpNoticesReport>

const NOTHING: SweepRsvpNoticesReport = { noticed: [], sent: 0, unsent: 0, failed: [] }

export const makeSweepRsvpNotices =
  ({
    events,
    clients,
    invites,
    rsvps,
    memberships,
    notices,
    budget,
    mailer,
    clock,
    logger,
    capNoticeDays,
    publicUrl,
  }: SweepRsvpNoticesDeps): SweepRsvpNotices =>
  async () => {
    if (!mailer.canDeliver) return NOTHING

    const noticed: { eventId: EventId; level: RsvpErasureLevel }[] = []
    const failed: EventId[] = []
    let sent = 0
    let unsent = 0
    const now = clock.now()
    const horizon = addDays(now, HORIZON_DAYS)

    let candidates: readonly EventId[]
    try {
      const byRetention = await rsvps.eventsWithRepliesExpiringBefore(horizon)
      const byPurge = await events.listDueForPurge(horizon, { capNoticeDays })
      candidates = [...new Set([...byRetention, ...byPurge.map((event) => event.id)])]
    } catch (error) {
      logger.error('replies notices could not list the events', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NOTHING
    }

    for (const eventId of candidates) {
      try {
        const event = await events.findById(eventId)
        if (event === null || event.isTakenDown() || event.isClientSuspended()) continue
        const client = event.clientId === null ? null : await clients.findById(event.clientId)
        if (client?.isOffboarding() === true) continue

        const invite = await invites.findByEvent(eventId)
        const erasure = rsvpErasureDate(
          rsvpExpiryOf({ closedAt: event.closedAt, startsAt: invite?.content.startsAt ?? null }),
          purgeDeadline(event, client, capNoticeDays),
        )
        if (erasure === null) continue

        const replies = await rsvps.count(eventId)
        if (replies === 0) continue

        const lastLevel = (await notices.has(eventId, 'rsvpErasure', rsvpErasureKey(1, erasure)))
          ? 1
          : (await notices.has(eventId, 'rsvpErasure', rsvpErasureKey(7, erasure)))
            ? 7
            : null
        const level = rsvpErasureNotice(erasure, now, lastLevel)
        if (level === null) continue

        if (inQuietHours(now, invite?.content.timeZone ?? DEFAULT_NOTICE_TIME_ZONE)) continue

        const owners = await memberships.ownersToNotify(eventId)
        // Noted first, whatever follows (and whoever else is sweeping): see the file comment.
        if (!(await notices.note(eventId, 'rsvpErasure', rsvpErasureKey(level, erasure), now))) {
          continue
        }
        noticed.push({ eventId, level })
        await budget.count(budgetDayOf(now), owners.length)

        for (const owner of owners) {
          const to = EmailAddress.fromStored(owner.email)
          if (!to.ok) {
            unsent += 1
            continue
          }
          const result = await mailer.send(
            rsvpErasureMail({
              to: to.value,
              locale: client?.locale ?? event.settings.wallLanguage,
              eventName: event.name.value,
              erasureDate: erasure,
              replies,
              pageUrl: rsvpErasurePageUrl(publicUrl, event.slug.value),
            }),
          )
          if (result.ok) {
            sent += 1
          } else {
            unsent += 1
            logger.warn('a replies erasure notice was not sent', {
              eventId,
              code: result.error.code,
            })
          }
        }
      } catch {
        failed.push(eventId)
      }
    }

    return { noticed, sent, unsent, failed }
  }
