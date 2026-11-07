import { makeCreateShareLink } from '../application/usecases/gallery/createShareLink'
import { makeDownloadGalleryArchive } from '../application/usecases/gallery/downloadGalleryArchive'
import { makeGetGalleryMedia } from '../application/usecases/gallery/getGalleryMedia'
import { makeGetShareLink } from '../application/usecases/gallery/getShareLink'
import { makeListGalleryPhotos } from '../application/usecases/gallery/listGalleryPhotos'
import { makeOpenGallery } from '../application/usecases/gallery/openGallery'
import { makeRevokeShareLink } from '../application/usecases/gallery/revokeShareLink'
import { makeUnlockGallery } from '../application/usecases/gallery/unlockGallery'
import type { Adapters } from './usecases'
import { galleryAccess, type SharedHooks } from './usecases.shared'

/** The gallery slice of the use-case bag: composition only, built by `buildUseCases`. */
export const galleryUseCases = (adapters: Adapters, { engagement }: SharedHooks) => ({
  // shared gallery
  //
  // Every one of the link holder's five goes through `galleryAccess.ts`, which is why
  // they share one bag of ports: the rule they all ask needs the links, the events, the
  // memberships (a link lives only as long as its creator's ownership), the signer and
  // the clock.
  createShareLink: makeCreateShareLink({
    events: adapters.events,
    shareLinks: adapters.shareLinks,
    memberships: adapters.memberships,
    hasher: adapters.passwordHasher,
    signer: adapters.gallerySigner,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  getShareLink: makeGetShareLink({
    events: adapters.events,
    shareLinks: adapters.shareLinks,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  revokeShareLink: makeRevokeShareLink({
    events: adapters.events,
    shareLinks: adapters.shareLinks,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  openGallery: makeOpenGallery({
    ...galleryAccess(adapters),
    photos: adapters.photos,
    engagement,
  }),
  unlockGallery: makeUnlockGallery({
    ...galleryAccess(adapters),
    hasher: adapters.passwordHasher,
  }),
  listGalleryPhotos: makeListGalleryPhotos({
    ...galleryAccess(adapters),
    photos: adapters.photos,
  }),
  getGalleryMedia: makeGetGalleryMedia({
    ...galleryAccess(adapters),
    photos: adapters.photos,
    media: adapters.media,
  }),
  downloadGalleryArchive: makeDownloadGalleryArchive({
    ...galleryAccess(adapters),
    photos: adapters.photos,
    media: adapters.media,
    archive: adapters.archive,
    logger: adapters.logger,
    engagement,
  }),
})
