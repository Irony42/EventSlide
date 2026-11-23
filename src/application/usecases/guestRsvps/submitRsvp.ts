import {
  GuestRsvp,
  parseRsvpInput,
  type RawRsvpInput,
  type RsvpInput,
} from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { SecretTokens } from '../../ports/secretTokens'
import {
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
 * - **the honeypot**: a filled `website` field is a script. It is judged like a real reply (so the
 *   refusals do not give the trap away) and gets the same `201` shape and a token that opens
 *   nothing; nothing is written or announced. A real browser that keeps the token finds `404` on
 *   its next read and forgets it.
 *
 * A guest's reply is not audited (volume, and no value as proof), but the host's page is told that
 * something changed (`rsvp.changed`, no content, moderation stream only).
 */

export interface SubmitRsvpInput extends RawRsvpInput {
  readonly token: unknown
  /** The hidden field of the form: a person leaves it empty. */
  readonly website?: unknown
}

export interface SubmittedRsvp {
  readonly rsvp: GuestRsvp
  /** Shown once, never stored: its digest is. */
  readonly editToken: string
}

export interface SubmitRsvpDeps extends PublicRsvpDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'admit' | 'listByEvent'>
  readonly secrets: SecretTokens
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

export type SubmitRsvp = (input: SubmitRsvpInput) => Promise<Result<SubmittedRsvp, DomainError>>

export const makeSubmitRsvp =
  (deps: SubmitRsvpDeps): SubmitRsvp =>
  async ({ token, website, ...raw }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event, settings } = opened.value
    const now = deps.clock.now()
    const minted = deps.secrets.mint()
    const build = (reply: RsvpInput): GuestRsvp =>
      GuestRsvp.create({
        id: deps.ids.guestRsvpId(),
        eventId: event.id,
        householdId: null,
        editTokenHash: minted.digest,
        reply,
        source: 'open',
        now,
      })

    if (typeof website === 'string' && website.length > 0) {
      const judged = parseRsvpInput(settings.form, raw)
      if (!judged.ok) return judged
      return ok({ rsvp: build(judged.value), editToken: minted.token })
    }

    const writable = requireWritable(await stateOfOpened(opened.value, deps.rsvps, now))
    if (!writable.ok) return writable
    const judged = parseRsvpInput(settings.form, raw)
    if (!judged.ok) return judged

    const rsvp = build(judged.value)
    const admission = await deps.rsvps.admit(rsvp, { capacity: settings.form.capacity })
    if (admission.kind === 'refused') {
      return err(DomainError.conflict(admission.refusal === 'full' ? 'rsvp.full' : 'rsvp.tooMany'))
    }
    announceRsvpsChanged(deps.bus, event.id)
    return ok({ rsvp, editToken: minted.token })
  }
