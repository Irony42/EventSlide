import type { ShareLink } from '../../domain/gallery/shareLink'
import type { EventId, ShareLinkId } from '../../domain/shared/ids'
import type { ShareLinkRepository } from '../ports/shareLinkRepository'

/**
 * In-memory `ShareLinkRepository`, behaving the way the SQLite adapter must.
 *
 * Two properties are load-bearing, and the shared contract suite checks both against
 * SQLite as well:
 *
 * 1. **At most one unrevoked link per event**, as `idx_share_links_current` makes it. A
 *    fake that let two coexist would let a ring-2 test prove that replacing a leaked link
 *    works while the real database raised.
 * 2. **The token digest is unique**, as `idx_share_links_token` makes it — the lookup a
 *    guest's request resolves through must never have two answers.
 *
 * Unlike the other event-scoped fakes, rows are keyed by link id alone: the port's two
 * unscoped lookups are its point, and a composite key would be a key this fake then
 * scanned around.
 */
export class FakeShareLinkRepository implements ShareLinkRepository {
  private readonly rows = new Map<ShareLinkId, ShareLink>()

  /** Seed fixtures. Enforces the same uniqueness the writes do. */
  seed(...links: readonly ShareLink[]): this {
    for (const link of links) this.insert(link)
    return this
  }

  /** Every row, revoked ones included. Test infrastructure, deliberately not on the port. */
  all(): readonly ShareLink[] {
    return [...this.rows.values()]
  }

  private insert(link: ShareLink): void {
    const clash = [...this.rows.values()].find(
      (row) =>
        row.id !== link.id &&
        (row.tokenDigest === link.tokenDigest ||
          (row.eventId === link.eventId && row.revokedAt === null && link.revokedAt === null)),
    )
    if (clash !== undefined) {
      // Mirrors better-sqlite3's wording, so a rejection reads the same either way.
      throw new Error(
        `UNIQUE constraint failed: share_links (${link.id} collides with ${clash.id})`,
      )
    }
    this.rows.set(link.id, link)
  }

  private current(eventId: EventId): ShareLink | null {
    return (
      [...this.rows.values()].find((row) => row.eventId === eventId && row.revokedAt === null) ??
      null
    )
  }

  async findByTokenDigest(digest: string): Promise<ShareLink | null> {
    return [...this.rows.values()].find((row) => row.tokenDigest === digest) ?? null
  }

  async findById(id: ShareLinkId): Promise<ShareLink | null> {
    return this.rows.get(id) ?? null
  }

  async findCurrent(eventId: EventId): Promise<ShareLink | null> {
    return this.current(eventId)
  }

  async replaceCurrent(next: ShareLink, revokedAt: Date): Promise<void> {
    // All or nothing, as the adapter's transaction is: the insert is checked against the
    // world *after* the revocation, and a refused insert leaves the old link current.
    const previous = this.current(next.eventId)
    if (previous !== null) this.rows.set(previous.id, previous.revoke(revokedAt))
    try {
      this.insert(next)
    } catch (cause) {
      if (previous !== null) this.rows.set(previous.id, previous)
      throw cause
    }
  }

  async revokeCurrent(eventId: EventId, at: Date): Promise<ShareLink | null> {
    const previous = this.current(eventId)
    if (previous === null) return null
    const revoked = previous.revoke(at)
    this.rows.set(revoked.id, revoked)
    return revoked
  }
}
