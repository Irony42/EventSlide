import {
  makeGetMailPreferences,
  makeSetMailPreferences,
} from '../application/usecases/notices/mailPreferences'
import { makePruneHostAnnouncements } from '../application/usecases/notices/pruneHostAnnouncements'
import { makeSweepEventNotices } from '../application/usecases/notices/sweepEventNotices'
import { makeSweepRsvpDigests } from '../application/usecases/notices/sweepRsvpDigests'
import { makeSweepRsvpNotices } from '../application/usecases/notices/sweepRsvpNotices'
import { makePruneMailBudget } from '../application/usecases/notices/pruneMailBudget'
import type { Adapters, UseCasePolicy } from './usecases'
import type { SharedHooks } from './usecases.shared'

/**
 * The host-mail slice of the use-case bag (spec 32, ADR 0019): composition only, built by `buildUseCases`.
 *
 * Built whatever `HOST_MAIL_NOTICES` says, like every use case: an account's two switches are stored even
 * on a box that sends nothing (so what the host chose survives the day a relay is configured), and
 * `available` tells the page whether they mean anything now. `pruneMailBudget` has no route: the
 * retention sweep calls it.
 */
export const noticeUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { sweepHostAnnouncements }: SharedHooks,
) => ({
  /** R1, the warning before the replies are erased (no route: the retention sweep calls it). */
  sweepRsvpNotices: makeSweepRsvpNotices({
    events: adapters.events,
    clients: adapters.clients,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    memberships: adapters.memberships,
    notices: adapters.eventMailNotices,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    capNoticeDays: policy.retention.capNoticeDays,
    publicUrl: policy.publicUrl,
    hostMailNotices: policy.hostMailNotices,
  }),
  /** R2, the daily summary of the replies (no route: the retention sweep calls it). */
  sweepRsvpDigests: makeSweepRsvpDigests({
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    guestbook: adapters.guestbook,
    events: adapters.events,
    clients: adapters.clients,
    invites: adapters.guestInvites,
    memberships: adapters.memberships,
    preferences: adapters.mailPreferences,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
    hostMailNotices: policy.hostMailNotices,
  }),
  /** A3 and A5, the notices of the life of an event (no route: the retention sweep calls it). */
  sweepEventNotices: makeSweepEventNotices({
    events: adapters.events,
    clients: adapters.clients,
    invites: adapters.guestInvites,
    photos: adapters.photos,
    guestbook: adapters.guestbook,
    memberships: adapters.memberships,
    notices: adapters.eventMailNotices,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    capNoticeDays: policy.retention.capNoticeDays,
    publicUrl: policy.publicUrl,
    hostMailNotices: policy.hostMailNotices,
  }),
  /** The announcements to the hosts, by batches within the day's budget (no route: the retention sweep and the operator's request call it). */
  sweepHostAnnouncements,
  /** The retention of the announcements: deliveries 30 days after the end, texts 365 days (no route). */
  pruneHostAnnouncements: makePruneHostAnnouncements({
    announcements: adapters.hostAnnouncements,
    clock: adapters.clock,
  }),
  getMailPreferences: makeGetMailPreferences({
    users: adapters.users,
    preferences: adapters.mailPreferences,
    mailer: adapters.mailer,
    hostMailNotices: policy.hostMailNotices,
  }),
  setMailPreferences: makeSetMailPreferences({
    users: adapters.users,
    preferences: adapters.mailPreferences,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  pruneMailBudget: makePruneMailBudget({ budget: adapters.mailBudget, clock: adapters.clock }),
})
