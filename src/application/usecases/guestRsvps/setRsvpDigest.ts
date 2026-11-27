import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { MailPreferenceRepository } from '../../ports/mailPreferenceRepository'
import { openRsvps, type RsvpAccessDeps } from './rsvpAccess'

/**
 * An owner ticks, or unticks, the daily summary of the replies for this event (spec 32, R2).
 *
 * **It is the owner's own row**: the one membership of the actor, never another member's (the route takes no user, and a
 * moderator is refused at the door, which is the owner's). Asked like any read, so a suspended client's host may still
 * switch it off (`openRsvps` in `read` mode); an event the operator took down is `404` as everywhere. Idempotent, and it
 * changes nothing about the replies: nothing is audited, announced or sent.
 *
 * The account's own switch (`mail_rsvp`) is a different thing and beats this one when it is off: the summary then does
 * not leave, whatever is ticked here, and the page says so.
 */

export interface SetRsvpDigestInput {
  readonly eventId: EventId
  /** From the session. */
  readonly actorId: UserId
  readonly on: boolean
}

export interface SetRsvpDigestDeps extends RsvpAccessDeps {
  readonly preferences: Pick<MailPreferenceRepository, 'setDigest'>
}

export type SetRsvpDigest = (input: SetRsvpDigestInput) => Promise<Result<void, DomainError>>

export const makeSetRsvpDigest =
  (deps: SetRsvpDigestDeps): SetRsvpDigest =>
  async ({ eventId, actorId, on }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    await deps.preferences.setDigest(eventId, actorId, on)
    return ok(undefined)
  }
