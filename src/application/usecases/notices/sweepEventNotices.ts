import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Client } from '../../../domain/clients/client'
import type { Event } from '../../../domain/events/event'
import {
  eventClosedMail,
  eventPageUrl,
  windowEndingMail,
} from '../../../domain/mail/eventNoticeMails'
import {
  EVENT_CLOSED_AFTER_MS,
  EVENT_CLOSED_UNTIL_MS,
  eventClosedNoticeDue,
  windowEndingDue,
} from '../../../domain/notices/eventNotices'
import { isFresh } from '../../../domain/notices/noticeFreshness'
import type { NoticeKind } from '../../../domain/notices/noticeKind'
import {
  DEFAULT_NOTICE_TIME_ZONE,
  inQuietHours,
  usableTimeZone,
} from '../../../domain/notices/quietHours'
import type { EventId } from '../../../domain/shared/ids'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { ceilingsOf } from '../clients/clientContextOf'
import { clientToWriteAbout } from './noticeAudience'
import { deliverNotice, type DeliveryResult } from './noticeDelivery'

/**
 * The notices of the life of an event that the retention sweep sends (spec 32, section 3.3, family `event`):
 *
 * - **A3**, "after the party": **12 hours after** the event's closing (host, schedule or window; a reopening clears it, so an
 *   event reopened before then counts from its new closing), until 48 hours after, and not once the album's deletion date
 *   has passed. **Once per event** (the key is `first`: closing, reopening and closing again after a notice sends no second one). The figures are what is **published** (photographs, videos, messages of the book), never what
 *   is pending, hidden or taken down; an event with nothing published is noted without a mail (content that comes later gets no
 *   A3: accepted).
 * A3 and A5 are due exactly while they are worth sending (their window is their validity, `isFresh`), so unlike the sweep of
 * the replies this one has no "noted as stale" outcome to report.
 * - **A5**, the wall closes **within 24 hours**: the end of the space's opening time, `Event.liveWindowEnd` (the rule the box acts
 *   on, never recomputed here), for a live event of a client, **unless a scheduled closing falls before it**. The key is the
 *   instant of that end, so a window that moves is told again.
 *
 * Both follow `deliverNotice`'s order (stale, quiet hours in the invitation's zone, recipients, budget, noted before sent) and
 * are of the `event` family: an owner who switched it off is not written to, and `HOST_MAIL_NOTICES=off` stops them, candidates
 * included. Without a relay **nothing is sent and nothing is noted**. An event taken down, of a suspended client or of a client
 * being closed is left out; an archived event has neither a window nor an "after the party" owed.
 *
 * Bounded reads: the closed events between 12 and 48 hours old (one indexed query), and the live events of clients; the figures
 * are counted only for the events that are due. It never throws: an event that cannot be examined is `failed`.
 */

export interface SweepEventNoticesReport {
  /** The notices noted this run. */
  readonly noticed: readonly { readonly eventId: EventId; readonly kind: NoticeKind }[]
  /** Messages the relay accepted. */
  readonly sent: number
  /** Messages that could not be sent: not retried, the page remains. */
  readonly unsent: number
  /** Notices held back by the day's budget: neither noted nor sent, they come back while they are fresh. */
  readonly skippedBudget: number
  /** Events the sweep could not examine. */
  readonly failed: readonly EventId[]
}

export interface SweepEventNoticesDeps {
  readonly events: Pick<EventRepository, 'listClosedBetween' | 'listLiveOfClients'>
  readonly clients: Pick<ClientRepository, 'findById' | 'contextForEvent'>
  readonly invites: Pick<GuestInviteRepository, 'findByEvent'>
  readonly photos: Pick<PhotoRepository, 'countsByStatus' | 'countPublishedPhotos'>
  readonly guestbook: Pick<GuestbookRepository, 'countPublished'>
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
  /** `HOST_MAIL_NOTICES` is not `off`. */
  readonly hostMailNotices: boolean
}

export type SweepEventNotices = () => Promise<SweepEventNoticesReport>

const NOTHING: SweepEventNoticesReport = {
  noticed: [],
  sent: 0,
  unsent: 0,
  skippedBudget: 0,
  failed: [],
}

/** The key of A3: once per event. */
export const EVENT_CLOSED_KEY = 'first'

export const makeSweepEventNotices = (deps: SweepEventNoticesDeps): SweepEventNotices => {
  const { events, clients, invites, photos, guestbook, memberships, notices } = deps
  const { mailer, clock, logger, capNoticeDays, publicUrl, hostMailNotices } = deps

  return async () => {
    if (!hostMailNotices || !mailer.canDeliver) return NOTHING

    const noticed: { eventId: EventId; kind: NoticeKind }[] = []
    const failed: EventId[] = []
    let sent = 0
    let unsent = 0
    let skippedBudget = 0
    const now = clock.now()

    const tally = (eventId: EventId, kind: NoticeKind, result: DeliveryResult): void => {
      sent += result.sent
      unsent += result.unsent
      if (result.outcome === 'budget') skippedBudget += 1
      if (result.outcome === 'served' || result.outcome === 'nobody') {
        noticed.push({ eventId, kind })
      }
    }

    const failedOn = (eventId: EventId, error: unknown): void => {
      failed.push(eventId)
      logger.error('an event notice could not be examined', {
        eventId,
        error: error instanceof Error ? error.name : 'unknown',
      })
    }

    /** The language of the mail: the client's, else the event's wall. */
    const localeOf = (event: Event, client: Client | null) =>
      client?.locale ?? event.settings.wallLanguage

    let closed: readonly Event[]
    let live: readonly Event[]
    try {
      closed = await events.listClosedBetween(
        new Date(now.getTime() - EVENT_CLOSED_UNTIL_MS),
        new Date(now.getTime() - EVENT_CLOSED_AFTER_MS),
      )
      live = await events.listLiveOfClients()
    } catch (error) {
      logger.error('event notices could not list the events', {
        error: error instanceof Error ? error.name : 'unknown',
      })
      return NOTHING
    }

    // ---- A3: after the party ---------------------------------------------------------------------------------
    for (const event of closed) {
      try {
        const client = await clientToWriteAbout(clients, event)
        if (client === undefined) continue
        const deleteAt = purgeDeadline(event, client, capNoticeDays)
        if (!eventClosedNoticeDue(event.closedAt, now, deleteAt)) continue
        if (await notices.has(event.id, 'eventClosed', EVENT_CLOSED_KEY)) continue
        const invite = await invites.findByEvent(event.id)
        if (inQuietHours(now, usableTimeZone(invite?.content.timeZone, DEFAULT_NOTICE_TIME_ZONE))) {
          continue
        }

        const published = (await photos.countsByStatus(event.id)).published
        const photoCount = await photos.countPublishedPhotos(event.id)
        const messages = await guestbook.countPublished(event.id)
        if (published + messages === 0) {
          // Nothing to say about an empty evening: noted, so it is not looked at again.
          if (await notices.note(event.id, 'eventClosed', EVENT_CLOSED_KEY, now)) {
            noticed.push({ eventId: event.id, kind: 'eventClosed' })
          }
          continue
        }
        const locale = localeOf(event, client)
        const result = await deliverNotice(deps, {
          eventId: event.id,
          kind: 'eventClosed',
          key: EVENT_CLOSED_KEY,
          family: 'event',
          owners: await memberships.ownersToNotify(event.id),
          // `closedAt` is there: the event is due only with one.
          fresh: isFresh('eventClosed', event.closedAt as Date, now),
          quiet: false,
          now,
          build: (to) =>
            eventClosedMail({
              to,
              locale,
              eventName: event.name.value,
              pageUrl: eventPageUrl(publicUrl, event.slug.value),
              photos: photoCount,
              videos: published - photoCount,
              messages,
              deleteAt,
            }),
        })
        tally(event.id, 'eventClosed', result)
      } catch (error) {
        failedOn(event.id, error)
      }
    }

    // ---- A5: the wall closes within a day ----------------------------------------------------------------------
    for (const event of live) {
      try {
        // Who may be written about comes first: nothing else is read for an event that is down, suspended or closing.
        const client = await clientToWriteAbout(clients, event)
        if (client === undefined) continue
        const windowEnd = event.liveWindowEnd(await ceilingsOf(clients, event))
        if (windowEnd === null || !windowEndingDue(windowEnd, event.scheduledCloseAt, now)) continue
        const key = windowEnd.toISOString()
        if (await notices.has(event.id, 'windowEnding', key)) continue
        const invite = await invites.findByEvent(event.id)
        const zone = invite?.content.timeZone
        const locale = localeOf(event, client)
        const result = await deliverNotice(deps, {
          eventId: event.id,
          kind: 'windowEnding',
          key,
          family: 'event',
          owners: await memberships.ownersToNotify(event.id),
          fresh: isFresh('windowEnding', windowEnd, now),
          quiet: inQuietHours(now, usableTimeZone(zone, DEFAULT_NOTICE_TIME_ZONE)),
          now,
          build: (to) =>
            windowEndingMail({
              to,
              locale,
              eventName: event.name.value,
              pageUrl: eventPageUrl(publicUrl, event.slug.value),
              endsAt: windowEnd,
              timeZone: usableTimeZone(zone, 'UTC'),
            }),
        })
        tally(event.id, 'windowEnding', result)
      } catch (error) {
        failedOn(event.id, error)
      }
    }

    return { noticed, sent, unsent, skippedBudget, failed }
  }
}
