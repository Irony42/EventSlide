import { makeDeletePhoto } from '../application/usecases/photos/deletePhoto'
import { makeGetReelMedia } from '../application/usecases/highlights/getReelMedia'
import { makeDeleteAlbumBook } from '../application/usecases/book/deleteAlbumBook'
import { makeDownloadAlbumBook } from '../application/usecases/book/downloadAlbumBook'
import { makeGetAlbumBook } from '../application/usecases/book/getAlbumBook'
import { makeRequestAlbumBook } from '../application/usecases/book/requestAlbumBook'
import { makeRecoverReels } from '../application/usecases/highlights/recoverReels'
import { makeRequestReel } from '../application/usecases/highlights/requestReel'
import { makeTranscodeNextReel } from '../application/usecases/highlights/transcodeNextReel'
import { makeExportHighlights } from '../application/usecases/highlights/exportHighlights'
import { makeGetHighlights } from '../application/usecases/highlights/getHighlights'
import { makePreselectHighlights } from '../application/usecases/highlights/preselectHighlights'
import { makeSetPhotoHighlight } from '../application/usecases/highlights/setPhotoHighlight'
import { makeDownloadAlbumExport } from '../application/usecases/exports/downloadAlbumExport'
import { makeGetAlbumExport } from '../application/usecases/exports/getAlbumExport'
import { makeRequestAlbumExport } from '../application/usecases/exports/requestAlbumExport'
import { makeExportAlbum } from '../application/usecases/photos/exportAlbum'
import { makeGetPhotoMedia } from '../application/usecases/photos/getPhotoMedia'
import { makeIdentifyMediaViewer } from '../application/usecases/photos/identifyMediaViewer'
import { makeListEventPhotos } from '../application/usecases/photos/listEventPhotos'
import { makeListGuestPhotos } from '../application/usecases/photos/listGuestPhotos'
import { makeSaveGuestPhoto } from '../application/usecases/photos/saveGuestPhoto'
import { makeSetPhotoCaption } from '../application/usecases/photos/setPhotoCaption'
import { makeUploadPhotos } from '../application/usecases/photos/uploadPhotos'
import type { Adapters, UseCasePolicy } from './usecases'
import { type SharedHooks } from './usecases.shared'

/** The photos slice of the use-case bag: composition only, built by `buildUseCases`. */
export const photosUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { invalidateReel, invalidateBook, invalidateExport, engagement }: SharedHooks,
) => ({
  // photos
  uploadPhotos: makeUploadPhotos({
    events: adapters.events,
    clients: adapters.clients,
    photos: adapters.photos,
    challenges: adapters.challenges,
    missions: adapters.missions,
    media: adapters.media,
    imageProcessor: adapters.imageProcessor,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    logger: adapters.logger,
    limits: { maxPixels: policy.maxImagePixels },
  }),
  listEventPhotos: makeListEventPhotos({ events: adapters.events, photos: adapters.photos }),
  listGuestPhotos: makeListGuestPhotos({
    events: adapters.events,
    photos: adapters.photos,
    missions: adapters.missions,
    clock: adapters.clock,
  }),
  deletePhoto: makeDeletePhoto({
    invalidateReel,
    invalidateBook,
    invalidateExport,
    events: adapters.events,
    photos: adapters.photos,
    clips: adapters.clips,
    media: adapters.media,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  setPhotoCaption: makeSetPhotoCaption({
    events: adapters.events,
    photos: adapters.photos,
    bus: adapters.bus,
    clock: adapters.clock,
    invalidateBook,
  }),
  getPhotoMedia: makeGetPhotoMedia({
    photos: adapters.photos,
    media: adapters.media,
    events: adapters.events,
    clock: adapters.clock,
  }),
  saveGuestPhoto: makeSaveGuestPhoto({
    events: adapters.events,
    photos: adapters.photos,
    media: adapters.media,
    engagement,
    clock: adapters.clock,
  }),
  identifyMediaViewer: makeIdentifyMediaViewer({
    guests: adapters.guests,
    tokens: adapters.guestTokens,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  exportAlbum: makeExportAlbum({
    events: adapters.events,
    photos: adapters.photos,
    guestbook: adapters.guestbook,
    guests: adapters.guests,
    media: adapters.media,
    archive: adapters.archive,
    clients: adapters.clients,
    streamHasher: adapters.streamHasher,
    clock: adapters.clock,
    logger: adapters.logger,
  }),

  // the verified archive (spec 22)
  invalidateExport,
  requestAlbumExport: makeRequestAlbumExport({
    events: adapters.events,
    clients: adapters.clients,
    photos: adapters.photos,
    voices: adapters.voices,
    exports: adapters.exports,
    exportFiles: adapters.exportFiles,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    freeDiskBytes: policy.export.freeDiskBytes,
    policy: policy.export,
  }),
  getAlbumExport: makeGetAlbumExport({
    events: adapters.events,
    clients: adapters.clients,
    exports: adapters.exports,
    clock: adapters.clock,
  }),
  downloadAlbumExport: makeDownloadAlbumExport({
    events: adapters.events,
    clients: adapters.clients,
    exports: adapters.exports,
    exportFiles: adapters.exportFiles,
    bus: adapters.bus,
    clock: adapters.clock,
    policy: { ttlDays: policy.export.ttlDays, capNoticeDays: policy.retention.capNoticeDays },
  }),

  // photo book
  invalidateBook,
  requestAlbumBook: makeRequestAlbumBook({
    events: adapters.events,
    clients: adapters.clients,
    photos: adapters.photos,
    books: adapters.books,
    bus: adapters.bus,
    clock: adapters.clock,
    policy: policy.book,
  }),
  getAlbumBook: makeGetAlbumBook({
    events: adapters.events,
    books: adapters.books,
    photos: adapters.photos,
    guestbook: adapters.guestbook,
    bookFiles: adapters.bookFiles,
  }),
  downloadAlbumBook: makeDownloadAlbumBook({
    events: adapters.events,
    books: adapters.books,
    bookFiles: adapters.bookFiles,
    clock: adapters.clock,
  }),
  deleteAlbumBook: makeDeleteAlbumBook({
    events: adapters.events,
    books: adapters.books,
    bookFiles: adapters.bookFiles,
    bus: adapters.bus,
  }),

  // highlight reel
  invalidateReel,
  requestReel: makeRequestReel({
    events: adapters.events,
    clients: adapters.clients,
    photos: adapters.photos,
    reels: adapters.reels,
    renderer: adapters.reelRenderer,
    media: adapters.media,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: policy.reel,
  }),
  transcodeNextReel: makeTranscodeNextReel({
    events: adapters.events,
    clients: adapters.clients,
    photos: adapters.photos,
    reels: adapters.reels,
    media: adapters.media,
    renderer: adapters.reelRenderer,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      secondsPerPhoto: policy.reel.secondsPerPhoto,
      maxOutputBytes: policy.reel.maxOutputBytes,
    },
  }),
  recoverReels: makeRecoverReels({
    reels: adapters.reels,
    media: adapters.media,
    clock: adapters.clock,
    logger: adapters.logger,
  }),

  // favourites
  setPhotoHighlight: makeSetPhotoHighlight({
    events: adapters.events,
    photos: adapters.photos,
    clock: adapters.clock,
  }),
  preselectHighlights: makePreselectHighlights({
    events: adapters.events,
    photos: adapters.photos,
    reactions: adapters.reactions,
    clock: adapters.clock,
  }),
  getHighlights: makeGetHighlights({
    events: adapters.events,
    photos: adapters.photos,
    reels: adapters.reels,
    media: adapters.media,
    secondsPerPhoto: policy.reel.secondsPerPhoto,
  }),
  getReelMedia: makeGetReelMedia({
    events: adapters.events,
    photos: adapters.photos,
    reels: adapters.reels,
    media: adapters.media,
    invalidateReel,
  }),
  exportHighlights: makeExportHighlights({
    events: adapters.events,
    photos: adapters.photos,
    media: adapters.media,
    archive: adapters.archive,
    logger: adapters.logger,
  }),
})
