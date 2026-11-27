import type { HostAnnouncement } from '../../domain/hostAnnouncements/hostAnnouncement'

/** An announcement and how far it has gone. */
export interface HostAnnouncementProgress {
  readonly announcement: HostAnnouncement
  /** How many accounts it reached so far (deliveries still kept: they are erased 30 days after it finished). */
  readonly delivered: number
}

/** An account an announcement is still owed to: its id and its address, read now. */
export interface PendingRecipient {
  readonly userId: string
  readonly email: string
}

/**
 * The announcements the operator writes to the hosts and who they reached (spec 32, lot 2, A8; migration 043).
 *
 * **Who is owed one** is read at each batch, never stored: the **active** accounts (not switched off) that own **at least one
 * client**, once each, minus those already reached. An address belongs to one account, so "one mail per address" is "one per
 * account".
 */
export interface HostAnnouncementRepository {
  create(announcement: HostAnnouncement): Promise<void>

  /** The most recent announcements first, with how many accounts each reached. */
  listRecent(limit: number): Promise<readonly HostAnnouncementProgress[]>

  /** The announcements still going out, oldest first. */
  unfinished(): Promise<readonly HostAnnouncement[]>

  /** How many accounts an announcement written now would reach: the active owners of at least one client. */
  countRecipients(): Promise<number>

  /** Up to `limit` accounts this announcement is still owed to, by id, so two passes read the same order. */
  pendingRecipients(announcementId: string, limit: number): Promise<readonly PendingRecipient[]>

  /**
   * Notes an account as reached. **`true` to one call only**: the one that wrote the row, which is the one that sends (noted
   * before sent), so a pass that lost the race, or a restart, never writes to the same account twice.
   */
  recordDelivery(announcementId: string, userId: string, at: Date): Promise<boolean>

  /** Says it is done. Only an unfinished announcement is changed: the first instant is kept. */
  finish(announcementId: string, at: Date): Promise<void>

  /** Erases the record of who was reached by announcements that finished before `cutoff`. Returns how many rows. */
  deleteDeliveriesFinishedBefore(cutoff: Date): Promise<number>

  /** Erases the announcements written before `cutoff`, and their deliveries. Returns how many announcements. */
  deleteCreatedBefore(cutoff: Date): Promise<number>
}
