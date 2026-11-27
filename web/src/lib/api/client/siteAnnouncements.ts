import type { Transport } from '../../http'
import type { SiteAnnouncementListDto, SiteAnnouncementSentDto } from '../dto'

/** What the operator writes to the hosts (spec 32, A8): their own words, an optional https link. */
export interface HostAnnouncementInput {
  readonly subject: string
  readonly text: string
  readonly link?: string
}

/**
 * The operator's announcements to the hosts (spec 32, lot 2, A8), on a box with `SITE_ADMIN=on`. The write is behind a fresh
 * step-up, like the rest of `/api/site`; the mails go out later, by batches, from the server.
 */
export const siteAnnouncementsApi = (transport: Transport) => ({
  siteAnnouncements: (signal?: AbortSignal): Promise<SiteAnnouncementListDto> =>
    transport.get('/api/site/announcements', undefined, signal),

  siteSendAnnouncement: (input: HostAnnouncementInput): Promise<SiteAnnouncementSentDto> =>
    transport.post('/api/site/announcements', input),
})
