import type {
  HostAnnouncement,
  HostAnnouncementDraft,
} from '../../domain/hostAnnouncements/hostAnnouncement'
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

  /** One account per address, the lowest id when two differ only by case: the one a recipient is read as. */
  private audience(): [string, { email: string; active: boolean }][] {
    const byAddress = new Map<string, [string, { email: string; active: boolean }]>()
    for (const entry of [...this.owners.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!entry[1].active) continue
      const key = entry[1].email.toLowerCase()
      if (!byAddress.has(key)) byAddress.set(key, entry)
    }
    return [...byAddress.values()]
  }

  /** The addresses an announcement already reached, lower-cased: an account of the same address is not owed another. */
  private reachedAddresses(announcementId: string): Set<string> {
    const addresses = new Set<string>()
    for (const userId of this.deliveries.get(announcementId)?.keys() ?? []) {
      const owner = this.owners.get(userId)
      if (owner !== undefined) addresses.add(owner.email.toLowerCase())
    }
    return addresses
  }

  async listRecent(limit: number): Promise<readonly HostAnnouncementProgress[]> {
    const rows = [...this.rows.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limit)
    const listed: HostAnnouncementProgress[] = []
    for (const announcement of rows) {
      const delivered = this.deliveries.get(announcement.id)?.size ?? 0
      const owed =
        announcement.finishedAt === null
          ? delivered +
            (await this.pendingRecipients(announcement.id, Number.MAX_SAFE_INTEGER)).length
          : delivered
      listed.push({ announcement, delivered, owed })
    }
    return listed
  }

  async unfinished(): Promise<readonly HostAnnouncement[]> {
    return [...this.rows.values()]
      .filter((row) => row.finishedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
  }

  async countRecipients(): Promise<number> {
    return this.audience().length
  }

  async pendingRecipients(
    announcementId: string,
    limit: number,
  ): Promise<readonly PendingRecipient[]> {
    const reached = this.reachedAddresses(announcementId)
    return this.audience()
      .filter(([, owner]) => !reached.has(owner.email.toLowerCase()))
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

  async forgetDelivery(announcementId: string, userId: string): Promise<void> {
    this.deliveries.get(announcementId)?.delete(userId)
  }

  async existsDuplicate(draft: HostAnnouncementDraft, since: Date): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) =>
        row.subject === draft.subject &&
        row.text === draft.text &&
        row.link === draft.link &&
        (row.finishedAt === null || row.createdAt.getTime() >= since.getTime()),
    )
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
