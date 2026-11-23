import {
  parseRsvpInput,
  retainExtras,
  type GuestRsvp,
  type RawRsvpInput,
} from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import {
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
 * A change is a change **only**: if the reply was deleted a moment earlier (the guest's other tab,
 * the host), the write finds nothing and answers `404` instead of putting it back
 * (`admit(…, { changeOnly: true })`).
 */

export interface OwnRsvpDeps extends PublicRsvpDeps {
  readonly rsvps: Pick<
    GuestRsvpRepository,
    'findByEditTokenHash' | 'admit' | 'delete' | 'yesPeople'
  >
  readonly secrets: SecretTokens
  readonly bus: EventBus
  readonly clock: Clock
}

export interface OwnRsvpInput {
  readonly token: unknown
  readonly editToken: unknown
}

export type GetOwnRsvp = (input: OwnRsvpInput) => Promise<Result<GuestRsvp, DomainError>>
export type UpdateOwnRsvp = (
  input: OwnRsvpInput & RawRsvpInput,
) => Promise<Result<GuestRsvp, DomainError>>
export type DeleteOwnRsvp = (input: OwnRsvpInput) => Promise<Result<void, DomainError>>

export const makeGetOwnRsvp =
  (deps: OwnRsvpDeps): GetOwnRsvp =>
  async ({ token, editToken }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    return findOwnRsvp(deps, opened.value.event, editToken)
  }

export const makeUpdateOwnRsvp =
  (deps: OwnRsvpDeps): UpdateOwnRsvp =>
  async ({ token, editToken, ...raw }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event, settings } = opened.value
    const own = await findOwnRsvp(deps, event, editToken)
    if (!own.ok) return own

    const now = deps.clock.now()
    const writable = requireWritable(await stateOfOpened(opened.value, deps.rsvps, now))
    if (!writable.ok) return writable
    const judged = parseRsvpInput(settings.form, raw)
    if (!judged.ok) return judged

    // What the form no longer asks stays (a removed question keeps its answers).
    const reply = {
      ...judged.value,
      extras:
        judged.value.answer === 'no'
          ? judged.value.extras
          : retainExtras(settings.form, own.value.details, judged.value.extras),
    }
    const changed = own.value.withReply(reply, now)
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
  async ({ token, editToken }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event } = opened.value
    const own = await findOwnRsvp(deps, event, editToken)
    // **Idempotent**: a reply that is already gone (a double tap, the other tab, the host) or a token
    // that opens nothing is the guest's wish already done, `204`, and the answer cannot tell which.
    if (!own.ok) return ok(undefined)
    if (await deps.rsvps.delete(event.id, own.value.id)) announceRsvpsChanged(deps.bus, event.id)
    return ok(undefined)
  }
