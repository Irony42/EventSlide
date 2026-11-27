import { GuestInvite } from '../../domain/guestInvites/guestInvite'
import type { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from '../../domain/guestRsvps/rsvpSettings'
import type { EventId } from '../../domain/shared/ids'
import type { GuestInviteRepository } from '../ports/guestInviteRepository'

/**
 * In-memory `GuestInviteRepository`: one row per event, a token that no two events share (the
 * SQLite adapter's unique index), and writes that each change one thing, as the adapter's
 * statements do. The shared contract suite holds both.
 */
export class FakeGuestInviteRepository implements GuestInviteRepository {
  private readonly rows = new Map<string, GuestInvite>()
  private readonly rsvp = new Map<string, RsvpSettings>()

  /** Puts a row in without any check, for a test that needs a state the rules would refuse. */
  seed(...invites: readonly GuestInvite[]): this {
    for (const invite of invites) this.rows.set(invite.eventId, invite)
    return this
  }

  private assertTokenFree(eventId: EventId, token: GuestInviteToken): void {
    for (const held of this.rows.values()) {
      if (held.eventId !== eventId && held.token.equals(token)) {
        throw new Error('UNIQUE constraint failed: guest_invites.token')
      }
    }
  }

  async findByEvent(eventId: EventId): Promise<GuestInvite | null> {
    return this.rows.get(eventId) ?? null
  }

  async findByToken(token: GuestInviteToken): Promise<GuestInvite | null> {
    for (const invite of this.rows.values()) {
      if (invite.token.equals(token)) return invite
    }
    return null
  }

  async create(invite: GuestInvite): Promise<void> {
    if (this.rows.has(invite.eventId)) {
      throw new Error('UNIQUE constraint failed: guest_invites.event_id')
    }
    this.assertTokenFree(invite.eventId, invite.token)
    this.rows.set(invite.eventId, invite)
  }

  async saveContent(invite: GuestInvite): Promise<void> {
    const held = this.rows.get(invite.eventId)
    if (held === undefined) return
    this.rows.set(
      invite.eventId,
      GuestInvite.restore({
        ...held.toProps(),
        content: invite.content,
        updatedAt: invite.updatedAt,
      }),
    )
  }

  async setEnabled(eventId: EventId, enabled: boolean, at: Date): Promise<void> {
    const held = this.rows.get(eventId)
    if (held === undefined) return
    this.rows.set(eventId, GuestInvite.restore({ ...held.toProps(), enabled, updatedAt: at }))
  }

  async findRsvpSettings(eventId: EventId): Promise<RsvpSettings | null> {
    if (!this.rows.has(eventId)) return null
    return this.rsvp.get(eventId) ?? DEFAULT_RSVP_SETTINGS
  }

  async saveRsvpSettings(eventId: EventId, settings: RsvpSettings): Promise<void> {
    if (!this.rows.has(eventId)) return
    const held = this.rsvp.get(eventId) ?? DEFAULT_RSVP_SETTINGS
    this.rsvp.set(eventId, { ...settings, closedAt: held.closedAt })
  }

  async eventsWithRsvpDeadlineBetween(fromDay: string, toDay: string): Promise<readonly EventId[]> {
    return [...this.rows.keys()]
      .filter((id) => {
        const settings = this.rsvp.get(id) ?? DEFAULT_RSVP_SETTINGS
        return (
          settings.enabled &&
          settings.closedAt === null &&
          settings.deadline !== null &&
          settings.deadline >= fromDay &&
          settings.deadline <= toDay
        )
      })
      .sort() as EventId[]
  }

  async eventsWithRsvpCapacity(startingAfter: Date): Promise<readonly EventId[]> {
    return [...this.rows.entries()]
      .filter(([id, invite]) => {
        const settings = this.rsvp.get(id) ?? DEFAULT_RSVP_SETTINGS
        const startsAt = invite.content.startsAt
        return (
          settings.enabled &&
          settings.closedAt === null &&
          settings.form.capacity !== null &&
          startsAt !== null &&
          startsAt.getTime() > startingAfter.getTime()
        )
      })
      .map(([id]) => id)
      .sort() as EventId[]
  }

  async setRsvpClosedAt(eventId: EventId, closedAt: Date | null): Promise<void> {
    if (!this.rows.has(eventId)) return
    this.rsvp.set(eventId, { ...(this.rsvp.get(eventId) ?? DEFAULT_RSVP_SETTINGS), closedAt })
  }

  async rotateToken(eventId: EventId, token: GuestInviteToken, at: Date): Promise<void> {
    const held = this.rows.get(eventId)
    if (held === undefined) return
    this.assertTokenFree(eventId, token)
    this.rows.set(eventId, held.rotate(token, at))
  }
}
