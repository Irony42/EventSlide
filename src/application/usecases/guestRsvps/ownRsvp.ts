import type { Event } from '../../../domain/events/event'
import { formForHousehold, type GuestHousehold } from '../../../domain/guestRsvps/household'
import {
  parseRsvpInput,
  retainExtras,
  type GuestRsvp,
  type RawRsvpInput,
} from '../../../domain/guestRsvps/rsvp'
import { asGuestHouseholdId } from '../../../domain/shared/ids'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import {
  findHouseholdByLink,
  findOwnRsvp,
  openPublicRsvp,
  requireWritable,
  stateOfOpened,
  type PublicRsvpDeps,
} from './publicRsvpAccess'
import { announceRsvpsChanged } from './rsvpAccess'

/**
 * A guest reads, changes and deletes **their own** reply with the token they were given (spec 30,
 * section 4.3), the page's door first (`404 guestInvite.notAvailable`) and then the token, bound
 * to this event (`404 rsvp.notFound`).
 *
 * - **Read and delete: always, for as long as the invitation page is served** (an `over` page
 *   included): the right to erase one's own reply does not end with the window or with the party.
 * - **Change: only while the window is open** (`409 rsvp.closed` / `409 rsvp.off`).
 *
 * **With a household's link** (`householdToken`, lot 3) the same three acts are the household's, on
 * its **one** reply: the link is the key, there is no reply token (the household's devices share
 * it), and a change is judged by the household's form. A link that opens nothing is the same
 * `404 rsvp.notFound`, and no reply yet is `404` as well (the first answer is a `POST`). When both
 * keys are sent, the household's link is the one used.
 *
 * A change is a change **only**: if the reply was deleted a moment earlier (the guest's other tab,
 * the host), the write finds nothing and answers `404` instead of putting it back
 * (`admit(…, { changeOnly: true })`).
 */

export interface OwnRsvpDeps extends PublicRsvpDeps {
  readonly rsvps: Pick<
    GuestRsvpRepository,
    'findByEditTokenHash' | 'findByHousehold' | 'admit' | 'delete' | 'yesPeople'
  >
  readonly households: Pick<GuestHouseholdRepository, 'findByToken' | 'findById'>
  readonly secrets: SecretTokens
  readonly bus: EventBus
  readonly clock: Clock
}

export interface OwnRsvpInput {
  readonly token: unknown
  readonly editToken: unknown
  /** The household's link (`X-Household-Token`), lot 3; absent for a guest's own token. */
  readonly householdToken?: unknown
}

export type GetOwnRsvp = (input: OwnRsvpInput) => Promise<Result<GuestRsvp, DomainError>>
export type UpdateOwnRsvp = (
  input: OwnRsvpInput & RawRsvpInput,
) => Promise<Result<GuestRsvp, DomainError>>
export type DeleteOwnRsvp = (input: OwnRsvpInput) => Promise<Result<void, DomainError>>

/** The reply the caller holds the key to, and the household when the key is one's link. */
interface OwnReply {
  readonly rsvp: GuestRsvp
  readonly household: GuestHousehold | null
}

const findOwnReply = async (
  deps: OwnRsvpDeps,
  event: Event,
  { editToken, householdToken }: Omit<OwnRsvpInput, 'token'>,
): Promise<Result<OwnReply, DomainError>> => {
  if (householdToken === undefined) {
    const own = await findOwnRsvp(deps, event, editToken)
    if (!own.ok) return own
    // A reply the host filed under a household is the household's: its places are the ceiling of a
    // change made with the reply's own token too (scoped to the event). A household that is no longer
    // there (deleted: the use case detaches the reply first, so this is a defensive read) leaves the
    // general form.
    const filed = own.value.householdId
    const household =
      filed === null ? null : await deps.households.findById(event.id, asGuestHouseholdId(filed))
    return ok({ rsvp: own.value, household })
  }
  const household = await findHouseholdByLink(deps, event, householdToken)
  if (!household.ok) return household
  const rsvp = await deps.rsvps.findByHousehold(event.id, household.value.id)
  if (rsvp === null) return err(DomainError.notFound('rsvp.notFound'))
  return ok({ rsvp, household: household.value })
}

export const makeGetOwnRsvp =
  (deps: OwnRsvpDeps): GetOwnRsvp =>
  async ({ token, ...key }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const own = await findOwnReply(deps, opened.value.event, key)
    return own.ok ? ok(own.value.rsvp) : own
  }

export const makeUpdateOwnRsvp =
  (deps: OwnRsvpDeps): UpdateOwnRsvp =>
  async ({ token, editToken, householdToken, ...raw }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event, settings } = opened.value
    const own = await findOwnReply(deps, event, { editToken, householdToken })
    if (!own.ok) return own
    const form =
      own.value.household === null
        ? settings.form
        : formForHousehold(settings.form, own.value.household)

    const now = deps.clock.now()
    const writable = requireWritable(await stateOfOpened(opened.value, deps.rsvps, now))
    if (!writable.ok) return writable
    const judged = parseRsvpInput(form, raw)
    if (!judged.ok) return judged

    // What the form no longer asks stays (a removed question keeps its answers).
    const reply = {
      ...judged.value,
      extras: retainExtras(form, own.value.rsvp.details, judged.value.extras, judged.value.answer),
    }
    const changed = own.value.rsvp.withReply(reply, now)
    const admission = await deps.rsvps.admit(changed, {
      capacity: settings.form.capacity,
      changeOnly: true,
    })
    if (admission.kind === 'gone') return err(DomainError.notFound('rsvp.notFound'))
    if (admission.kind === 'refused') {
      return err(DomainError.conflict(admission.refusal === 'full' ? 'rsvp.full' : 'rsvp.tooMany'))
    }
    announceRsvpsChanged(deps.bus, event.id)
    return ok(changed)
  }

export const makeDeleteOwnRsvp =
  (deps: OwnRsvpDeps): DeleteOwnRsvp =>
  async ({ token, ...key }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event } = opened.value
    const own = await findOwnReply(deps, event, key)
    // **Idempotent**: a reply that is already gone (a double tap, the other tab, the host) or a token
    // that opens nothing is the guest's wish already done, `204`, and the answer cannot tell which.
    if (!own.ok) return ok(undefined)
    if (await deps.rsvps.delete(event.id, own.value.rsvp.id))
      announceRsvpsChanged(deps.bus, event.id)
    return ok(undefined)
  }
