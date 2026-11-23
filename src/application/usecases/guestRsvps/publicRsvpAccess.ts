import type { Event } from '../../../domain/events/event'
import type { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { servedInviteOf, type ServedInvite } from '../../../domain/guestInvites/inviteStateOf'
import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import { guestMayWrite, rsvpStateOf, type RsvpState } from '../../../domain/guestRsvps/rsvpWindow'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { SecretTokens } from '../../ports/secretTokens'

/**
 * What every public use case of the guests' replies asks first (spec 30, section 5): the same door
 * as the invitation page (`viewGuestInvite`).
 *
 * **One refusal for everything**: a token that is malformed, unknown, switched off, an event
 * archived, taken down or purged, a client suspended, an invitation with no date are all
 * `404 guestInvite.notAvailable`. The invitation is read by token, then the event **by id** (the
 * only read that fills the suspension and take-down facts).
 */

export interface PublicRsvpDeps {
  readonly events: EventRepository
  readonly invites: Pick<GuestInviteRepository, 'findByToken' | 'findRsvpSettings'>
}

export interface OpenedPublicRsvp {
  readonly event: Event
  readonly invite: GuestInvite
  readonly served: ServedInvite
  readonly settings: RsvpSettings
}

export const notAvailable = (): DomainError => DomainError.notFound('guestInvite.notAvailable')

export const openPublicRsvp = async (
  deps: PublicRsvpDeps,
  rawToken: unknown,
): Promise<Result<OpenedPublicRsvp, DomainError>> => {
  const token = GuestInviteToken.create(rawToken)
  if (!token.ok) return err(notAvailable())
  const invite = await deps.invites.findByToken(token.value)
  if (invite === null) return err(notAvailable())
  const event = await deps.events.findById(invite.eventId)
  if (event === null) return err(notAvailable())
  const served = servedInviteOf(event, invite)
  if (served === null) return err(notAvailable())
  const settings = (await deps.invites.findRsvpSettings(event.id)) ?? DEFAULT_RSVP_SETTINGS
  return ok({ event, invite, served, settings })
}

/** Where the window stands now. The people already coming are read only when places are limited. */
export const stateOfOpened = async (
  opened: OpenedPublicRsvp,
  rsvps: Pick<GuestRsvpRepository, 'listByEvent'>,
  now: Date,
): Promise<RsvpState> => {
  const { event, invite, settings } = opened
  const held = settings.form.capacity === null ? [] : await rsvps.listByEvent(event.id)
  const yesPeople = held
    .filter((rsvp) => rsvp.answer === 'yes')
    .reduce((sum, rsvp) => sum + rsvp.people, 0)
  return rsvpStateOf(settings, invite, event, now, { yesPeople })
}

/** A write needs the window open: `409 rsvp.off` when replies are not asked, `409 rsvp.closed` once stopped. */
export const requireWritable = (state: RsvpState): Result<void, DomainError> => {
  if (guestMayWrite(state)) return ok(undefined)
  return err(DomainError.conflict(state === 'off' ? 'rsvp.off' : 'rsvp.closed'))
}

/** The longest edit token the door looks at: ours are 43 characters, anything longer is not one. */
const EDIT_TOKEN_MAX = 128

export interface OwnRsvpDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'findByEditTokenHash'>
  readonly secrets: SecretTokens
}

/**
 * The reply the presented token stands for, **in this event only** (CLAUDE.md section 3, rule 5):
 * a token valid for another event, an unknown one, an empty or oversized one, or one that is not
 * text at all is the same `404 rsvp.notFound`.
 */
export const findOwnRsvp = async (
  deps: OwnRsvpDeps,
  event: Event,
  rawEditToken: unknown,
): Promise<Result<GuestRsvp, DomainError>> => {
  const notFound = (): Result<GuestRsvp, DomainError> => err(DomainError.notFound('rsvp.notFound'))
  if (
    typeof rawEditToken !== 'string' ||
    rawEditToken.length === 0 ||
    rawEditToken.length > EDIT_TOKEN_MAX
  ) {
    return notFound()
  }
  const found = await deps.rsvps.findByEditTokenHash(event.id, deps.secrets.digestOf(rawEditToken))
  if (found === null || found.editTokenHash === null) return notFound()
  // The second line: a repository that matched loosely must not turn a near miss into a key.
  return deps.secrets.verify(rawEditToken, found.editTokenHash) ? ok(found) : notFound()
}
