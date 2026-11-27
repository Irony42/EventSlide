import type {
  HostAnnouncement,
  HostAnnouncementDraft,
} from '../../domain/hostAnnouncements/hostAnnouncement'

/** An announcement and how far it has gone. */
export interface HostAnnouncementProgress {
  readonly announcement: HostAnnouncement
  /** How many accounts it reached so far (deliveries still kept: they are erased 30 days after it finished). */
  readonly delivered: number
  /**
   * How many accounts it is owed to in all: `delivered` plus those still owed, while it goes out; `delivered` once it finished
   * (the audience of the day it ended is not read again).
   */
  readonly owed: number
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
 * client**, **once per address** (two accounts whose addresses differ only by case are one recipient), minus those already
 * reached.
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

  /**
   * Takes back a delivery that was noted but whose mail the day's budget then refused, so that the account is still owed and the
   * next pass writes to it. Nothing else ever removes a delivery before its retention.
   */
  forgetDelivery(announcementId: string, userId: string): Promise<void>

  /**
   * Whether an announcement with exactly this subject, text and link was written at or after `since`, **or is still going out**
   * (a double click, a retry after a timeout, a second tab).
   */
  existsDuplicate(draft: HostAnnouncementDraft, since: Date): Promise<boolean>

  /** Says it is done. Only an unfinished announcement is changed: the first instant is kept. */
  finish(announcementId: string, at: Date): Promise<void>

  /** Erases the record of who was reached by announcements that finished before `cutoff`. Returns how many rows. */
  deleteDeliveriesFinishedBefore(cutoff: Date): Promise<number>

  /** Erases the announcements written before `cutoff`, and their deliveries. Returns how many announcements. */
  deleteCreatedBefore(cutoff: Date): Promise<number>
}
