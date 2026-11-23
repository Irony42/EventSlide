import type { Transport } from '../../http'
import type {
  GuestInvitePageDto,
  GuestInviteResponse,
  GuestOwnRsvpResponseDto,
  GuestRsvpCreatedDto,
} from '../dto'
import { encode } from './shared'

// The guest invitation (spec 29): what a guest opens by its link, and the owner's side of it.

/**
 * What a save sends: every field optional. **An absent one is left as it was, `null` clears it**;
 * the instants are ISO 8601 with an offset, and a start needs the zone it is read in.
 */
export interface GuestInviteInput {
  readonly title?: string | null
  readonly startsAt?: string | null
  readonly endsAt?: string | null
  readonly timeZone?: string | null
  readonly venueName?: string | null
  readonly address?: string | null
  readonly message?: string | null
  readonly language?: string
}

/**
 * What a guest sends of their reply (spec 30): the same fields the form asks. Nothing else is
 * accepted by the server: no source, no household, no token.
 */
export interface GuestRsvpInput {
  readonly name: string
  readonly answer: 'yes' | 'maybe' | 'no'
  readonly adults?: number
  readonly kids?: number
  readonly diet?: string | null
  readonly message?: string | null
}

/** The creation adds the honeypot: a hidden field a person leaves empty and a script fills. */
export interface GuestRsvpCreateInput extends GuestRsvpInput {
  readonly website?: string
}

/** The guest's token travels in this header, never in a path or a query (those reach access logs). */
const rsvpToken = (editToken: string): Readonly<Record<string, string>> => ({
  'X-Rsvp-Token': editToken,
})

export const guestInviteApi = (transport: Transport) => ({
  /**
   * What the invitation's page shows. `404 guestInvite.notAvailable` for a link that is dead,
   * whatever killed it: the server gives one answer for all of them.
   */
  guestInvitePage: (token: string, signal?: AbortSignal): Promise<GuestInvitePageDto> =>
    transport.get(`/api/i/${encode(token)}`, undefined, signal),

  /**
   * A guest answers (spec 30): `201` with the reply and **the token to keep**, shown once.
   * `409 rsvp.closed` / `rsvp.off`, `409 rsvp.tooMany`, the domain's `400 rsvp.*` codes.
   */
  guestRsvpCreate: (
    token: string,
    input: GuestRsvpCreateInput,
    signal?: AbortSignal,
  ): Promise<GuestRsvpCreatedDto> => transport.post(`/api/i/${encode(token)}/rsvp`, input, signal),

  /** The reply the token stands for; `404 rsvp.notFound` for a token the box does not know. */
  guestRsvp: (
    token: string,
    editToken: string,
    signal?: AbortSignal,
  ): Promise<GuestOwnRsvpResponseDto> =>
    transport.get(`/api/i/${encode(token)}/rsvp`, undefined, signal, rsvpToken(editToken)),

  /** Only while the window is open (`409 rsvp.closed`). */
  guestRsvpUpdate: (
    token: string,
    editToken: string,
    input: GuestRsvpInput,
    signal?: AbortSignal,
  ): Promise<GuestOwnRsvpResponseDto> =>
    transport.put(`/api/i/${encode(token)}/rsvp`, input, signal, rsvpToken(editToken)),

  /** Always, while the page is served: the right to erase does not end with the window. */
  guestRsvpDelete: (token: string, editToken: string, signal?: AbortSignal): Promise<void> =>
    transport.del(`/api/i/${encode(token)}/rsvp`, signal, rsvpToken(editToken)),

  /** The owner's reading: `configured: false` and the blanks to start from until something is saved. */
  guestInvite: (slug: string, signal?: AbortSignal): Promise<GuestInviteResponse> =>
    transport.get(`/api/events/${encode(slug)}/guest-invite`, undefined, signal),

  saveGuestInvite: (slug: string, input: GuestInviteInput): Promise<GuestInviteResponse> =>
    transport.put(`/api/events/${encode(slug)}/guest-invite`, input),

  /** "Activer l'invitation": needs a start (`400 guestInvite.needsDate`). */
  enableGuestInvite: (slug: string): Promise<GuestInviteResponse> =>
    transport.post(`/api/events/${encode(slug)}/guest-invite/enable`, {}),

  /** The text and the link are kept: switching on again gives the same link. */
  disableGuestInvite: (slug: string): Promise<GuestInviteResponse> =>
    transport.post(`/api/events/${encode(slug)}/guest-invite/disable`, {}),

  /** "Changer le lien": the old link, and every QR printed with it, stops at once. */
  rotateGuestInviteToken: (slug: string): Promise<GuestInviteResponse> =>
    transport.post(`/api/events/${encode(slug)}/guest-invite/rotate`, {}),
})
