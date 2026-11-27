import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import { scheduleOf } from '../../../domain/guestInvites/inviteStateOf'
import { rsvpExpiryOf } from '../../../domain/guestRsvps/rsvpExpiry'
import { statsOf } from '../../../domain/guestRsvps/rsvpStats'
import { guestMayWrite, rsvpClosesAt, rsvpStateOf } from '../../../domain/guestRsvps/rsvpWindow'
import {
  rsvpDeadlineMail,
  rsvpFullMail,
  rsvpStoppedMail,
  rsvpUnansweredPageUrl,
} from '../../../domain/mail/rsvpFamilyMails'
import { rsvpErasureMail, rsvpErasurePageUrl } from '../../../domain/mail/rsvpNoticeMails'
import { isFresh } from '../../../domain/notices/noticeFreshness'
import type { NoticeKind } from '../../../domain/notices/noticeKind'
import { DEFAULT_NOTICE_TIME_ZONE, inQuietHours } from '../../../domain/notices/quietHours'
import {
  rsvpDeadlineNotice,
  rsvpFullKey,
  rsvpStoppedByDeadline,
} from '../../../domain/notices/rsvpCalendarNotices'
import { rsvpFiguresOf } from '../../../domain/notices/rsvpFigures'
import {
  rsvpErasureDate,
  rsvpErasureKey,
  rsvpErasureNotice,
  type RsvpErasureLevel,
} from '../../../domain/notices/rsvpErasureNotice'
import { localDayOf } from '../../../domain/shared/localDay'
import type { EventId } from '../../../domain/shared/ids'
import { addDays } from '../../../domain/shared/time'
import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository } from '../../ports/userRepository'
import { deliverNotice, type DeliveryResult } from './noticeDelivery'

/**
 * The notices of the guests' replies that the retention sweep sends (spec 32, section 3.1):
 *
 * - **R1**, the warning before the replies are erased: **7 days and 1 day before**, to every active owner, **no switch**
 *   (no family, like the warning before a purge);
 * - **R3**, three days before the deadline, while households of the guest list have not answered;
 * - **R4**, the summary once the **deadline** stopped the replies (not a closing by hand, not the party's start);
 * - **R5**, every place is taken (**one per capacity value**: the key is `full@<capacity>`).
 *
 * R3 to R5 are of the `rsvp` family: an owner who switched it off is not written to, and `HOST_MAIL_NOTICES=off`
 * (`hostMailNotices` false) stops them, candidates and all, while R1 goes on. Every one follows `deliverNotice`'s
 * order (stale, quiet hours, recipients, budget, noted before sent). Without a relay **nothing is sent and nothing is
 * noted**, so no notice is skipped the day one is configured.
 *
 * - **The date of R1 is the earlier of the replies' retention and the event's own purge** (`rsvpErasureDate`) **unless the
 *   purge is held** (a held event is never purged, so its replies go at their own date). The key carries the level **and
 *   the date**, so a date that moves owes its levels again. A date already arrived owes nothing (first run on an old base).
 * - **Which events**: those whose replies end within 7 days (`eventsWithRepliesExpiringBefore`), whose purge is due within 7
 *   days and not more than 7 days late (a backlog after an outage is not hydrated), whose deadline falls in a window of
 *   days around now, or whose form limits the places. A bounded read each; the figures are computed only for a candidate.
 * - **Excluded**: an event the operator took down, of a suspended client or of a client being closed. R1 only concerns an
 *   event with at least one reply.
 * - **The mails carry figures and the host's own words**, never a guest's (`RsvpFigures`).
 *
 * Run **before** `purgeExpiredRsvps` in the same pass. It never throws: an event that cannot be examined is `failed`.
 */

/** How far ahead replies are looked for: the furthest level. */
const HORIZON_DAYS = 7

/** A purge date further in the past than this is a backlog (an outage): not looked at, not hydrated. */
const PURGE_BACKLOG_DAYS = 7

/** Deadlines looked at: from 3 days back (R4's day and its zone) to 5 days ahead (R3's three, and a zone's offset). */
const DEADLINE_BACK_DAYS = 3
const DEADLINE_AHEAD_DAYS = 5

export interface SweepRsvpNoticesReport {
  /** The notices noted this run. `level` is the level of an R1 notice. */
  readonly noticed: readonly {
    readonly eventId: EventId
    readonly kind: NoticeKind
    readonly level?: RsvpErasureLevel
  }[]
  /** Messages the relay accepted. */
  readonly sent: number
  /** Messages that could not be sent: not retried, the page remains. */
  readonly unsent: number
  /** Notices held back by the day's budget: neither noted nor sent, they come back while they are fresh. */
  readonly skippedBudget: number
  /** Notices noted without being sent because they were no longer worth sending. */
  readonly stale: number
  /** Events the sweep could not examine. */
  readonly failed: readonly EventId[]
}

export interface SweepRsvpNoticesDeps {
  readonly events: Pick<EventRepository, 'listDueForPurge' | 'findById'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly invites: Pick<
    GuestInviteRepository,
    'findByEvent' | 'findRsvpSettings' | 'eventsWithRsvpDeadlineBetween' | 'eventsWithRsvpCapacity'
  >
  readonly rsvps: Pick<
    GuestRsvpRepository,
    'count' | 'listByEvent' | 'eventsWithRepliesExpiringBefore'
  >
  readonly households: Pick<GuestHouseholdRepository, 'listByEvent'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly notices: EventMailNoticeLedger
  readonly budget: Pick<MailBudget, 'take' | 'count'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `RETENTION_CAP_NOTICE_DAYS`, the same number the purge lists with. */
  readonly capNoticeDays: number
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
  /** `HOST_MAIL_NOTICES` is not `off`: the families' notices (R3 to R5) are swept. R1 is not a family's. */
  readonly hostMailNotices: boolean
}

export type SweepRsvpNotices = () => Promise<SweepRsvpNoticesReport>

const NOTHING: SweepRsvpNoticesReport = {
  noticed: [],
  sent: 0,
  unsent: 0,
  skippedBudget: 0,
  stale: 0,
  failed: [],
}

/** The instant the house filled: the latest change among the replies of those who come. */
const filledAt = (replies: readonly GuestRsvp[]): Date =>
  new Date(
    Math.max(
      ...replies
        .filter((reply) => reply.answer === 'yes')
        .map((reply) => reply.updatedAt.getTime()),
    ),
  )

export const makeSweepRsvpNotices = (deps: SweepRsvpNoticesDeps): SweepRsvpNotices => {
  const { events, clients, invites, rsvps, households, memberships, notices } = deps
  const { mailer, clock, logger, capNoticeDays, publicUrl, hostMailNotices } = deps

  return async () => {
    if (!mailer.canDeliver) return NOTHING

    const noticed: { eventId: EventId; kind: NoticeKind; level?: RsvpErasureLevel }[] = []
    const failed: EventId[] = []
    let sent = 0
    let unsent = 0
    let skippedBudget = 0
    let stale = 0
    const now = clock.now()

    /** Counts what `deliverNotice` did, for the report. */
    const tally = (
      eventId: EventId,
      kind: NoticeKind,
      result: DeliveryResult,
      level?: RsvpErasureLevel,
    ): void => {
      sent += result.sent
      unsent += result.unsent
      if (result.outcome === 'budget') skippedBudget += 1
      if (result.outcome === 'stale') stale += 1
      if (result.outcome === 'served' || result.outcome === 'nobody') {
        noticed.push(level === undefined ? { eventId, kind } : { eventId, kind, level })
      }
    }

    let candidates: readonly EventId[]
    try {
      const horizon = addDays(now, HORIZON_DAYS)
      const byRetention = await rsvps.eventsWithRepliesExpiringBefore(horizon)
      const byPurge: EventId[] = []
      const backlogCutoff = addDays(now, -PURGE_BACKLOG_DAYS).getTime()
      for (const event of await events.listDueForPurge(horizon, { capNoticeDays })) {
        const client = event.clientId === null ? null : await clients.findById(event.clientId)
        const deadline = purgeDeadline(event, client, capNoticeDays)
        // A backlog after an outage is the purge's business, not a warning's: skipped before any other read.
        const recent = deadline !== null && deadline.getTime() >= backlogCutoff
        if (recent) {
          byPurge.push(event.id)
        }
      }
      const fromDay = localDayOf(addDays(now, -DEADLINE_BACK_DAYS), 'UTC')
      const toDay = localDayOf(addDays(now, DEADLINE_AHEAD_DAYS), 'UTC')
      const byDeadline = hostMailNotices
        ? await invites.eventsWithRsvpDeadlineBetween(fromDay, toDay)
        : []
      const byCapacity = hostMailNotices ? await invites.eventsWithRsvpCapacity(now) : []
      candidates = [...new Set([...byRetention, ...byPurge, ...byDeadline, ...byCapacity])]
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
        const zone = invite?.content.timeZone ?? DEFAULT_NOTICE_TIME_ZONE
        const quiet = inQuietHours(now, zone)
        const locale = client?.locale ?? event.settings.wallLanguage
        const eventName = event.name.value
        const slug = event.slug.value
        const owners = async () => memberships.ownersToNotify(eventId)

        // ---- R1: the warning before the replies are erased ------------------------------------------------
        const erasure = rsvpErasureDate(
          rsvpExpiryOf({ closedAt: event.closedAt, startsAt: invite?.content.startsAt ?? null }),
          event.purgeHeldAt === null ? purgeDeadline(event, client, capNoticeDays) : null,
        )
        const replies = erasure === null ? 0 : await rsvps.count(eventId)
        if (erasure !== null && replies > 0) {
          const lastLevel = (await notices.has(eventId, 'rsvpErasure', rsvpErasureKey(1, erasure)))
            ? 1
            : (await notices.has(eventId, 'rsvpErasure', rsvpErasureKey(7, erasure)))
              ? 7
              : null
          const level = rsvpErasureNotice(erasure, now, lastLevel)
          if (level !== null) {
            const result = await deliverNotice(deps, {
              eventId,
              kind: 'rsvpErasure',
              key: rsvpErasureKey(level, erasure),
              family: null,
              owners: await owners(),
              fresh: true,
              quiet,
              now,
              build: (to) =>
                rsvpErasureMail({
                  to,
                  locale,
                  eventName,
                  erasureDate: erasure,
                  replies,
                  pageUrl: rsvpErasurePageUrl(publicUrl, slug),
                }),
            })
            tally(eventId, 'rsvpErasure', result, level)
          }
        }

        // ---- R3, R4, R5: the replies' calendar and the full house -----------------------------------------
        if (!hostMailNotices) continue
        const settings = await invites.findRsvpSettings(eventId)
        const schedule = invite === null ? null : scheduleOf(invite)
        if (invite === null || settings === null || schedule === null) continue
        // Replies not asked, an invitation not served or a party over: nothing of the calendar applies, and no figure is computed.
        if (rsvpStateOf(settings, invite, event, now, { yesPeople: 0 }) === 'off') continue
        const replyList = await rsvps.listByEvent(eventId)
        const stats = statsOf(
          replyList,
          await households.listByEvent(eventId),
          settings.form.moments,
        )
        const state = rsvpStateOf(settings, invite, event, now, { yesPeople: stats.yes.people })

        const deadlineKey = rsvpDeadlineNotice(
          settings,
          schedule,
          state,
          stats.noReply.households > 0,
          now,
        )
        if (deadlineKey !== null && !(await notices.has(eventId, 'rsvpDeadline', deadlineKey))) {
          const result = await deliverNotice(deps, {
            eventId,
            kind: 'rsvpDeadline',
            key: deadlineKey,
            family: 'rsvp',
            owners: await owners(),
            fresh: isFresh('rsvpDeadline', rsvpClosesAt(settings, schedule), now),
            quiet,
            now,
            build: (to) =>
              rsvpDeadlineMail({
                to,
                locale,
                eventName,
                pageUrl: rsvpUnansweredPageUrl(publicUrl, slug),
                unanswered: stats.noReply.households,
                deadline: deadlineKey,
              }),
          })
          tally(eventId, 'rsvpDeadline', result)
        }

        const stopped = rsvpStoppedByDeadline(settings, schedule, state, now)
        if (stopped !== null && !(await notices.has(eventId, 'rsvpStopped', stopped.key))) {
          const result = await deliverNotice(deps, {
            eventId,
            kind: 'rsvpStopped',
            key: stopped.key,
            family: 'rsvp',
            owners: await owners(),
            fresh: isFresh('rsvpStopped', stopped.stoppedAt, now),
            quiet,
            now,
            build: (to) =>
              rsvpStoppedMail({
                to,
                locale,
                eventName,
                pageUrl: rsvpErasurePageUrl(publicUrl, slug),
                figures: rsvpFiguresOf(stats, settings.form.meals.options),
              }),
          })
          tally(eventId, 'rsvpStopped', result)
        }

        const fullKey = guestMayWrite(state) ? rsvpFullKey(stats, settings.form) : null
        if (fullKey !== null && !(await notices.has(eventId, 'rsvpFull', fullKey))) {
          const result = await deliverNotice(deps, {
            eventId,
            kind: 'rsvpFull',
            key: fullKey,
            family: 'rsvp',
            owners: await owners(),
            // The moment it filled is the latest reply of those who come: a house that has been full for weeks is not news (the first pass
            // after an update would otherwise mail every one of them), and a capacity raised then filled again is.
            fresh: isFresh('rsvpFull', filledAt(replyList), now),
            quiet,
            now,
            build: (to) =>
              rsvpFullMail({
                to,
                locale,
                eventName,
                pageUrl: rsvpErasurePageUrl(publicUrl, slug),
                capacity: Number(fullKey.slice('full@'.length)),
              }),
          })
          tally(eventId, 'rsvpFull', result)
        }
      } catch {
        failed.push(eventId)
      }
    }

    return { noticed, sent, unsent, skippedBudget, stale, failed }
  }
}
