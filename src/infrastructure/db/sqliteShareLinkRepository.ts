import { ShareLink } from '../../domain/gallery/shareLink'
import {
  asEventId,
  asShareLinkId,
  asUserId,
  type EventId,
  type ShareLinkId,
} from '../../domain/shared/ids'
import type { ShareLinkRepository } from '../../application/ports/shareLinkRepository'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `share_links` (migration 007).
 *
 * Two of these statements name no event, and they are the two the port documents as
 * exceptions to "every event-scoped query takes `event_id`": the token lookup, because a
 * guest's request carries nothing else, and the id lookup behind a signed media URL,
 * which runs only after the signature has been checked. Every read the caller makes
 * after either of them is scoped by the `event_id` on the row they return.
 */

const COLUMNS = `id, event_id, token_digest, password_hash, created_by, created_at, expires_at,
                 revoked_at`

interface ShareLinkRow {
  readonly id: string
  readonly event_id: string
  readonly token_digest: string
  readonly password_hash: string | null
  readonly created_by: string
  readonly created_at: string
  readonly expires_at: string
  readonly revoked_at: string | null
}

const toShareLink = (row: ShareLinkRow): ShareLink =>
  ShareLink.restore({
    id: asShareLinkId(row.id),
    eventId: asEventId(row.event_id),
    tokenDigest: row.token_digest,
    passwordHash: row.password_hash,
    createdBy: asUserId(row.created_by),
    createdAt: fromIsoText(row.created_at),
    expiresAt: fromIsoText(row.expires_at),
    revokedAt: fromNullableIsoText(row.revoked_at),
  })

export class SqliteShareLinkRepository implements ShareLinkRepository {
  constructor(private readonly db: Db) {}

  async findByTokenDigest(digest: string): Promise<ShareLink | null> {
    const row = this.db
      .prepare<[string], ShareLinkRow>(`SELECT ${COLUMNS} FROM share_links WHERE token_digest = ?`)
      .get(digest)
    return row === undefined ? null : toShareLink(row)
  }

  async findById(id: ShareLinkId): Promise<ShareLink | null> {
    const row = this.db
      .prepare<[string], ShareLinkRow>(`SELECT ${COLUMNS} FROM share_links WHERE id = ?`)
      .get(id)
    return row === undefined ? null : toShareLink(row)
  }

  async findCurrent(eventId: EventId): Promise<ShareLink | null> {
    const row = this.db
      .prepare<[string], ShareLinkRow>(
        `SELECT ${COLUMNS} FROM share_links WHERE event_id = ? AND revoked_at IS NULL`,
      )
      .get(eventId)
    return row === undefined ? null : toShareLink(row)
  }

  async replaceCurrent(next: ShareLink, revokedAt: Date): Promise<void> {
    const props = next.toProps()
    const revoke = this.db.prepare<[string, string]>(
      `UPDATE share_links SET revoked_at = ? WHERE event_id = ? AND revoked_at IS NULL`,
    )
    const insert = this.db.prepare<{
      readonly id: string
      readonly event_id: string
      readonly token_digest: string
      readonly password_hash: string | null
      readonly created_by: string
      readonly created_at: string
      readonly expires_at: string
      readonly revoked_at: string | null
    }>(
      `INSERT INTO share_links (${COLUMNS})
            VALUES (@id, @event_id, @token_digest, @password_hash, @created_by, @created_at,
                    @expires_at, @revoked_at)`,
    )

    // One transaction: a refused insert — a digest collision, a vanished event — rolls the
    // revocation back with it, so the host who pressed "new link" still has the old one
    // rather than none at all.
    this.db.transaction(() => {
      revoke.run(toIsoText(revokedAt), props.eventId)
      insert.run({
        id: props.id,
        event_id: props.eventId,
        token_digest: props.tokenDigest,
        password_hash: props.passwordHash,
        created_by: props.createdBy,
        created_at: toIsoText(props.createdAt),
        expires_at: toIsoText(props.expiresAt),
        revoked_at: props.revokedAt === null ? null : toIsoText(props.revokedAt),
      })
    })()
  }

  async revokeCurrent(eventId: EventId, at: Date): Promise<ShareLink | null> {
    // `RETURNING` so the answer is the row the update actually touched, in one statement:
    // there is no read-then-write window in which a concurrent replace could slip between.
    const row = this.db
      .prepare<[string, string], ShareLinkRow>(
        `UPDATE share_links SET revoked_at = ?
          WHERE event_id = ? AND revoked_at IS NULL
          RETURNING ${COLUMNS}`,
      )
      .get(toIsoText(at), eventId)
    return row === undefined ? null : toShareLink(row)
  }
}
