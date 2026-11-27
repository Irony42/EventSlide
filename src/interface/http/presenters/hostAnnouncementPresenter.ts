import type { HostAnnouncementList } from '../../../application/usecases/site/listHostAnnouncements'
import type { SentHostAnnouncement } from '../../../application/usecases/site/sendHostAnnouncement'
import type { SiteAnnouncementDto, SiteAnnouncementListDto, SiteAnnouncementSentDto } from './dto'

/** The announcements page's answer: the operator's own words and numbers, no address and no host's text. */
export const toSiteAnnouncementListDto = (list: HostAnnouncementList): SiteAnnouncementListDto => ({
  recipients: list.recipients,
  items: list.items.map(({ announcement, delivered }): SiteAnnouncementDto => ({
    id: announcement.id,
    subject: announcement.subject,
    text: announcement.text,
    link: announcement.link,
    createdAt: announcement.createdAt.toISOString(),
    finishedAt: announcement.finishedAt === null ? null : announcement.finishedAt.toISOString(),
    delivered,
  })),
})

export const toSiteAnnouncementSentDto = (sent: SentHostAnnouncement): SiteAnnouncementSentDto => ({
  id: sent.id,
  recipients: sent.recipients,
})
