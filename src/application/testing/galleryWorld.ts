import type { ShareLink } from '../../domain/gallery/shareLink'
import type { ContentHash } from '../../domain/photos/contentHash'
import { VARIANTS_BY_KIND } from '../../domain/photos/mediaVariant'
import type { Photo } from '../../domain/photos/photo'
import { asEventId, asUserId, type EventId } from '../../domain/shared/ids'
import { CapturingLogger } from './capturingLogger'
import { AT, anEvent, aShareLink, aUser, type ShareLinkInput } from './builders'
import { FakeArchiveWriter } from './fakeArchiveWriter'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeGallerySigner } from './fakeGallerySigner'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakePasswordHasher } from './fakePasswordHasher'
import { FakePhotoRepository } from './fakePhotoRepository'
import { FakeShareLinkRepository } from './fakeShareLinkRepository'
import { FakeUserRepository } from './fakeUserRepository'
import { InMemoryMediaStore } from './inMemoryMediaStore'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * One wedding, its owner, and every fake the gallery use cases reach — wired the way the
 * container wires the real adapters, so a use case test exercises the real rules.
 *
 * The owner's account is in a linked user repository, because "the link stops working
 * when its creator is switched off" is answered by `roleFor` reading `disabled_at`, and an
 * unlinked membership fake would answer `owner` for an account the test had disabled.
 */

export const WEDDING = asEventId('evt-wedding')
export const WEDDING_SLUG = 'camille-et-sacha'
export const GALA = asEventId('evt-gala')
export const OWNER = asUserId('user-owner')
export const CO_OWNER = asUserId('user-co-owner')
export const MODERATOR = asUserId('user-moderator')
export const STRANGER = asUserId('user-stranger')

/** The shared double, re-exported: the HTTP harnesses still import it from this file. */
export { CapturingLogger }

export interface GalleryWorld {
  readonly clock: FakeClock
  readonly users: FakeUserRepository
  readonly memberships: FakeMembershipRepository
  readonly events: FakeEventRepository
  readonly photos: FakePhotoRepository
  readonly shareLinks: FakeShareLinkRepository
  readonly signer: FakeGallerySigner
  readonly hasher: FakePasswordHasher
  readonly ids: SequentialIdGenerator
  readonly media: InMemoryMediaStore
  readonly archive: FakeArchiveWriter
  readonly logger: CapturingLogger
  /**
   * Stores a link for the wedding, created by the owner, and answers its token. The
   * token is the fake signer's, so the digest the repository holds is the one a request
   * carrying it will look up.
   */
  seedLink(input?: ShareLinkInput): { readonly link: ShareLink; readonly token: string }
  /** Publishes the bytes of every rendition a photograph of that kind has. */
  storeMedia(photo: Photo): Promise<void>
}

export const buildGalleryWorld = (): GalleryWorld => {
  const clock = new FakeClock(AT)
  const users = new FakeUserRepository().seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: CO_OWNER, email: 'co-hote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: STRANGER, email: 'inconnu@example.test' }),
  )
  const memberships = new FakeMembershipRepository({ users }).seed(
    { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: CO_OWNER, role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT },
  )
  const photos = new FakePhotoRepository()
  const events = new FakeEventRepository({ memberships, photos }).seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: WEDDING_SLUG, status: 'closed' }),
    anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
  )
  const shareLinks = new FakeShareLinkRepository()
  const signer = new FakeGallerySigner()
  const media = new InMemoryMediaStore(clock)

  return {
    clock,
    users,
    memberships,
    events,
    photos,
    shareLinks,
    signer,
    hasher: new FakePasswordHasher(),
    ids: new SequentialIdGenerator(),
    media,
    archive: new FakeArchiveWriter(),
    logger: new CapturingLogger(),
    seedLink: (input = {}) => {
      const { token, digest } = signer.mintToken()
      const link = aShareLink({
        eventId: WEDDING,
        createdBy: OWNER,
        createdAt: clock.now(),
        ...input,
        tokenDigest: digest,
      })
      shareLinks.seed(link)
      return { link, token }
    },
    storeMedia: async (photo: Photo) => {
      const eventId: EventId = photo.eventId
      for (const variant of VARIANTS_BY_KIND[photo.kind]) {
        const hash: ContentHash = photo.hashFor(variant)
        await media.put(eventId, hash, variant, new Uint8Array([1, 2, 3]))
      }
    },
  }
}
