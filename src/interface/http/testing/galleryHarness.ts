import request from 'supertest'
import type { ShareLink } from '../../../domain/gallery/shareLink'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import {
  AT,
  anEvent,
  aShareLink,
  aUser,
  type ShareLinkInput,
} from '../../../application/testing/builders'
import { FakePasswordHasher } from '../../../application/testing/fakePasswordHasher'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeShareLinkRepository } from '../../../application/testing/fakeShareLinkRepository'
import { CapturingLogger, RecordingArchiveWriter } from '../../../application/testing/galleryWorld'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { makeDownloadGalleryArchive } from '../../../application/usecases/gallery/downloadGalleryArchive'
import { makeGetGalleryMedia } from '../../../application/usecases/gallery/getGalleryMedia'
import { makeListGalleryPhotos } from '../../../application/usecases/gallery/listGalleryPhotos'
import { makeOpenGallery } from '../../../application/usecases/gallery/openGallery'
import { makeUnlockGallery } from '../../../application/usecases/gallery/unlockGallery'
import type { GallerySigner } from '../../../application/ports/gallerySigner'
import { VARIANTS_BY_KIND } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import { createHmacGallerySigner } from '../../../infrastructure/crypto/hmacGallerySigner'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'
import type { HttpConfig } from '../types'
import { buildServerHarness, type ServerHarness } from './serverHarness'
import { TEST_SESSION_SECRET } from './middlewareHarness'

/**
 * The real server, with the link holder's five use cases wired over fakes — and the
 * **real** HMAC signer.
 *
 * A fake signer here would test nothing: forging a media URL, moving an expiry and
 * reusing another link's signature are exactly what these tests exist to try, and a signer
 * anybody can compute would accept all three. So the one adapter this harness composes is
 * that one, which is why it lives in a `testing/` folder (eslint allows it here and nowhere
 * else under `src/interface`).
 *
 * Everything the access rule reads — events, memberships, the accounts behind them — is
 * the server harness's own world, so "the creator was switched off" is a write to the same
 * user repository `roleFor` reads.
 */

export const WEDDING = asEventId('evt-wedding')
export const WEDDING_SLUG = 'camille-et-sacha'
export const GALA = asEventId('evt-gala')
export const OWNER = asUserId('11111111-1111-4111-8111-111111111111')
export const GALA_OWNER = asUserId('22222222-2222-4222-8222-222222222222')

/** UUIDs, because the media route parses `:photoId` as one. */
export const PHOTO = '33333333-3333-4333-8333-333333333333'
export const PENDING = '44444444-4444-4444-8444-444444444444'
export const GALA_PHOTO = '55555555-5555-4555-8555-555555555555'

export const PASSWORD = 'les mariés de juin'

export interface GalleryHarness extends ServerHarness {
  readonly photos: FakePhotoRepository
  readonly shareLinks: FakeShareLinkRepository
  readonly media: InMemoryMediaStore
  readonly signer: GallerySigner
  readonly hasher: FakePasswordHasher
  readonly archive: RecordingArchiveWriter
  /** Stores a link for the wedding by its owner, and answers the token that opens it. */
  seedLink(input?: ShareLinkInput): { readonly link: ShareLink; readonly token: string }
  seedPhoto(photo: Photo): Promise<void>
}

export const buildGalleryHarness = (config: Partial<HttpConfig> = {}): GalleryHarness => {
  const photos = new FakePhotoRepository()
  const shareLinks = new FakeShareLinkRepository()
  const signer = createHmacGallerySigner({ rootSecret: TEST_SESSION_SECRET })
  const hasher = new FakePasswordHasher()
  const archive = new RecordingArchiveWriter()
  const logger = new CapturingLogger()
  const media = new InMemoryMediaStore()

  // The use cases close over `harness` and are only called once it exists, so the rule
  // reads the very repositories the server's own middleware reads.
  const harness = buildServerHarness({
    config,
    usecases: {
      openGallery: (input) => makeOpenGallery({ ...access(), photos })(input),
      unlockGallery: (input) => makeUnlockGallery({ ...access(), hasher })(input),
      listGalleryPhotos: (input) => makeListGalleryPhotos({ ...access(), photos })(input),
      getGalleryMedia: (input) => makeGetGalleryMedia({ ...access(), photos, media })(input),
      downloadGalleryArchive: (input) =>
        makeDownloadGalleryArchive({ ...access(), photos, media, archive, logger })(input),
    },
  })

  function access() {
    return {
      shareLinks,
      events: harness.events,
      memberships: harness.memberships,
      signer,
      clock: harness.clock,
    }
  }

  harness.users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
  )
  harness.memberships.seed(
    { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
    { eventId: GALA, userId: GALA_OWNER, role: 'owner', grantedAt: AT },
  )
  harness.events.seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: WEDDING_SLUG, status: 'closed' }),
    anEvent({ id: GALA, ownerId: GALA_OWNER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
  )

  return {
    ...harness,
    photos,
    shareLinks,
    media,
    signer,
    hasher,
    archive,
    seedLink: (input = {}) => {
      const { token, digest } = signer.mintToken()
      const link = aShareLink({
        // A UUID, as the real id generator mints: the media route parses `:linkId` as one,
        // so a readable id here would make every media case a vacuous 404.
        id: `aaaaaaaa-0000-4000-8000-${String(shareLinks.all().length + 1).padStart(12, '0')}`,
        eventId: WEDDING,
        createdBy: OWNER,
        createdAt: harness.clock.now(),
        ...input,
        tokenDigest: digest,
      })
      shareLinks.seed(link)
      return { link, token }
    },
    seedPhoto: async (photo) => {
      photos.seed(photo)
      for (const variant of VARIANTS_BY_KIND[photo.kind]) {
        await media.put(photo.eventId, photo.hashFor(variant), variant, new Uint8Array([7, 8, 9]))
      }
    },
  }
}

/** An agent holding a CSRF token, the way a browser does after its first request. */
export const browserAgent = async (
  subject: ServerHarness,
): Promise<{ readonly agent: request.Agent; readonly csrf: string }> => {
  const agent = request.agent(subject.app)
  const response = await agent.get('/api/nope')
  const raw: unknown = response.headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw.map(String) : []
  const header = cookies.find((value) => value.startsWith(`${CSRF_COOKIE}=`))
  if (header === undefined) throw new Error('the server issued no CSRF cookie')
  const csrf = decodeURIComponent(header.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
  return { agent, csrf }
}

export { CSRF_HEADER }
