import type { HttpDeps } from './types'
import type { PresenterContext } from './presenters/presenters'
import type { AuthenticateUser } from '../../application/usecases/auth/authenticateUser'
import type { ChangePassword } from '../../application/usecases/auth/changePassword'
import type { RegisterModerator } from '../../application/usecases/auth/registerModerator'

import type { ChangeEventStatus } from '../../application/usecases/events/changeEventStatus'
import type { CreateEvent } from '../../application/usecases/events/createEvent'
import type { GetEventBySlug } from '../../application/usecases/events/getEventBySlug'
import type { ListEventsForHost } from '../../application/usecases/events/listEventsForHost'
import type { PurgeEvent } from '../../application/usecases/events/purgeEvent'
import type { ResolveJoinCode } from '../../application/usecases/events/resolveJoinCode'
import type { RotateJoinCode } from '../../application/usecases/events/rotateJoinCode'
import type { UpdateEventSettings } from '../../application/usecases/events/updateEventSettings'

import type { AuthenticateGuest } from '../../application/usecases/guests/authenticateGuest'
import type { JoinEvent } from '../../application/usecases/guests/joinEvent'
import type { ListGuests } from '../../application/usecases/guests/listGuests'
import type { RenameGuest } from '../../application/usecases/guests/renameGuest'
import type { RevokeGuest } from '../../application/usecases/guests/revokeGuest'

import type { GetModerationQueue } from '../../application/usecases/moderation/getModerationQueue'
import type { ModeratePhoto } from '../../application/usecases/moderation/moderatePhoto'
import type { ModeratePhotosBulk } from '../../application/usecases/moderation/moderatePhotosBulk'

import type { DeletePhoto } from '../../application/usecases/photos/deletePhoto'
import type { ExportAlbum } from '../../application/usecases/photos/exportAlbum'
import type { GetPhotoMedia } from '../../application/usecases/photos/getPhotoMedia'
import type { ListEventPhotos } from '../../application/usecases/photos/listEventPhotos'
import type { ListGuestPhotos } from '../../application/usecases/photos/listGuestPhotos'
import type { SetPhotoCaption } from '../../application/usecases/photos/setPhotoCaption'
import type { UploadPhotos } from '../../application/usecases/photos/uploadPhotos'

import type { GetPhotoReactions } from '../../application/usecases/reactions/getPhotoReactions'
import type { GetTopPhotos } from '../../application/usecases/reactions/getTopPhotos'
import type { ReactToPhoto } from '../../application/usecases/reactions/reactToPhoto'
import type { WithdrawReaction } from '../../application/usecases/reactions/withdrawReaction'

import type { GetWallPlaylist } from '../../application/usecases/slideshow/getWallPlaylist'

/**
 * What the HTTP layer needs from the application.
 *
 * Declared here rather than imported from `src/main`, because the boundary rules
 * forbid `src/interface` reaching into the composition root — and rightly: this way
 * the HTTP layer states its requirements and the container proves it satisfies them,
 * rather than the HTTP layer being shaped by whatever the container happens to build.
 *
 * `bootstrapOwner` and `purgeExpiredEvents` are deliberately absent: they are startup
 * and scheduled work, with no route, and listing them here would invite one.
 */
export interface HttpUseCases {
  // auth
  readonly authenticateUser: AuthenticateUser
  readonly changePassword: ChangePassword
  readonly registerModerator: RegisterModerator

  // events
  readonly createEvent: CreateEvent
  readonly getEventBySlug: GetEventBySlug
  readonly listEventsForHost: ListEventsForHost
  readonly resolveJoinCode: ResolveJoinCode
  readonly updateEventSettings: UpdateEventSettings
  readonly rotateJoinCode: RotateJoinCode
  readonly changeEventStatus: ChangeEventStatus
  readonly purgeEvent: PurgeEvent

  // guests
  readonly joinEvent: JoinEvent
  readonly authenticateGuest: AuthenticateGuest
  readonly renameGuest: RenameGuest
  readonly revokeGuest: RevokeGuest
  readonly listGuests: ListGuests

  // photos
  readonly uploadPhotos: UploadPhotos
  readonly listEventPhotos: ListEventPhotos
  readonly listGuestPhotos: ListGuestPhotos
  readonly deletePhoto: DeletePhoto
  readonly setPhotoCaption: SetPhotoCaption
  readonly getPhotoMedia: GetPhotoMedia
  readonly exportAlbum: ExportAlbum

  // moderation
  readonly getModerationQueue: GetModerationQueue
  readonly moderatePhoto: ModeratePhoto
  readonly moderatePhotosBulk: ModeratePhotosBulk

  // the wall
  readonly getWallPlaylist: GetWallPlaylist

  // reactions
  readonly reactToPhoto: ReactToPhoto
  readonly withdrawReaction: WithdrawReaction
  readonly getPhotoReactions: GetPhotoReactions
  readonly getTopPhotos: GetTopPhotos
}

/** What every route module receives. */
export interface RouteDeps {
  readonly deps: HttpDeps
  readonly usecases: HttpUseCases
  readonly presenter: PresenterContext
}
