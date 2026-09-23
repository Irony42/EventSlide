import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import { isInSharedGallery, unlockExpiresAt } from '../../../domain/gallery/galleryMedia'
import type { ShareLink } from '../../../domain/gallery/shareLink'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import { PHOTO_STATUSES, type PhotoStatus } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoId, ShareLinkId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GallerySigner } from '../../ports/gallerySigner'
import type { ShareLinkRepository } from '../../ports/shareLinkRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * What every gallery use case asks before it answers anything (docs/ROADMAP.md §4.1).
 *
 * The shared gallery is the product's first **public read surface**: the caller holds a
 * token or a signed URL and no account, and the decision is made here, once, rather than
 * restated in each use case.
 *
 * ## One answer for every way a link can fail
 *
 * An unknown token, an expired link, a revoked one, a link whose creator has been
 * switched off or no longer owns the event, and an event that has been purged all answer
 * **`gallery.notAvailable`**, identically. A guest holding a dead link learns that it is
 * dead and nothing about why: a distinct "revoked" would tell whoever the link was
 * forwarded to that the host took it back on purpose, and a distinct "expired" would
 * confirm that a guessed token once existed. The host's console is where the reason is
 * shown, to the one person entitled to it.
 */

export interface GalleryAccessDeps {
  readonly shareLinks: ShareLinkRepository
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly signer: GallerySigner
  readonly clock: Clock
}

/**
 * The statuses a gallery reads, asked of the domain once rather than restated as a list:
 * the grid, the count and the archive all take them from here.
 */
export const GALLERY_STATUSES: readonly PhotoStatus[] = PHOTO_STATUSES.filter(isInSharedGallery)

/** Every refusal on this surface, whatever the reason. See the file comment. */
export const notAvailable = (): DomainError => DomainError.notFound('gallery.notAvailable')

/**
 * The event behind a link, if the link still grants anything at `now`, or `null`.
 *
 * Three questions, in the order that asks storage least:
 *
 * 1. Is the link itself open — not revoked, not expired? The entity answers that.
 * 2. **Does the account that minted it still own the event?** Read from storage on this
 *    request, exactly as `requireRole` reads a session's role (AGENTS.md #16). A link is
 *    an owner's authority handed out, so it cannot outlive that authority: an account the
 *    operator switches off, or an owner demoted to moderator, stops publishing the album
 *    on the next request. `roleFor` already answers `null` for a disabled account, which is
 *    what makes the first case hold without a second read.
 * 3. Does the event still exist? A purge cascades the link away, so this is a backstop for
 *    the instant between the two.
 */
export const eventBehind = async (
  deps: Pick<GalleryAccessDeps, 'events' | 'memberships'>,
  link: ShareLink,
  now: Date,
): Promise<Event | null> => {
  if (!link.isOpenAt(now)) return null

  const role = await deps.memberships.roleFor(link.eventId, link.createdBy)
  if (role === null || !canManageEvent(role)) return null

  return deps.events.findById(link.eventId)
}

/** Whether a link still grants anything at `now`, without needing the event itself. */
export const stillGrants = async (
  deps: Pick<GalleryAccessDeps, 'shareLinks' | 'events' | 'memberships'>,
  linkId: ShareLinkId,
  now: Date,
): Promise<boolean> => {
  const link = await deps.shareLinks.findById(linkId)
  return link !== null && (await eventBehind(deps, link, now)) !== null
}

// ------------------------------------------------------------------- unlocking --

const UNLOCK = 'unlock'

export interface UnlockProof {
  /** The cookie's value. Opaque to the client; it carries no password and no token. */
  readonly proof: string
  readonly expiresAt: Date
}

/**
 * The statement that this browser entered the right password for this link, until when.
 *
 * `<expiry ms>.<mac>`, and the link id is **inside the MAC but not on the wire**: the
 * cookie is only ever checked against the link being opened, so it proves nothing about
 * any other link, and it names none.
 */
export const issueUnlock = (signer: GallerySigner, link: ShareLink, now: Date): UnlockProof => {
  const expiresAt = unlockExpiresAt(now, link)
  const expiry = String(expiresAt.getTime())
  return { proof: `${expiry}.${signer.sign([UNLOCK, link.id, expiry])}`, expiresAt }
}

/**
 * Whether `proof` is a live unlock for `link`.
 *
 * The MAC is checked **before** the expiry is parsed, for the reason the guest token gives:
 * nothing a caller forged should reach a parser.
 */
export const holdsUnlock = (
  signer: GallerySigner,
  link: ShareLink,
  proof: string | null,
  now: Date,
): boolean => {
  if (proof === null) return false
  const dot = proof.indexOf('.')
  if (dot < 1) return false

  const expiry = proof.slice(0, dot)
  if (!signer.verify([UNLOCK, link.id, expiry], proof.slice(dot + 1))) return false

  return Number(expiry) > now.getTime()
}

// ------------------------------------------------------------------ entering --

export interface EnteredGallery {
  readonly link: ShareLink
  readonly event: Event
  readonly now: Date
}

/**
 * The link a token names, if it is available and — when it has a password — unlocked.
 *
 * `gallery.passwordRequired` is the one refusal that is not `gallery.notAvailable`, and it
 * is deliberately distinguishable: whoever holds the token already knows the link exists,
 * because the token *is* the link. What they do not have is the second factor.
 */
export const enterGallery = async (
  deps: GalleryAccessDeps,
  token: string,
  unlockProof: string | null,
): Promise<Result<EnteredGallery, DomainError>> => {
  const link = await deps.shareLinks.findByTokenDigest(deps.signer.digestOf(token))
  if (link === null) return err(notAvailable())

  const now = deps.clock.now()
  const event = await eventBehind(deps, link, now)
  if (event === null) return err(notAvailable())

  if (link.requiresPassword && !holdsUnlock(deps.signer, link, unlockProof, now)) {
    return err(DomainError.unauthenticated('gallery.passwordRequired'))
  }

  return ok({ link, event, now })
}

// -------------------------------------------------------------------- grants --

/**
 * A signed, short-lived permission to fetch one rendition of one photograph under one
 * link. The HTTP layer turns it into a URL; nothing here knows what a URL looks like.
 */
export interface MediaGrant {
  readonly linkId: ShareLinkId
  readonly photoId: PhotoId
  readonly variant: ServedVariant
  readonly expiresAt: Date
  readonly signature: string
}

/** The same, for the whole album as one archive. */
export interface ArchiveGrant {
  readonly linkId: ShareLinkId
  readonly expiresAt: Date
  readonly signature: string
}

const MEDIA = 'media'
const ARCHIVE = 'archive'

/** Every field a media URL carries is inside the MAC: the link, the photo, the rendition, the expiry. */
const mediaStatement = (
  linkId: ShareLinkId,
  photoId: PhotoId,
  variant: ServedVariant,
  expiresAtMs: number,
): readonly string[] => [MEDIA, linkId, photoId, variant, String(expiresAtMs)]

export const grantMedia = (
  signer: GallerySigner,
  linkId: ShareLinkId,
  photoId: PhotoId,
  variant: ServedVariant,
  expiresAt: Date,
): MediaGrant => ({
  linkId,
  photoId,
  variant,
  expiresAt,
  signature: signer.sign(mediaStatement(linkId, photoId, variant, expiresAt.getTime())),
})

export const isMediaGrantSigned = (
  signer: GallerySigner,
  claim: {
    readonly linkId: ShareLinkId
    readonly photoId: PhotoId
    readonly variant: ServedVariant
    readonly expiresAtMs: number
  },
  signature: string,
): boolean =>
  signer.verify(
    mediaStatement(claim.linkId, claim.photoId, claim.variant, claim.expiresAtMs),
    signature,
  )

export const grantArchive = (
  signer: GallerySigner,
  linkId: ShareLinkId,
  expiresAt: Date,
): ArchiveGrant => ({
  linkId,
  expiresAt,
  signature: signer.sign([ARCHIVE, linkId, String(expiresAt.getTime())]),
})

export const isArchiveGrantSigned = (
  signer: GallerySigner,
  claim: { readonly linkId: ShareLinkId; readonly expiresAtMs: number },
  signature: string,
): boolean => signer.verify([ARCHIVE, claim.linkId, String(claim.expiresAtMs)], signature)

// ------------------------------------------------------------------- cursors --

const CURSOR = 'cursor'

/**
 * A page cursor this link issued, sealed so a caller cannot hand the repository one it
 * invented. The repository's own cursor is opaque and it throws on one it did not issue —
 * right for a host's console, a 500 on a public surface — so the gallery never passes it
 * anything it has not signed.
 */
export const sealCursor = (signer: GallerySigner, link: ShareLink, cursor: string): string =>
  `${cursor}.${signer.sign([CURSOR, link.id, cursor])}`

/** The repository cursor inside a sealed one, or `null` when it was not sealed for this link. */
export const openCursor = (
  signer: GallerySigner,
  link: ShareLink,
  sealed: string,
): string | null => {
  const dot = sealed.lastIndexOf('.')
  if (dot < 1) return null
  const cursor = sealed.slice(0, dot)
  return signer.verify([CURSOR, link.id, cursor], sealed.slice(dot + 1)) ? cursor : null
}
