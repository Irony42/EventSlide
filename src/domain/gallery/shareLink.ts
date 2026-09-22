import { DomainError } from '../shared/errors'
import type { EventId, ShareLinkId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import type { PasswordHash } from '../users/user'
import type { ShareLinkLifetime } from './shareLinkLifetime'

/**
 * A link a host sends after the event: the published album, optionally behind a
 * password, open until it expires or is revoked (docs/ROADMAP.md §4.1).
 *
 * **The token is not in here, and that is the first thing to know about this entity.**
 * The token is the secret in the URL; what is stored is its SHA-256 digest, so a copy of
 * the database — a backup on a USB stick, a restore rehearsal on a laptop — opens no
 * gallery. A digest rather than a bcrypt hash because the token is 256 random bits: a
 * slow hash exists to protect a low-entropy secret a person chose, and there is nothing
 * to brute-force here. The same reasoning is why the lookup can be an index seek on the
 * digest instead of a scan comparing hashes.
 *
 * **The password is the host's, hashed by the same hasher as an account's.** It is a
 * second factor on top of the token, for the link that has been forwarded further than
 * the host meant it to go.
 */

/** A lower-case hex SHA-256: sixty-four characters, and nothing a raw token looks like. */
const DIGEST = /^[0-9a-f]{64}$/

export interface ShareLinkProps {
  readonly id: ShareLinkId
  readonly eventId: EventId
  /** SHA-256 of the token, lower-case hex. Never the token itself. */
  readonly tokenDigest: string
  /** `null` for a link that opens on the token alone. */
  readonly passwordHash: PasswordHash | null
  /**
   * The account whose authority minted the link, and whose authority it keeps needing.
   *
   * Read on every request that uses the link (`galleryAccess.ts`): an account the operator
   * switches off, or an owner demoted to moderator, stops publishing the album the moment
   * that happens — the link is a capability the owner handed out, and it cannot outlive
   * the owner's own standing. AGENTS.md #16 is the same rule for sessions.
   */
  readonly createdBy: UserId
  readonly createdAt: Date
  readonly expiresAt: Date
  /** When the host took it back, or `null`. A revoked link never reopens. */
  readonly revokedAt: Date | null
}

export interface NewShareLink {
  readonly eventId: EventId
  readonly tokenDigest: string
  readonly passwordHash: PasswordHash | null
  readonly createdBy: UserId
  readonly lifetime: ShareLinkLifetime
}

export class ShareLink {
  private constructor(private readonly props: ShareLinkProps) {}

  static create(input: NewShareLink, id: ShareLinkId, now: Date): Result<ShareLink, DomainError> {
    // Refused rather than stored, because the likeliest way this goes wrong is a caller
    // passing the token where the digest belongs — and that mistake would write every
    // gallery's key into the database in plain text, where nothing would ever notice.
    if (!DIGEST.test(input.tokenDigest)) {
      return err(DomainError.unexpected('shareLink.digestInvalid'))
    }
    return ok(
      new ShareLink({
        id,
        eventId: input.eventId,
        tokenDigest: input.tokenDigest,
        passwordHash: input.passwordHash,
        createdBy: input.createdBy,
        createdAt: now,
        expiresAt: input.lifetime.expiresAfter(now),
        revokedAt: null,
      }),
    )
  }

  /** Rehydrate from storage. Trusts the row, like every other `restore` here. */
  static restore(props: ShareLinkProps): ShareLink {
    return new ShareLink(props)
  }

  get id(): ShareLinkId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get tokenDigest(): string {
    return this.props.tokenDigest
  }

  get passwordHash(): PasswordHash | null {
    return this.props.passwordHash
  }

  get createdBy(): UserId {
    return this.props.createdBy
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get expiresAt(): Date {
    return this.props.expiresAt
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt
  }

  get requiresPassword(): boolean {
    return this.props.passwordHash !== null
  }

  /**
   * Whether the link itself still opens at `now` — neither revoked nor expired.
   *
   * Half the question, deliberately. The other half — whether the account that minted it
   * still owns the event — is a storage read and belongs to the use case; this is the half
   * a `ShareLink` can answer about itself.
   *
   * The expiry is exclusive: at `expiresAt` exactly, the link is shut. A deadline is the
   * first instant something is no longer allowed, and "until the 20th" that still opens
   * on the 20th is a link that outlives what the host was told.
   */
  isOpenAt(now: Date): boolean {
    return this.props.revokedAt === null && now.getTime() < this.props.expiresAt.getTime()
  }

  /** Idempotent: revoking twice keeps the first instant, which is when it stopped. */
  revoke(at: Date): ShareLink {
    if (this.props.revokedAt !== null) return this
    return new ShareLink({ ...this.props, revokedAt: at })
  }

  toProps(): ShareLinkProps {
    return this.props
  }
}
