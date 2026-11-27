import type { HostAnnouncement } from '../../domain/hostAnnouncements/hostAnnouncement'
import type {
  HostAnnouncementProgress,
  HostAnnouncementRepository,
  PendingRecipient,
} from '../ports/hostAnnouncementRepository'

/**
 * In-memory `HostAnnouncementRepository`. The recipients are not in this fake's own state: a test names who owns a client
 * (`withOwner`) and who is switched off (`switchOff`), the two facts the adapter reads from the accounts and the clients.
 */
export class FakeHostAnnouncementRepository implements HostAnnouncementRepository {
  private readonly rows = new Map<string, HostAnnouncement>()
  private readonly deliveries = new Map<string, Map<string, Date>>()
  private readonly owners = new Map<string, { email: string; active: boolean }>()

  /** An account that owns a client, active until `switchOff`. */
  withOwner(userId: string, email: string): this {
    this.owners.set(userId, { email, active: true })
    return this
  }

  switchOff(userId: string): this {
    const held = this.owners.get(userId)
    if (held !== undefined) this.owners.set(userId, { ...held, active: false })
    return this
  }

  /** The accounts reached by an announcement, for a test to look at. */
  reached(announcementId: string): readonly string[] {
    return [...(this.deliveries.get(announcementId)?.keys() ?? [])].sort()
  }

  async create(announcement: HostAnnouncement): Promise<void> {
    this.rows.set(announcement.id, announcement)
  }

  async listRecent(limit: number): Promise<readonly HostAnnouncementProgress[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limit)
      .map((announcement) => ({
        announcement,
        delivered: this.deliveries.get(announcement.id)?.size ?? 0,
      }))
  }

  async unfinished(): Promise<readonly HostAnnouncement[]> {
    return [...this.rows.values()]
      .filter((row) => row.finishedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
  }

  async countRecipients(): Promise<number> {
    return [...this.owners.values()].filter((owner) => owner.active).length
  }

  async pendingRecipients(
    announcementId: string,
    limit: number,
  ): Promise<readonly PendingRecipient[]> {
    const reached = this.deliveries.get(announcementId) ?? new Map<string, Date>()
    return [...this.owners.entries()]
      .filter(([userId, owner]) => owner.active && !reached.has(userId))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, limit)
      .map(([userId, owner]) => ({ userId, email: owner.email }))
  }

  async recordDelivery(announcementId: string, userId: string, at: Date): Promise<boolean> {
    if (!this.rows.has(announcementId)) return false
    const reached = this.deliveries.get(announcementId) ?? new Map<string, Date>()
    if (reached.has(userId)) return false
    reached.set(userId, at)
    this.deliveries.set(announcementId, reached)
    return true
  }

  async finish(announcementId: string, at: Date): Promise<void> {
    const row = this.rows.get(announcementId)
    if (row === undefined || row.finishedAt !== null) return
    this.rows.set(announcementId, { ...row, finishedAt: at })
  }

  async deleteDeliveriesFinishedBefore(cutoff: Date): Promise<number> {
    let erased = 0
    for (const row of this.rows.values()) {
      if (row.finishedAt === null || row.finishedAt.getTime() >= cutoff.getTime()) continue
      erased += this.deliveries.get(row.id)?.size ?? 0
      this.deliveries.delete(row.id)
    }
    return erased
  }

  async deleteCreatedBefore(cutoff: Date): Promise<number> {
    let erased = 0
    for (const row of [...this.rows.values()]) {
      if (row.createdAt.getTime() >= cutoff.getTime()) continue
      this.rows.delete(row.id)
      this.deliveries.delete(row.id)
      erased += 1
    }
    return erased
  }
}
