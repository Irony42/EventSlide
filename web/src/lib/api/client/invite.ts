import type { Transport } from '../../http'
import type { GuestInvitePageDto, GuestInviteResponse } from '../dto'
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

export const guestInviteApi = (transport: Transport) => ({
  /**
   * What the invitation's page shows. `404 guestInvite.notAvailable` for a link that is dead,
   * whatever killed it: the server gives one answer for all of them.
   */
  guestInvitePage: (token: string, signal?: AbortSignal): Promise<GuestInvitePageDto> =>
    transport.get(`/api/i/${encode(token)}`, undefined, signal),

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
