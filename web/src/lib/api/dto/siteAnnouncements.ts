/**
 * An announcement the operator wrote to the hosts, and how far it has gone (spec 32, A8): `GET /api/site/announcements`.
 * The text is the operator's own, untranslated; `delivered` is a count of accounts, never who.
 */
export interface SiteAnnouncementDto {
  readonly id: string
  readonly subject: string
  readonly text: string
  readonly link: string | null
  readonly createdAt: string
  /** When the last recipient was reached, `null` while it is going out. */
  readonly finishedAt: string | null
  readonly delivered: number
  /** How many accounts it is owed to in all (what is left to send included while it goes out). */
  readonly owed: number
}

/** What the announcements page reads: the size of the audience now, and the past announcements, newest first. */
export interface SiteAnnouncementListDto {
  readonly recipients: number
  readonly items: readonly SiteAnnouncementDto[]
}

/** What writing an announcement answers (`202`: nothing is sent yet): its id and how many accounts it is owed to. */
export interface SiteAnnouncementSentDto {
  readonly id: string
  readonly recipients: number
}
