import type { MailPreferences } from '../../domain/notices/mailPreferences'
import type { EventId, UserId } from '../../domain/shared/ids'

/** An owner's daily-summary state for one event (spec 32, R2). */
export interface DigestSubscription {
  /** The owner ticked "send me a summary" for this event. */
  readonly on: boolean
  /** When the last summary was claimed for this owner, or `null`. */
  readonly lastAt: Date | null
}

/**
 * What an account chose to receive by mail, and an owner's digest state (spec 32, section 5).
 *
 * The two switches live on `users` (`mail_rsvp`, `mail_event`) and the digest on the membership
 * (`rsvp_digest`, `rsvp_digest_at`). **They are not part of the `User` entity** on purpose: `UserRepository.save`
 * writes the whole row, and a preference must never be put back by the save of an account read before a
 * change. Each method here touches only its own columns.
 */
export interface MailPreferenceRepository {
  /** The account's switches; both **on** for an account that never touched them (or an unknown one). */
  forUser(userId: UserId): Promise<MailPreferences>

  /** Stores both switches. Storing for an account that does not exist records nothing. */
  save(userId: UserId, preferences: MailPreferences): Promise<void>

  /** This owner's digest state for the event; off and never sent when the membership does not exist. */
  digestFor(eventId: EventId, userId: UserId): Promise<DigestSubscription>

  /** Ticks or unticks the digest. Nothing is recorded for a membership that does not exist. */
  setDigest(eventId: EventId, userId: UserId, on: boolean): Promise<void>

  /**
   * **Compare-and-set** on `rsvp_digest_at`: writes `at` only if the column still holds `expected`
   * (`null` for "never"), and answers `true` to the write that did. The winner sends the digest, so the
   * retention timer and `npm run purge` running together send one, not two. `false` for a lost race or a
   * membership that does not exist.
   */
  claimDigest(eventId: EventId, userId: UserId, expected: Date | null, at: Date): Promise<boolean>
}
