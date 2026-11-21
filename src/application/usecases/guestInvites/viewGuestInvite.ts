import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { servedInviteOf, type ServedInvite } from '../../../domain/guestInvites/inviteStateOf'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'

/**
 * What the public invitation page is told (spec 29): the guest opens `/i/<token>`.
 *
 * **One refusal for everything**: a token that is malformed, unknown, switched off, an event
 * archived, taken down or purged, a client suspended, an invitation with no date are all
 * `404 guestInvite.notAvailable`. The page says "cette invitation n'est plus disponible" and
 * nothing that tells which.
 *
 * The event is read **by id**, after the invitation, because that read is the only one that fills
 * the suspension and take-down facts; the invitation repository never joins it.
 *
 * What the answer holds depends on the state, and nothing more is ever put in it:
 * - `upcoming`: the details;
 * - `joinable`: the details and **the join code**, which is not exposed at any other time;
 * - `over`: the title, the date and the place's name, **no address and no word**: a closed event
 *   may be kept for years, and its address has no business staying readable behind a link.
 */

export interface GuestInviteView {
  readonly state: ServedInvite['state']
  /** The invitation's title, or the event's name when the host wrote none. */
  readonly title: string
  readonly schedule: ServedInvite['schedule']
  readonly venueName: string | null
  /** Absent once the event is over. */
  readonly address?: string | null
  /** Absent once the event is over. */
  readonly message?: string | null
  readonly language: EventLanguage
  /**
   * The event's accent, in degrees on the hue circle: the **one** field of its look the page wears
   * (the mock-up's colour), and nothing else of the theme, so no setting leaves with it.
   */
  readonly accentHue: number
  /** Whether the event has a logo; the page then asks for it by token. */
  readonly hasLogo: boolean
  /** Only while `joinable`. */
  readonly joinCode?: string
}

export interface ViewGuestInviteDeps {
  readonly events: EventRepository
  readonly invites: GuestInviteRepository
}

export type ViewGuestInvite = (input: {
  readonly token: unknown
}) => Promise<Result<GuestInviteView, DomainError>>

const notAvailable = (): DomainError => DomainError.notFound('guestInvite.notAvailable')

export const makeViewGuestInvite =
  ({ events, invites }: ViewGuestInviteDeps): ViewGuestInvite =>
  async ({ token: raw }) => {
    const token = GuestInviteToken.create(raw)
    if (!token.ok) return err(notAvailable())

    const invite = await invites.findByToken(token.value)
    if (invite === null) return err(notAvailable())
    const event = await events.findById(invite.eventId)
    if (event === null) return err(notAvailable())

    const served = servedInviteOf(event, invite)
    if (served === null) return err(notAvailable())

    const { content } = invite
    const base = {
      state: served.state,
      title: content.title ?? event.name.value,
      schedule: served.schedule,
      venueName: content.venueName,
      language: content.language,
      accentHue: event.settings.theme.accentHue,
      hasLogo: event.settings.logo !== null,
    }
    if (served.state === 'over') return ok(base)

    const details = { ...base, address: content.address, message: content.message }
    return ok(
      served.state === 'joinable' ? { ...details, joinCode: event.joinCode.value } : details,
    )
  }
