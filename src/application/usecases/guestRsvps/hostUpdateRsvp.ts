import {
  parseRsvpInput,
  type GuestRsvp,
  type RawRsvpInput,
  type RsvpInput,
} from '../../../domain/guestRsvps/rsvp'
import { retainExtras } from '../../../domain/guestRsvps/rsvp'
import { formForHousehold } from '../../../domain/guestRsvps/household'
import type { RsvpForm } from '../../../domain/guestRsvps/rsvpForm'
import { DomainError } from '../../../domain/shared/errors'
import {
  asGuestHouseholdId,
  type EventId,
  type GuestRsvpId,
  type UserId,
} from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import {
  announceRsvpsChanged,
  keepOwnWriteSeen,
  openRsvps,
  recordRsvpAct,
  requireInvite,
  type RsvpAccessDeps,
} from './rsvpAccess'

/**
 * The host corrects a reply (spec 30). The whole reply is sent again, judged by the form of the
 * moment; the id, the guest's token, the source and the creation instant stay. **Not held to the
 * places**: a host who edits decides. `404 rsvp.notFound` for a reply that is not this event's or
 * that is gone (nothing is audited or announced then).
 *
 * **What the form no longer asks is kept, not wiped**: a host who switched off "allergies" or
 * "how many" after guests answered must not erase what they gave by correcting a name. And a reply
 * on the waiting list stays there when the host sends `waitlist` back unchanged; sending `yes` is
 * the promotion.
 */

export interface HostUpdateRsvpInput extends RawRsvpInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly rsvpId: GuestRsvpId
}

export interface HostUpdateRsvpDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'findById' | 'update' | 'unseenCount' | 'markSeen'>
  readonly households: Pick<GuestHouseholdRepository, 'findById'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type HostUpdateRsvp = (input: HostUpdateRsvpInput) => Promise<Result<GuestRsvp, DomainError>>

/** The judged reply, with what the form does not ask taken from what was stored. */
const keepingWhatIsNotAsked = (form: RsvpForm, held: GuestRsvp, reply: RsvpInput): RsvpInput => {
  // The answers to removed questions stay whatever the answer is; the rest only between two replies
  // that bring people: a "no" holds nothing to keep.
  // **Showing a first name is the guest's choice, never the host's**: a correction keeps the guest's
  // opt-in as it was (a host's own input carries none), unless the host changes the name (what was
  // agreed to be shown is the old one), and a "no" shows nobody.
  const extras = {
    ...retainExtras(form, held.details, reply.extras, reply.answer),
    showName:
      reply.answer === 'yes' &&
      form.visibility === 'names' &&
      reply.name === held.name &&
      held.details.showName,
  }
  if (reply.answer === 'no' || held.answer === 'no') return { ...reply, extras }
  const partySizeAsked = form.partySize.enabled
  return {
    ...reply,
    diet: form.diet ? reply.diet : held.diet,
    adults: partySizeAsked ? reply.adults : held.adults,
    kids: partySizeAsked && form.kidsSeparate ? reply.kids : held.kids,
    extras,
  }
}

export const makeHostUpdateRsvp =
  (deps: HostUpdateRsvpDeps): HostUpdateRsvp =>
  async ({ eventId, actorId, rsvpId, ...raw }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed

    const held = await deps.rsvps.findById(eventId, rsvpId)
    if (held === null) return err(DomainError.notFound('rsvp.notFound'))
    const now = deps.clock.now()
    // A reply filed under a household is judged by that household's form: its places are the ceiling.
    const household =
      held.householdId === null
        ? null
        : await deps.households.findById(eventId, asGuestHouseholdId(held.householdId))
    const form =
      household === null
        ? needed.value.settings.form
        : formForHousehold(needed.value.settings.form, household)

    // The waiting list is the server's to give, and the host's to keep: `waitlist` sent back for a
    // reply that is on it is judged as a `yes` (the form's rules) and put back as it was.
    const keepsWaitlist = held.answer === 'waitlist' && raw.answer === 'waitlist'
    const judged = parseRsvpInput(form, keepsWaitlist ? { ...raw, answer: 'yes' } : raw)
    if (!judged.ok) return judged
    const reply = keepingWhatIsNotAsked(form, held, judged.value)

    const unseenBefore = await deps.rsvps.unseenCount(eventId, actorId)
    const changed = held.withReply(keepsWaitlist ? { ...reply, answer: 'waitlist' } : reply, now)
    // A reply that went between the read and here: nothing was changed, so nothing is said.
    if (!(await deps.rsvps.update(changed))) return err(DomainError.notFound('rsvp.notFound'))

    const recorded = await recordRsvpAct(
      deps.audit,
      needed.value.event,
      actorId,
      'event.rsvpHostEdited',
      now,
    )
    if (!recorded.ok) {
      // A log that refuses the line means no act: the reply is put back as it was.
      await deps.rsvps.update(held)
      return recorded
    }
    await keepOwnWriteSeen(deps.rsvps, eventId, actorId, unseenBefore, now)
    announceRsvpsChanged(deps.bus, eventId)
    return ok(changed)
  }
