import { rsvpDigestMail } from '../../../domain/mail/rsvpFamilyMails'
import { rsvpErasurePageUrl } from '../../../domain/mail/rsvpNoticeMails'
import { statsOf } from '../../../domain/guestRsvps/rsvpStats'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import { DEFAULT_NOTICE_TIME_ZONE } from '../../../domain/notices/quietHours'
import { latestOf, rsvpDigestDue } from '../../../domain/notices/rsvpDigest'
import { rsvpFiguresOf } from '../../../domain/notices/rsvpFigures'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { MailPreferenceRepository } from '../../ports/mailPreferenceRepository'
import type { Mailer } from '../../ports/mailer'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * R2, the daily summary of the replies (spec 32, section 3.1): to **an owner who ticked it for this event**, **at most
 * one a day**, from 09:00 (and before 21:00) in the invitation's zone, **only when there is something new** since the later
 * of their last visit to the replies page and their last summary, and only while their account's replies switch is on
 * (`mail_rsvp = 0` beats the tick). `HOST_MAIL_NOTICES=off` stops it; without a relay nothing is sent.
 *
 * - **Who and when are decided by `rsvpDigestDue`** (the pure rule), from the candidates read (`digestCandidates`: one row per
 *   ticked owner with a reply newer than their visit and their last summary) and the owner as read now (`ownersToNotify`: an
 *   owner whose account was disabled, or who is no longer an owner, is not written to).
 * - **Order**: due, then the day's budget (`take`, refused: neither claimed nor sent, it comes back on the next pass), then
 *   the **compare-and-set claim** of `rsvp_digest_at` (the winner sends, so the timer and `npm run purge` running together
 *   send one), then the mail. A claim won and a mail the relay refuses is not retried: the next summary comes tomorrow.
 * - **A deletion alone triggers nothing** (the row is gone and no change is left to find): accepted, the next summary's
 *   totals are right. A reply a co-owner added counts, as it does for the badge.
 * - **The mail carries figures only** (`RsvpFigures`): how many replies are new or changed, the totals, the households with no
 *   reply, and **how many words of absent guests wait for the host's approval** (one count, never the words). Never a name, a diet.
 *
 * It never throws: a candidate that cannot be examined is `failed`, the others go on.
 */

export interface SweepRsvpDigestsReport {
  /** Summaries claimed and handed to the relay (accepted or not). */
  readonly claimed: number
  readonly sent: number
  readonly unsent: number
  /** Summaries held back by the day's budget. */
  readonly skippedBudget: number
  /** Candidates the sweep could not examine, as `event:owner`. */
  readonly failed: readonly string[]
}

export interface SweepRsvpDigestsDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'digestCandidates' | 'listByEvent'>
  readonly households: Pick<GuestHouseholdRepository, 'listByEvent'>
  readonly guestbook: Pick<GuestbookRepository, 'countPendingRsvpNotes'>
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly invites: Pick<GuestInviteRepository, 'findByEvent' | 'findRsvpSettings'>
  readonly memberships: Pick<MembershipRepository, 'ownersToNotify'>
  readonly preferences: Pick<MailPreferenceRepository, 'claimDigest'>
  readonly budget: Pick<MailBudget, 'take'>
  readonly mailer: Mailer
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
  /** `HOST_MAIL_NOTICES` is not `off`. */
  readonly hostMailNotices: boolean
}

export type SweepRsvpDigests = () => Promise<SweepRsvpDigestsReport>

const NOTHING: SweepRsvpDigestsReport = {
  claimed: 0,
  sent: 0,
  unsent: 0,
  skippedBudget: 0,
  failed: [],
}

export const makeSweepRsvpDigests =
  ({
    rsvps,
    households,
    guestbook,
    events,
    clients,
    invites,
    memberships,
    preferences,
    budget,
    mailer,
    clock,
    logger,
    publicUrl,
    hostMailNotices,
  }: SweepRsvpDigestsDeps): SweepRsvpDigests =>
  async () => {
    if (!mailer.canDeliver || !hostMailNotices) return NOTHING

    const now = clock.now()
    let candidates: Awaited<ReturnType<typeof rsvps.digestCandidates>>
    try {
      candidates = await rsvps.digestCandidates()
    } catch (error) {
      logger.error('replies digests could not list the candidates', {
        error: error instanceof Error ? error.name : 'unknown',
      })
      return NOTHING
    }

    let claimed = 0
    let sent = 0
    let unsent = 0
    let skippedBudget = 0
    const failed: string[] = []

    for (const candidate of candidates) {
      const { eventId, userId } = candidate
      try {
        const event = await events.findById(eventId)
        if (event === null || event.isTakenDown() || event.isClientSuspended()) continue
        const client = event.clientId === null ? null : await clients.findById(event.clientId)
        if (client?.isOffboarding() === true) continue

        const owner = (await memberships.ownersToNotify(eventId)).find(
          (candidateOwner) => candidateOwner.userId === userId,
        )
        if (owner === undefined) continue

        const invite = await invites.findByEvent(eventId)
        const settings = await invites.findRsvpSettings(eventId)
        // Replies exist only on an invitation: a candidate without one is nothing to write about.
        if (invite === null || settings === null) continue
        const due = rsvpDigestDue({
          subscribed: owner.rsvpDigest,
          familyOn: owner.mail.rsvp,
          lastDigestAt: owner.rsvpDigestAt,
          seenAt: candidate.seenAt,
          lastChangeAt: candidate.lastChangeAt,
          now,
          timeZone: invite.content.timeZone ?? DEFAULT_NOTICE_TIME_ZONE,
        })
        if (!due) continue

        if (!(await budget.take(budgetDayOf(now), 1))) {
          skippedBudget += 1
          continue
        }
        // The winner of the compare-and-set sends: another sweep that claimed first leaves us nothing to do.
        if (!(await preferences.claimDigest(eventId, userId, owner.rsvpDigestAt, now))) continue
        claimed += 1

        const replies = await rsvps.listByEvent(eventId)
        const stats = statsOf(replies, await households.listByEvent(eventId), settings.form.moments)
        const since = latestOf(candidate.seenAt, owner.rsvpDigestAt)
        const changed = replies.filter(
          (reply) => since === null || reply.updatedAt.getTime() > since.getTime(),
        ).length

        const to = EmailAddress.fromStored(owner.email)
        if (!to.ok) {
          unsent += 1
          continue
        }
        const result = await mailer.send(
          rsvpDigestMail({
            to: to.value,
            locale: client?.locale ?? event.settings.wallLanguage,
            eventName: event.name.value,
            pageUrl: rsvpErasurePageUrl(publicUrl, event.slug.value),
            changed,
            pendingNotes: await guestbook.countPendingRsvpNotes(eventId),
            figures: rsvpFiguresOf(stats, settings.form.meals.options),
          }),
        )
        if (result.ok) {
          sent += 1
        } else {
          unsent += 1
          logger.warn('a replies digest was not sent', { eventId, code: result.error.code })
        }
      } catch {
        failed.push(`${eventId}:${userId}`)
      }
    }

    return { claimed, sent, unsent, skippedBudget, failed }
  }
