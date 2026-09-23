import type { ShareLink } from '../../domain/gallery/shareLink'
import type { ContentHash } from '../../domain/photos/contentHash'
import { VARIANTS_BY_KIND } from '../../domain/photos/mediaVariant'
import type { Photo } from '../../domain/photos/photo'
import { asEventId, asUserId, type EventId } from '../../domain/shared/ids'
import type { ArchiveEntry, ArchiveWriter } from '../ports/archiveWriter'
import type { LogContext, Logger } from '../ports/logger'
import { AT, anEvent, aShareLink, aUser, type ShareLinkInput } from './builders'
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

/** Records what it was asked to archive and emits one chunk per entry. */
export class RecordingArchiveWriter implements ArchiveWriter {
  readonly names: string[] = []

  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> {
    const names = this.names
    return (async function* () {
      for await (const entry of entries) {
        for await (const chunk of entry.bytes) void chunk
        names.push(entry.name)
        yield Uint8Array.of(names.length)
      }
    })()
  }
}

export class CapturingLogger implements Logger {
  readonly lines: { readonly level: string; readonly message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

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
  readonly archive: RecordingArchiveWriter
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
    archive: new RecordingArchiveWriter(),
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
