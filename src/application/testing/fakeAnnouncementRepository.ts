import { Announcement } from '../../domain/announcements/announcement'
import { hasRoomForAnnouncement } from '../../domain/announcements/announcementRules'
import { announcementsOverlap } from '../../domain/announcements/announcementSchedule'
import type { AnnouncementId, EventId } from '../../domain/shared/ids'
import type {
  AnnouncementRepository,
  CreateAnnouncementOutcome,
  SaveAnnouncementOutcome,
} from '../ports/announcementRepository'

/**
 * In-memory `AnnouncementRepository`, behaving the way the SQLite adapter must: the same order
 * (moment, then id), the same two refusals, the same scoping by event. The shared contract suite
 * holds both to it.
 */
export class FakeAnnouncementRepository implements AnnouncementRepository {
  private rows: Announcement[] = []

  /** Puts rows in without the checks, for a test that needs a state the rules would refuse. */
  seed(...announcements: readonly Announcement[]): this {
    this.rows.push(...announcements)
    return this
  }

  private forEvent(eventId: EventId): Announcement[] {
    return this.rows
      .filter((row) => row.eventId === eventId)
      .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async listByEvent(eventId: EventId): Promise<readonly Announcement[]> {
    return this.forEvent(eventId)
  }

  async findById(eventId: EventId, id: AnnouncementId): Promise<Announcement | null> {
    return this.forEvent(eventId).find((row) => row.id === id) ?? null
  }

  async listAround(eventId: EventId, from: Date, limit: number): Promise<readonly Announcement[]> {
    return this.forEvent(eventId)
      .filter((row) => row.at.getTime() >= from.getTime())
      .slice(0, limit)
  }

  async tryCreate(
    announcement: Announcement,
    ceiling: number,
  ): Promise<CreateAnnouncementOutcome> {
    const held = this.forEvent(announcement.eventId)
    if (!hasRoomForAnnouncement(held.length, ceiling)) return 'limitReached'
    if (held.some((row) => announcementsOverlap(row, announcement))) return 'overlap'
    this.rows.push(announcement)
    return 'created'
  }

  async trySave(announcement: Announcement): Promise<SaveAnnouncementOutcome> {
    const held = this.forEvent(announcement.eventId)
    const existing = held.find((row) => row.id === announcement.id)
    if (existing === undefined) return 'notFound'
    if (held.some((row) => row.id !== announcement.id && announcementsOverlap(row, announcement))) {
      return 'overlap'
    }
    // Who created it, and when, are never rewritten by a save (the SQL update leaves them alone).
    const kept = Announcement.restore({
      ...announcement.toProps(),
      createdBy: existing.toProps().createdBy,
      createdAt: existing.toProps().createdAt,
    })
    this.rows = this.rows.map((row) =>
      row.eventId === announcement.eventId && row.id === announcement.id ? kept : row,
    )
    return 'saved'
  }

  async delete(eventId: EventId, id: AnnouncementId): Promise<boolean> {
    const before = this.rows.length
    this.rows = this.rows.filter((row) => !(row.eventId === eventId && row.id === id))
    return this.rows.length < before
  }
}
