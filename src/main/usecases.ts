import type { Clock } from '../application/ports/clock'
import type { IdGenerator } from '../application/ports/idGenerator'
import type { Logger } from '../application/ports/logger'
import type { EventBus } from '../application/ports/eventBus'
import type { EventRepository } from '../application/ports/eventRepository'
import type { PhotoRepository } from '../application/ports/photoRepository'
import type { GuestRepository } from '../application/ports/guestRepository'
import type { ReactionRepository } from '../application/ports/reactionRepository'
import type { MembershipRepository, UserRepository } from '../application/ports/userRepository'
import type { MediaStore } from '../application/ports/mediaStore'
import type { ImageProcessor } from '../application/ports/imageProcessor'
import type { ClipJobRepository } from '../application/ports/clipJobRepository'
import type { MissionRepository } from '../application/ports/missionRepository'
import type { VideoTranscoder } from '../application/ports/videoTranscoder'
import type { ContentHasher } from '../application/ports/contentHasher'
import type { ArchiveWriter } from '../application/ports/archiveWriter'
import type { PasswordHasher } from '../application/ports/passwordHasher'
import type { GuestTokenService } from '../application/ports/guestTokenService'
import type { ShareLinkRepository } from '../application/ports/shareLinkRepository'
import type { GallerySigner } from '../application/ports/gallerySigner'

import { makeAuthenticateUser } from '../application/usecases/auth/authenticateUser'
import { makeBootstrapOwner } from '../application/usecases/auth/bootstrapOwner'
import { makeChangePassword } from '../application/usecases/auth/changePassword'
import { makeRegisterModerator } from '../application/usecases/auth/registerModerator'

import { makeApplyEventSchedules } from '../application/usecases/events/applyEventSchedules'
import { makeChangeEventStatus } from '../application/usecases/events/changeEventStatus'
import { makeCreateEvent } from '../application/usecases/events/createEvent'
import { makeGetEventBySlug } from '../application/usecases/events/getEventBySlug'
import { makeListEventsForHost } from '../application/usecases/events/listEventsForHost'
import { makePurgeEvent } from '../application/usecases/events/purgeEvent'
import { makePurgeExpiredEvents } from '../application/usecases/events/purgeExpiredEvents'
import { makeSweepOrphanedMedia } from '../application/usecases/media/sweepOrphanedMedia'
import { makeResolveJoinCode } from '../application/usecases/events/resolveJoinCode'
import { makeRotateJoinCode } from '../application/usecases/events/rotateJoinCode'
import { makeScheduleEvent } from '../application/usecases/events/scheduleEvent'
import { makeUpdateEventSettings } from '../application/usecases/events/updateEventSettings'

import { makeAcknowledgePrivacyNotice } from '../application/usecases/guests/acknowledgePrivacyNotice'
import { makeAuthenticateGuest } from '../application/usecases/guests/authenticateGuest'
import { makeGetPrivacyNotice } from '../application/usecases/guests/getPrivacyNotice'
import { makeJoinEvent } from '../application/usecases/guests/joinEvent'
import { makeListGuests } from '../application/usecases/guests/listGuests'
import { makeRenameGuest } from '../application/usecases/guests/renameGuest'
import { makeRevokeGuest } from '../application/usecases/guests/revokeGuest'

import { makeGetModerationQueue } from '../application/usecases/moderation/getModerationQueue'
import { makeModeratePhoto } from '../application/usecases/moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../application/usecases/moderation/moderatePhotosBulk'

import { makeDeletePhoto } from '../application/usecases/photos/deletePhoto'
import { makeExportAlbum } from '../application/usecases/photos/exportAlbum'
import { makeGetPhotoMedia } from '../application/usecases/photos/getPhotoMedia'
import { makeListEventPhotos } from '../application/usecases/photos/listEventPhotos'
import { makeListGuestPhotos } from '../application/usecases/photos/listGuestPhotos'
import { makeSetPhotoCaption } from '../application/usecases/photos/setPhotoCaption'
import { makeUploadPhotos } from '../application/usecases/photos/uploadPhotos'

import { makeGetPhotoReactions } from '../application/usecases/reactions/getPhotoReactions'
import { makeGetTopPhotos } from '../application/usecases/reactions/getTopPhotos'
import { makeReactToPhoto } from '../application/usecases/reactions/reactToPhoto'
import { makeWithdrawReaction } from '../application/usecases/reactions/withdrawReaction'

import { makeGetClipJob } from '../application/usecases/clips/getClipJob'
import { makeReapStaleReservations } from '../application/usecases/clips/reapStaleReservations'
import { makeRecoverClipJobs } from '../application/usecases/clips/recoverClipJobs'
import { makeTranscodeNextClip } from '../application/usecases/clips/transcodeNextClip'
import { makeUploadClip } from '../application/usecases/clips/uploadClip'

import { makeGetWallPlaylist } from '../application/usecases/slideshow/getWallPlaylist'

import { makeCreateMission } from '../application/usecases/missions/createMission'
import { makeDeleteMission } from '../application/usecases/missions/deleteMission'
import { makeGetGuestChecklist } from '../application/usecases/missions/getGuestChecklist'
import { makeListMissions } from '../application/usecases/missions/listMissions'
import { makeUpdateMission } from '../application/usecases/missions/updateMission'

import { makeCreateShareLink } from '../application/usecases/gallery/createShareLink'
import { makeDownloadGalleryArchive } from '../application/usecases/gallery/downloadGalleryArchive'
import { makeGetGalleryMedia } from '../application/usecases/gallery/getGalleryMedia'
import { makeGetShareLink } from '../application/usecases/gallery/getShareLink'
import { makeListGalleryPhotos } from '../application/usecases/gallery/listGalleryPhotos'
import { makeOpenGallery } from '../application/usecases/gallery/openGallery'
import { makeRevokeShareLink } from '../application/usecases/gallery/revokeShareLink'
import { makeUnlockGallery } from '../application/usecases/gallery/unlockGallery'

/**
 * Every adapter the use cases need, as ports.
 *
 * Assembled in `container.ts`; this file only knows the interfaces, which is what
 * keeps the wiring readable and lets a test build the whole bag out of fakes.
 */
export interface Adapters {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly bus: EventBus
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly clips: ClipJobRepository
  readonly guests: GuestRepository
  readonly reactions: ReactionRepository
  readonly missions: MissionRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  /** The real encoder, or the Null Object when this box has none. */
  readonly videoTranscoder: VideoTranscoder
  readonly contentHasher: ContentHasher
  readonly archive: ArchiveWriter
  readonly passwordHasher: PasswordHasher
  readonly guestTokens: GuestTokenService
  /** The shared gallery's links (roadmap §4.1). */
  readonly shareLinks: ShareLinkRepository
  /** Tokens, their digests, and the MAC behind every signed gallery URL. */
  readonly gallerySigner: GallerySigner
}

/** The policy values a use case needs, drawn from validated configuration. */
export interface UseCasePolicy {
  readonly defaultEventQuotaBytes: number
  readonly maxImagePixels: number
  readonly reactionBudget: {
    readonly windowMs: number
    readonly maxPerWindow: number
  }
  /** How recently written an object must be for the reconciliation sweep to spare it. */
  readonly mediaSweepMinimumAgeMs: number
  /** The most digests one reconciliation pass will consider, across every event. */
  readonly mediaSweepMaxDigestsPerPass: number
  readonly clips: {
    readonly maxQueuedClips: number
    /** How long a reservation may sit before recovery treats it as wreckage. */
    readonly reservationTimeoutMs: number
    readonly maxHeight: number
    readonly maxDurationMs: number
    readonly maxOutputBytes: number
    readonly posterMaxEdge: number
    readonly maxPixels: number
  }
}

/** The ports every gallery use case's access rule reads. */
const galleryAccess = (adapters: Adapters) => ({
  shareLinks: adapters.shareLinks,
  events: adapters.events,
  memberships: adapters.memberships,
  signer: adapters.gallerySigner,
  clock: adapters.clock,
})

/**
 * Builds every use case once, at startup.
 *
 * One place where adapters and use cases meet, and the only place either is
 * constructed. A route receives the resulting functions and can neither reach an
 * adapter nor decide how one is built — which is what the eslint boundary rules
 * enforce, and what makes the HTTP layer testable with fakes.
 */
export const buildUseCases = (adapters: Adapters, policy: UseCasePolicy) => ({
  // ------------------------------------------------------------------- auth --
  authenticateUser: makeAuthenticateUser({
    users: adapters.users,
    hasher: adapters.passwordHasher,
    clock: adapters.clock,
  }),
  changePassword: makeChangePassword({
    users: adapters.users,
    hasher: adapters.passwordHasher,
  }),
  registerModerator: makeRegisterModerator({
    events: adapters.events,
    users: adapters.users,
    memberships: adapters.memberships,
    hasher: adapters.passwordHasher,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  bootstrapOwner: makeBootstrapOwner({
    users: adapters.users,
    hasher: adapters.passwordHasher,
    ids: adapters.ids,
    clock: adapters.clock,
  }),

  // ----------------------------------------------------------------- events --
  createEvent: makeCreateEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    ids: adapters.ids,
    clock: adapters.clock,
    defaultQuotaBytes: policy.defaultEventQuotaBytes,
  }),
  getEventBySlug: makeGetEventBySlug({ events: adapters.events }),
  listEventsForHost: makeListEventsForHost({ events: adapters.events }),
  resolveJoinCode: makeResolveJoinCode({ events: adapters.events }),
  updateEventSettings: makeUpdateEventSettings({
    events: adapters.events,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  rotateJoinCode: makeRotateJoinCode({
    events: adapters.events,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
  }),
  changeEventStatus: makeChangeEventStatus({
    events: adapters.events,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  purgeEvent: makePurgeEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
  }),
  purgeExpiredEvents: makePurgeExpiredEvents({
    events: adapters.events,
    media: adapters.media,
    clock: adapters.clock,
  }),
  /**
   * The collector the clip upload, the losing staging attempt and `recoverClipJobs` all
   * rely on. None of those deletes media itself any more, because deleting by digest can
   * destroy a byte-identical file somebody else owns.
   */
  sweepOrphanedMedia: makeSweepOrphanedMedia({
    photos: adapters.photos,
    clips: adapters.clips,
    media: adapters.media,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      minimumAgeMs: policy.mediaSweepMinimumAgeMs,
      maxDigestsPerPass: policy.mediaSweepMaxDigestsPerPass,
    },
  }),
  scheduleEvent: makeScheduleEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  /** The sweep behind the two scheduled instants. No actor: `src/main` drives it. */
  applyEventSchedules: makeApplyEventSchedules({
    events: adapters.events,
    bus: adapters.bus,
    clock: adapters.clock,
  }),

  // ----------------------------------------------------------------- guests --
  joinEvent: makeJoinEvent({
    events: adapters.events,
    guests: adapters.guests,
    tokens: adapters.guestTokens,
    ids: adapters.ids,
    clock: adapters.clock,
    bus: adapters.bus,
  }),
  authenticateGuest: makeAuthenticateGuest({
    events: adapters.events,
    guests: adapters.guests,
    tokens: adapters.guestTokens,
    clock: adapters.clock,
  }),
  renameGuest: makeRenameGuest({ guests: adapters.guests }),
  revokeGuest: makeRevokeGuest({
    guests: adapters.guests,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  listGuests: makeListGuests({
    guests: adapters.guests,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  getPrivacyNotice: makeGetPrivacyNotice({ events: adapters.events, guests: adapters.guests }),
  acknowledgePrivacyNotice: makeAcknowledgePrivacyNotice({
    events: adapters.events,
    guests: adapters.guests,
    clock: adapters.clock,
  }),

  // ----------------------------------------------------------------- photos --
  uploadPhotos: makeUploadPhotos({
    events: adapters.events,
    photos: adapters.photos,
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
  listGuestPhotos: makeListGuestPhotos({ events: adapters.events, photos: adapters.photos }),
  deletePhoto: makeDeletePhoto({
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
  }),
  getPhotoMedia: makeGetPhotoMedia({ photos: adapters.photos, media: adapters.media }),
  exportAlbum: makeExportAlbum({
    events: adapters.events,
    photos: adapters.photos,
    media: adapters.media,
    archive: adapters.archive,
    logger: adapters.logger,
  }),

  // ------------------------------------------------------------------ clips --
  uploadClip: makeUploadClip({
    events: adapters.events,
    clips: adapters.clips,
    photos: adapters.photos,
    media: adapters.media,
    transcoder: adapters.videoTranscoder,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    logger: adapters.logger,
    limits: { maxQueuedClips: policy.clips.maxQueuedClips },
  }),
  getClipJob: makeGetClipJob({ clips: adapters.clips }),
  /**
   * The two the HTTP layer deliberately does not list.
   *
   * Both drain the queue across **every** event on the box, so a route in front of
   * either would be an endpoint with no tenant to scope it to. `src/main/clipWorker.ts`
   * is their only caller.
   */
  transcodeNextClip: makeTranscodeNextClip({
    events: adapters.events,
    clips: adapters.clips,
    photos: adapters.photos,
    media: adapters.media,
    transcoder: adapters.videoTranscoder,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      maxHeight: policy.clips.maxHeight,
      maxDurationMs: policy.clips.maxDurationMs,
      maxOutputBytes: policy.clips.maxOutputBytes,
      posterMaxEdge: policy.clips.posterMaxEdge,
      maxPixels: policy.clips.maxPixels,
    },
  }),
  // **It takes no media store at all, and that is the design rather than an omission.**
  // It puts a `running` row back on the queue, or gives up on one that has spent its
  // attempts — and an abandoned job keeps its source: `failed` releases the digest from
  // the partial unique index, so an unlink after that commit races the guest's own
  // re-upload for bytes the new reservation now owns. Stale *reservations* are the
  // reaper's, which deletes the row and leaves the bytes for the same reason. Every
  // digest either of them leaves behind is `sweepOrphanedMedia`'s to collect, which is
  // the one caller that re-checks the database with nothing between it and the unlink.
  recoverClipJobs: makeRecoverClipJobs({
    clips: adapters.clips,
    clock: adapters.clock,
    logger: adapters.logger,
  }),

  /**
   * Reservations, on a short timer rather than only at boot — see the use case. It is
   * separate from `recoverClipJobs` because that one may run **only** at startup:
   * `recoverAbandoned` reads every `running` row as the wreckage of a dead process, which
   * is true then and false while the encoder is working.
   */
  reapStaleReservations: makeReapStaleReservations({
    clips: adapters.clips,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: { reservationTimeoutMs: policy.clips.reservationTimeoutMs },
  }),

  // ------------------------------------------------------------- moderation --
  getModerationQueue: makeGetModerationQueue({
    events: adapters.events,
    photos: adapters.photos,
    guests: adapters.guests,
    memberships: adapters.memberships,
  }),
  moderatePhoto: makeModeratePhoto({
    events: adapters.events,
    photos: adapters.photos,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  moderatePhotosBulk: makeModeratePhotosBulk({
    events: adapters.events,
    photos: adapters.photos,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),

  // -------------------------------------------------------------- slideshow --
  getWallPlaylist: makeGetWallPlaylist({
    events: adapters.events,
    photos: adapters.photos,
    guests: adapters.guests,
    missions: adapters.missions,
  }),

  // --------------------------------------------------------------- missions --
  listMissions: makeListMissions({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
  }),
  createMission: makeCreateMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  updateMission: makeUpdateMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  deleteMission: makeDeleteMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  getGuestChecklist: makeGetGuestChecklist({
    events: adapters.events,
    missions: adapters.missions,
  }),

  // --------------------------------------------------------- shared gallery --
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
  openGallery: makeOpenGallery({ ...galleryAccess(adapters), photos: adapters.photos }),
  unlockGallery: makeUnlockGallery({ ...galleryAccess(adapters), hasher: adapters.passwordHasher }),
  listGalleryPhotos: makeListGalleryPhotos({ ...galleryAccess(adapters), photos: adapters.photos }),
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
  }),

  // -------------------------------------------------------------- reactions --
  reactToPhoto: makeReactToPhoto({
    events: adapters.events,
    photos: adapters.photos,
    reactions: adapters.reactions,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    budget: policy.reactionBudget,
  }),
  withdrawReaction: makeWithdrawReaction({ reactions: adapters.reactions }),
  getPhotoReactions: makeGetPhotoReactions({
    photos: adapters.photos,
    reactions: adapters.reactions,
  }),
  getTopPhotos: makeGetTopPhotos({ photos: adapters.photos, reactions: adapters.reactions }),
})

export type UseCases = ReturnType<typeof buildUseCases>
