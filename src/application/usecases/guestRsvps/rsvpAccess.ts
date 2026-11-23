import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { AuditAction } from '../../../domain/audit/auditAction'
import type { Event } from '../../../domain/events/event'
import type { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import { scheduleOf } from '../../../domain/guestInvites/inviteStateOf'
import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import { rsvpExpiryOf } from '../../../domain/guestRsvps/rsvpExpiry'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import { statsOf, type RsvpStats } from '../../../domain/guestRsvps/rsvpStats'
import { rsvpClosesAt, rsvpStateOf, type RsvpState } from '../../../domain/guestRsvps/rsvpWindow'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { openGuestInvite } from '../guestInvites/guestInviteAccess'

/**
 * What every host-side use case of the guests' replies asks first (spec 30): the same door as the
 * invitation they hang on (`openGuestInvite`: the event exists, the actor is its **owner**, a
 * suspended client's host may only read, an event the operator took down is `404`, and a write is
 * refused on an archived event), then the invitation's own row, since the settings live there.
 *
 * A write that needs the settings is refused `409 rsvp.inviteRequired` while the event has no
 * invitation (`requireInvite`): there is nothing for guests to answer yet. A read answers the
 * defaults.
 */

export interface RsvpAccessDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: Pick<GuestInviteRepository, 'findByEvent' | 'findRsvpSettings'>
}

export interface OpenedRsvps {
  readonly event: Event
  /** `null` until the host first saves the invitation. */
  readonly invite: GuestInvite | null
  readonly settings: RsvpSettings
}

export const openRsvps = async (
  deps: RsvpAccessDeps,
  eventId: EventId,
  actorId: UserId,
  mode: 'read' | 'write',
): Promise<Result<OpenedRsvps, DomainError>> => {
  const opened = await openGuestInvite(deps, eventId, actorId, mode)
  if (!opened.ok) return opened
  const invite = await deps.invites.findByEvent(eventId)
  const settings = (await deps.invites.findRsvpSettings(eventId)) ?? DEFAULT_RSVP_SETTINGS
  return ok({ event: opened.value, invite, settings })
}

/** The opened replies of an event that **has** an invitation, or `409 rsvp.inviteRequired`. */
export const requireInvite = (
  opened: OpenedRsvps,
): Result<OpenedRsvps & { readonly invite: GuestInvite }, DomainError> =>
  opened.invite === null
    ? err(DomainError.conflict('rsvp.inviteRequired'))
    : ok({ ...opened, invite: opened.invite })

/** What the host's page needs to show the state of the replies. */
export interface RsvpSituation {
  /** `null` while the event has no invitation. */
  readonly state: RsvpState | null
  /** When replies stop on their own, or `null` while there is no invitation or no date. */
  readonly closesAt: Date | null
  /** When the replies will be erased, or `null` while there is no reply or no clock running. */
  readonly erasedAt: Date | null
}

export const statsAndSituation = (
  opened: OpenedRsvps,
  rsvps: readonly GuestRsvp[],
  now: Date,
): { readonly stats: RsvpStats; readonly situation: RsvpSituation } => {
  const { event, invite, settings } = opened
  const stats = statsOf(rsvps)
  const schedule = invite === null ? null : scheduleOf(invite)
  return {
    stats,
    situation: {
      state:
        invite === null
          ? null
          : rsvpStateOf(settings, invite, event, now, { yesPeople: stats.yes.people }),
      closesAt: schedule === null ? null : rsvpClosesAt(settings, schedule),
      erasedAt:
        rsvps.length === 0
          ? null
          : rsvpExpiryOf({ closedAt: event.closedAt, startsAt: schedule?.startsAt ?? null }),
    },
  }
}

export type RsvpAuditAction = Extract<
  AuditAction,
  | 'event.rsvpFormSaved'
  | 'event.rsvpsClosed'
  | 'event.rsvpsReopened'
  | 'event.rsvpHostAdded'
  | 'event.rsvpHostEdited'
  | 'event.rsvpHostDeleted'
  | 'event.rsvpsExported'
>

/**
 * One line of the audit log for an owner's act on the replies: who, when, and that it happened.
 * **Never a name, a diet or a word.** Written before the change, as every owner's act is.
 */
export const recordRsvpAct = async (
  audit: AuditRecorder,
  event: Event,
  actorId: UserId,
  action: RsvpAuditAction,
  at: Date,
): Promise<Result<void, DomainError>> => {
  const entry = AuditEntry.create({
    at,
    actor: { kind: 'member', userId: actorId },
    action,
    subject: { type: 'event', id: event.id },
    clientId: event.clientId,
    details: {},
  })
  if (!entry.ok) return entry
  await audit.record(entry.value)
  return ok(undefined)
}

/**
 * After a host's own add or edit: the host has just seen what they wrote, so it must not count
 * against their own badge. Only when they had **nothing unseen before** the write: marking seen
 * would otherwise hide the guests' replies they have not read. A removal never adds to the count,
 * so it needs none.
 */
export const keepOwnWriteSeen = async (
  rsvps: Pick<GuestRsvpRepository, 'unseenCount' | 'markSeen'>,
  eventId: EventId,
  actorId: UserId,
  unseenBefore: number,
  now: Date,
): Promise<void> => {
  if (unseenBefore === 0) await rsvps.markSeen(eventId, actorId, now)
}

/** Announces that the replies changed, without any content (`rsvp.changed`). */
export const announceRsvpsChanged = (bus: EventBus, eventId: EventId): void =>
  bus.publish({ type: 'rsvp.changed', eventId })
