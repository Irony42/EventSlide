import type { Transport } from '../../http'
import type { GuestInvitePageDto } from '../dto'
import { encode } from './shared'

// The guest invitation a guest opens by its link (spec 29).

export const guestInviteApi = (transport: Transport) => ({
  /**
   * What the invitation's page shows. `404 guestInvite.notAvailable` for a link that is dead,
   * whatever killed it: the server gives one answer for all of them.
   */
  guestInvitePage: (token: string, signal?: AbortSignal): Promise<GuestInvitePageDto> =>
    transport.get(`/api/i/${encode(token)}`, undefined, signal),
})
