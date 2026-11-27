import type {
  HostAnnouncementProgress,
  HostAnnouncementRepository,
} from '../../ports/hostAnnouncementRepository'

/** How many past announcements the console's page lists. */
export const HOST_ANNOUNCEMENTS_LISTED = 50

export interface HostAnnouncementList {
  /** How many accounts an announcement written now would be owed to. */
  readonly recipients: number
  /** The most recent first, each with how many accounts it reached. */
  readonly items: readonly HostAnnouncementProgress[]
}

export interface ListHostAnnouncementsDeps {
  readonly announcements: Pick<HostAnnouncementRepository, 'listRecent' | 'countRecipients'>
}

export type ListHostAnnouncements = () => Promise<HostAnnouncementList>

/** What the operator's announcements page reads (spec 32, A8): the size of the audience and the past announcements. */
export const makeListHostAnnouncements =
  ({ announcements }: ListHostAnnouncementsDeps): ListHostAnnouncements =>
  async () => ({
    recipients: await announcements.countRecipients(),
    items: await announcements.listRecent(HOST_ANNOUNCEMENTS_LISTED),
  })
