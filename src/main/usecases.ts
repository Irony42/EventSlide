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
import type { ContentHasher } from '../application/ports/contentHasher'
import type { ArchiveWriter } from '../application/ports/archiveWriter'
import type { PasswordHasher } from '../application/ports/passwordHasher'
import type { GuestTokenService } from '../application/ports/guestTokenService'

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
import { makeResolveJoinCode } from '../application/usecases/events/resolveJoinCode'
import { makeRotateJoinCode } from '../application/usecases/events/rotateJoinCode'
import { makeScheduleEvent } from '../application/usecases/events/scheduleEvent'
import { makeUpdateEventSettings } from '../application/usecases/events/updateEventSettings'

import { makeAuthenticateGuest } from '../application/usecases/guests/authenticateGuest'
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

import { makeGetWallPlaylist } from '../application/usecases/slideshow/getWallPlaylist'

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
  readonly guests: GuestRepository
  readonly reactions: ReactionRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  readonly contentHasher: ContentHasher
  readonly archive: ArchiveWriter
  readonly passwordHasher: PasswordHasher
  readonly guestTokens: GuestTokenService
}

/** The policy values a use case needs, drawn from validated configuration. */
export interface UseCasePolicy {
  readonly defaultEventQuotaBytes: number
  readonly maxImagePixels: number
  readonly reactionBudget: {
    readonly windowMs: number
    readonly maxPerWindow: number
  }
}

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

  // ----------------------------------------------------------------- photos --
  uploadPhotos: makeUploadPhotos({
    events: adapters.events,
    photos: adapters.photos,
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
