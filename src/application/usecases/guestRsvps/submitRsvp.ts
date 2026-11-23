import { formForHousehold } from '../../../domain/guestRsvps/household'
import {
  GuestRsvp,
  parseRsvpInput,
  retainExtras,
  type RawRsvpInput,
  type RsvpInput,
} from '../../../domain/guestRsvps/rsvp'
import { rsvpRefusalFor, type RsvpRefusal } from '../../../domain/guestRsvps/rsvpLimits'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { SecretTokens } from '../../ports/secretTokens'
import {
  findHouseholdByLink,
  openPublicRsvp,
  requireWritable,
  stateOfOpened,
  type PublicRsvpDeps,
} from './publicRsvpAccess'
import { announceRsvpsChanged } from './rsvpAccess'

/**
 * A guest answers on the invitation's page (spec 30): the first public write nobody is signed in
 * for.
 *
 * - Judged by the **same form** the host's replies are, `source: 'open'`;
 * - only while the window is open (`409 rsvp.closed`, `409 rsvp.off`), after the page's own
 *   refusal (`404 guestInvite.notAvailable`);
 * - the **thousand-reply ceiling** is decided inside the repository's write (`409 rsvp.tooMany`);
 * - **the token is minted here and handed back once**: only its SHA-256 is stored. It gives read,
 *   change and deletion of this one reply, and nothing else;
 * - **the honeypot**: a filled `website` field is a script. It gets **every refusal a real reply
 *   would** (the window, the form, the thousand-reply ceiling, the places: the ceilings are judged
 *   read-only, by the same function, from two counts), so no status code gives the trap away. When
 *   nothing refuses it: the same `201` shape and a token that opens nothing, and nothing is written
 *   or announced. A real browser that keeps the token finds `404` on its next read and forgets it.
 *
 * - **With a household's link** (`householdToken`, lot 3) the reply is the household's one: judged
 *   by the household's form (its places are the ceiling), `source: 'household'`, **no token of its
 *   own** (the link is the key, every device of the household shares it), and a household that
 *   already answered has its reply **changed**, not doubled (`created: false`). An unknown link is
 *   `404 rsvp.notFound`, in the honeypot's order too.
 *
 * A guest's reply is not audited (volume, and no value as proof), but the host's page is told that
 * something changed (`rsvp.changed`, no content, moderation stream only).
 */

export interface SubmitRsvpInput extends RawRsvpInput {
  readonly token: unknown
  /** The hidden field of the form: a person leaves it empty. */
  readonly website?: unknown
  /** The household's link, from the `X-Household-Token` header (lot 3). */
  readonly householdToken?: unknown
}

export interface SubmittedRsvp {
  readonly rsvp: GuestRsvp
  /** Shown once, never stored: its digest is. */
  /** `null` for a household's reply: its link is its key. */
  readonly editToken: string | null
  /** `false` when the household's existing reply was changed. */
  readonly created: boolean
}

export interface SubmitRsvpDeps extends PublicRsvpDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'admit' | 'count' | 'yesPeople' | 'findByHousehold'>
  readonly households: Pick<GuestHouseholdRepository, 'findByToken'>
  readonly secrets: SecretTokens
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

const refused = (refusal: RsvpRefusal): DomainError =>
  DomainError.conflict(refusal === 'full' ? 'rsvp.full' : 'rsvp.tooMany')

export type SubmitRsvp = (input: SubmitRsvpInput) => Promise<Result<SubmittedRsvp, DomainError>>

export const makeSubmitRsvp =
  (deps: SubmitRsvpDeps): SubmitRsvp =>
  async ({ token, website, householdToken, ...raw }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event, settings } = opened.value
    const now = deps.clock.now()
    // The household's link comes first: a wrong one is `404` whatever else is wrong with the call.
    const household =
      householdToken === undefined ? null : await findHouseholdByLink(deps, event, householdToken)
    if (household !== null && !household.ok) return household
    const kept = household === null ? null : household.value
    const minted = kept === null ? deps.secrets.mint() : null
    const form = kept === null ? settings.form : formForHousehold(settings.form, kept)
    const build = (reply: RsvpInput): GuestRsvp =>
      GuestRsvp.create({
        id: deps.ids.guestRsvpId(),
        eventId: event.id,
        householdId: kept === null ? null : kept.id,
        editTokenHash: minted === null ? null : minted.digest,
        reply,
        source: kept === null ? 'open' : 'household',
        now,
      })
    const editToken = minted === null ? null : minted.token

    // The same refusals, in the same order, whatever the honeypot says: a script must not tell the
    // trap by a status code. The window, the form, then the two ceilings.
    const writable = requireWritable(await stateOfOpened(opened.value, deps.rsvps, now))
    if (!writable.ok) return writable
    const judged = parseRsvpInput(form, raw)
    if (!judged.ok) return judged
    // A household has one reply: when it already answered, this is a change of that reply, which
    // keeps what the form no longer asks (as a guest's own change does).
    const existing = kept === null ? null : await deps.rsvps.findByHousehold(event.id, kept.id)
    const rsvp =
      existing === null
        ? build(judged.value)
        : existing.withReply(
            {
              ...judged.value,
              extras: retainExtras(
                form,
                existing.details,
                judged.value.extras,
                judged.value.answer,
              ),
            },
            now,
          )

    if (typeof website === 'string' && website.length > 0) {
      // Judged **read-only**, by the very function `admit` decides with: counts, no write.
      const refusal = rsvpRefusalFor({
        isNew: existing === null,
        heldInEvent: await deps.rsvps.count(event.id),
        answer: rsvp.answer,
        people: rsvp.people,
        yesPeopleElsewhere:
          (await deps.rsvps.yesPeople(event.id)) -
          (existing !== null && existing.answer === 'yes' ? existing.people : 0),
        capacity: settings.form.capacity,
      })
      if (refusal !== null) return err(refused(refusal))
      return ok({ rsvp, editToken, created: existing === null })
    }

    const admission = await deps.rsvps.admit(rsvp, { capacity: settings.form.capacity })
    if (admission.kind === 'refused') return err(refused(admission.refusal))
    announceRsvpsChanged(deps.bus, event.id)
    return ok({ rsvp, editToken, created: admission.kind === 'added' })
  }
