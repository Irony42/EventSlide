import {
  applyMailPreferencesPatch,
  DEFAULT_MAIL_PREFERENCES,
  type MailPreferences,
  type MailPreferencesPatch,
} from '../../domain/notices/mailPreferences'
import type { EventId, UserId } from '../../domain/shared/ids'
import type {
  DigestSubscription,
  MailPreferenceRepository,
} from '../ports/mailPreferenceRepository'

const memberKey = (eventId: EventId, userId: UserId): string => `${eventId}:${userId}`

/**
 * In-memory `MailPreferenceRepository`. The accounts and memberships a write may reach are mirrored by
 * {@link FakeMailPreferenceRepository.withUsers} and {@link FakeMailPreferenceRepository.withMembers}: the
 * real columns sit on `users` and `event_memberships`, where a write for a row that is not there changes
 * nothing, and a fake that recorded it would pass tests the tables would fail.
 */
export class FakeMailPreferenceRepository implements MailPreferenceRepository {
  private readonly users = new Map<UserId, MailPreferences>()
  private readonly members = new Map<string, { on: boolean; lastAt: Date | null }>()

  /** The accounts that exist (each starts with both switches on). */
  withUsers(...ids: readonly UserId[]): this {
    for (const id of ids) {
      if (!this.users.has(id)) this.users.set(id, DEFAULT_MAIL_PREFERENCES)
    }
    return this
  }

  /** The memberships that exist (each starts with no digest). */
  withMembers(...members: readonly { readonly eventId: EventId; readonly userId: UserId }[]): this {
    for (const { eventId, userId } of members) {
      const key = memberKey(eventId, userId)
      if (!this.members.has(key)) this.members.set(key, { on: false, lastAt: null })
    }
    return this
  }

  async forUser(userId: UserId): Promise<MailPreferences> {
    return this.users.get(userId) ?? DEFAULT_MAIL_PREFERENCES
  }

  async save(userId: UserId, patch: MailPreferencesPatch): Promise<void> {
    const held = this.users.get(userId)
    if (held === undefined) return
    this.users.set(userId, applyMailPreferencesPatch(held, patch))
  }

  async digestFor(eventId: EventId, userId: UserId): Promise<DigestSubscription> {
    const row = this.members.get(memberKey(eventId, userId))
    return row === undefined ? { on: false, lastAt: null } : { on: row.on, lastAt: row.lastAt }
  }

  async setDigest(eventId: EventId, userId: UserId, on: boolean): Promise<void> {
    const row = this.members.get(memberKey(eventId, userId))
    if (row !== undefined) row.on = on
  }

  async claimDigest(
    eventId: EventId,
    userId: UserId,
    expected: Date | null,
    at: Date,
  ): Promise<boolean> {
    const row = this.members.get(memberKey(eventId, userId))
    if (row === undefined || !row.on) return false
    const held = row.lastAt
    const same =
      held === null || expected === null ? held === expected : held.getTime() === expected.getTime()
    if (!same) return false
    row.lastAt = at
    return true
  }
}
