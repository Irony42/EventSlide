import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EventId, GuestId } from '../shared/ids'
import type { DisplayName } from './displayName'

export interface GuestProps {
  readonly id: GuestId
  readonly eventId: EventId
  readonly displayName: DisplayName | null
  readonly joinedAt: Date
  readonly lastSeenAt: Date
  readonly revokedAt: Date | null
  readonly photoCount: number
}

export interface NewGuest {
  readonly eventId: EventId
  readonly displayName: DisplayName | null
}

/**
 * Whoever holds the device token issued at `/join/:code`.
 *
 * There is no account and no password: the token is HMAC-signed, event-scoped, and
 * this entity is what it refers to. `eventId` is therefore part of the guest's
 * identity rather than an argument passed alongside it — a guest of one wedding is not
 * a guest of the next, and 1.0's shared upload endpoint is exactly what that prevents.
 *
 * Immutable like `Photo`: every transition returns a new instance, so the repository
 * can never be handed a half-changed entity.
 */
export class Guest {
  private constructor(private readonly props: GuestProps) {}

  /**
   * A guest who has just joined. It cannot fail today — the name was already parsed by
   * `DisplayName` and the ids are branded — but it returns a `Result` like every other
   * factory, so adding a rule here will not change any caller's shape.
   */
  static create(input: NewGuest, id: GuestId, now: Date): Result<Guest, DomainError> {
    return ok(
      new Guest({
        id,
        eventId: input.eventId,
        displayName: input.displayName,
        // Joining is itself an activity: a guest who scans the code and never uploads
        // still belongs in the host's count of who is in the room.
        joinedAt: now,
        lastSeenAt: now,
        revokedAt: null,
        photoCount: 0,
      }),
    )
  }

  /** Rehydrate from storage, trusting the row exactly as `Photo.restore` does. */
  static restore(props: GuestProps): Guest {
    return new Guest(props)
  }

  get id(): GuestId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get displayName(): DisplayName | null {
    return this.props.displayName
  }

  get joinedAt(): Date {
    return this.props.joinedAt
  }

  get lastSeenAt(): Date {
    return this.props.lastSeenAt
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt
  }

  get photoCount(): number {
    return this.props.photoCount
  }

  // ----------------------------------------------------------------- identity --

  /** Passing `null` is how a guest takes their name back off the wall. */
  rename(displayName: DisplayName | null): Result<Guest, DomainError> {
    if (this.isRevoked()) return err(DomainError.forbidden('guest.revoked'))
    return ok(this.with({ displayName }))
  }

  /**
   * The name as text, or `null` for a guest who stayed anonymous. No fallback is
   * invented here: "Invité" is French UI copy, it lives in `web/src/lib/i18n/`, and
   * the wall and the moderation console are free to word it differently.
   */
  label(): string | null {
    return this.props.displayName === null ? null : this.props.displayName.value
  }

  // ----------------------------------------------------------------- presence --

  /**
   * Record activity. Never moves backwards: `lastSeenAt` drives the host's count of
   * guests currently at the party, and a request retried after a phone regained
   * signal — or stamped by a clock a few seconds behind — would otherwise make that
   * count flicker as guests appeared to leave and return.
   */
  touch(now: Date): Guest {
    if (now.getTime() <= this.props.lastSeenAt.getTime()) return this
    return this.with({ lastSeenAt: now })
  }

  /** Not seen for a while, which is "went home", not "was removed". */
  isStale(now: Date, idleMs: number): boolean {
    return now.getTime() - this.props.lastSeenAt.getTime() > idleMs
  }

  // --------------------------------------------------------------- revocation --

  /**
   * A host removing a disruptive guest. Idempotent, and the first timestamp wins: the
   * button is on a phone at a party and will be double-tapped, and when the host is
   * later asked when the guest was cut off, the answer is the moment they decided.
   */
  revoke(at: Date): Guest {
    if (this.props.revokedAt !== null) return this
    return this.with({ revokedAt: at })
  }

  /** Whether the device token still grants anything. Being in the room is `isStale`. */
  isActive(): boolean {
    return this.props.revokedAt === null
  }

  isRevoked(): boolean {
    return !this.isActive()
  }

  // ------------------------------------------------------------------- quotas --

  recordPhoto(): Guest {
    return this.with({ photoCount: this.props.photoCount + 1 })
  }

  /**
   * A photo of theirs left the event. Clamped at zero because this counter feeds
   * `canUploadMore`: a delete replayed once too often must not hand a guest who had
   * reached their limit a free extra slot.
   */
  forgetPhoto(): Guest {
    return this.with({ photoCount: Math.max(0, this.props.photoCount - 1) })
  }

  /** The per-guest limit from `EventSettings`; `null` means the host set none. */
  canUploadMore(maxPhotosPerGuest: number | null): boolean {
    return maxPhotosPerGuest === null || this.props.photoCount < maxPhotosPerGuest
  }

  // ------------------------------------------------------------------ helpers --

  equals(other: Guest): boolean {
    return this.props.id === other.props.id
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): GuestProps {
    return this.props
  }

  private with(changes: Partial<GuestProps>): Guest {
    return new Guest({ ...this.props, ...changes })
  }
}
