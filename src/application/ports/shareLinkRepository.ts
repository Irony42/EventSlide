import type { ShareLink } from '../../domain/gallery/shareLink'
import type { EventId, ShareLinkId } from '../../domain/shared/ids'

/**
 * The host's shared gallery links (docs/ROADMAP.md §4.1).
 *
 * **One current link per event.** "Current" means not revoked; an expired link is still
 * current until the host replaces it, so the console can say "your link expired on the
 * 20th" instead of pretending there never was one. `share_links` holds a partial unique
 * index on `(event_id) WHERE revoked_at IS NULL`, the fake enforces the same rule, and
 * the shared contract suite runs it against both.
 *
 * ## The two methods that are not scoped by event, and why each has to be
 *
 * Every other event-scoped port here takes `eventId` first, and docs/SECURITY.md §3 lists
 * the exceptions. These two are on that list:
 *
 * - {@link ShareLinkRepository.findByTokenDigest} — the token is the only thing the
 *   caller holds. A guest opening `/g/<token>` has no event to name: naming it is what the
 *   token is for.
 * - {@link ShareLinkRepository.findById} — a signed media URL carries the link's id, not
 *   its token, so that a URL copied out of an `<img>` does not carry the key to the whole
 *   album. The signature is verified **before** this is called, so an unsigned id never
 *   reaches the database.
 *
 * Both return a link, and the link names its event: every read after them is scoped by
 * `link.eventId`, never by anything the caller sent.
 */
export interface ShareLinkRepository {
  findByTokenDigest(digest: string): Promise<ShareLink | null>

  findById(id: ShareLinkId): Promise<ShareLink | null>

  /** The event's unrevoked link, expired or not, or `null`. */
  findCurrent(eventId: EventId): Promise<ShareLink | null>

  /**
   * Revokes the event's current link, if any, and inserts `next` — in one transaction.
   *
   * One method rather than a revoke followed by a save, so there is no moment with two
   * current links and no moment with none when the host meant to replace one: a host
   * making a new link because the old one leaked needs the old one dead in the same
   * instant the new one exists.
   */
  replaceCurrent(next: ShareLink, revokedAt: Date): Promise<void>

  /** Revokes the current link. Answers it, revoked, or `null` when there was none. */
  revokeCurrent(eventId: EventId, at: Date): Promise<ShareLink | null>
}
