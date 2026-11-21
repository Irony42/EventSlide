import type { GuestInvite } from '../../domain/guestInvites/guestInvite'
import type { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import type { EventId } from '../../domain/shared/ids'
import type { GuestInviteRepository } from '../ports/guestInviteRepository'

/**
 * In-memory `GuestInviteRepository`: one row per event, a token that no two events share (the
 * SQLite adapter's unique index), a save that replaces. The shared contract suite holds both.
 */
export class FakeGuestInviteRepository implements GuestInviteRepository {
  private readonly rows = new Map<string, GuestInvite>()

  /** Puts a row in without any check, for a test that needs a state the rules would refuse. */
  seed(...invites: readonly GuestInvite[]): this {
    for (const invite of invites) this.rows.set(invite.eventId, invite)
    return this
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

  async save(invite: GuestInvite): Promise<void> {
    for (const held of this.rows.values()) {
      if (held.eventId !== invite.eventId && held.token.equals(invite.token)) {
        throw new Error('UNIQUE constraint failed: guest_invites.token')
      }
    }
    this.rows.set(invite.eventId, invite)
  }
}
