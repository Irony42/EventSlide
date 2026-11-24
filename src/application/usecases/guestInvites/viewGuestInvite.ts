import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { servedInviteOf, type ServedInvite } from '../../../domain/guestInvites/inviteStateOf'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { DEFAULT_RSVP_SETTINGS } from '../../../domain/guestRsvps/rsvpSettings'
import type { RsvpForm } from '../../../domain/guestRsvps/rsvpForm'
import { acceptsGuestbookEntries } from '../../../domain/guestbook/guestbookWindow'
import { PROOF_MAX_NAMES, proofFrom, type RsvpProof } from '../../../domain/guestRsvps/rsvpStats'
import type { RsvpState } from '../../../domain/guestRsvps/rsvpWindow'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { stateOfOpened } from '../guestRsvps/publicRsvpAccess'

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

/**
 * What the page tells a guest about answering (spec 30): where the window stands, until which day,
 * the questions the host asks (**only what the guest must see**: not the closing instant, not the
 * stored form's lots to come), and, when the host chose to show who comes, the proof.
 */
export interface GuestRsvpPageView {
  readonly state: RsvpState
  /** A local day, read in the invitation's zone, or `null`. */
  readonly deadline: string | null
  readonly form: {
    readonly maybe: boolean
    readonly partySize: { readonly enabled: boolean; readonly max: number }
    readonly kidsSeparate: boolean
    readonly diet: boolean
    readonly companionNames: boolean
    readonly meals: { readonly enabled: boolean; readonly options: readonly string[] }
    readonly questions: RsvpForm['questions']
    readonly visibility: RsvpForm['visibility']
    /** The moments of the party the guest chooses among; empty when the host has none. */
    readonly moments: RsvpForm['moments']
    /** The places are limited (lot 4): the page says so before answering. Never the number nor the count. */
    readonly limited: boolean
  }
  /** `null` unless the host asked to show it **and** replies are still part of the story. */
  readonly proof: RsvpProof | null
  /**
   * A guest who answered "no" may leave a word in the guestbook (lot 4): the host allows it, the guestbook is
   * switched on and takes entries now (live, or closed for less than seven days). The page shows the button
   * only with this **and** the guest's own "no".
   */
  readonly absentNoteAvailable: boolean
}

export interface GuestInviteView {
  /** Every served page carries it; with `state: 'off'` the page shows no block. */
  readonly rsvp: GuestRsvpPageView
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
  readonly rsvps: Pick<GuestRsvpRepository, 'yesPeople' | 'showNames'>
  readonly clock: Clock
}

export type ViewGuestInvite = (input: {
  readonly token: unknown
}) => Promise<Result<GuestInviteView, DomainError>>

const notAvailable = (): DomainError => DomainError.notFound('guestInvite.notAvailable')

export const makeViewGuestInvite =
  ({ events, invites, rsvps, clock }: ViewGuestInviteDeps): ViewGuestInvite =>
  async ({ token: raw }) => {
    const token = GuestInviteToken.create(raw)
    if (!token.ok) return err(notAvailable())

    const invite = await invites.findByToken(token.value)
    if (invite === null) return err(notAvailable())
    const event = await events.findById(invite.eventId)
    if (event === null) return err(notAvailable())

    const served = servedInviteOf(event, invite)
    if (served === null) return err(notAvailable())

    const settings = (await invites.findRsvpSettings(event.id)) ?? DEFAULT_RSVP_SETTINGS
    const { form } = settings
    const state = await stateOfOpened({ event, invite, served, settings }, rsvps, clock.now())
    // The proof reads the replies only when the host asked for it, and never once nothing is asked.
    const proof =
      state === 'off' || form.visibility === 'off'
        ? null
        : proofFrom(
            {
              yesPeople: await rsvps.yesPeople(event.id),
              names:
                form.visibility === 'names' ? await rsvps.showNames(event.id, PROOF_MAX_NAMES) : [],
            },
            form.visibility,
          )
    const rsvp: GuestRsvpPageView = {
      state,
      deadline: settings.deadline,
      form: {
        maybe: form.maybe,
        partySize: { enabled: form.partySize.enabled, max: form.partySize.max },
        kidsSeparate: form.kidsSeparate,
        diet: form.diet,
        companionNames: form.companionNames,
        // The menus are not told while they are off: nothing the host has not asked leaves the box.
        meals: form.meals.enabled ? form.meals : { enabled: false, options: [] },
        questions: form.questions,
        visibility: form.visibility,
        moments: form.moments,
        limited: form.capacity !== null,
      },
      proof,
      absentNoteAvailable:
        form.absentNote &&
        event.settings.allowGuestbook &&
        acceptsGuestbookEntries(event, clock.now()),
    }

    const { content } = invite
    const base = {
      rsvp,
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
