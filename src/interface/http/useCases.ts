import type { HttpDeps } from './types'
import type { PresenterContext } from './presenters/presenters'
import type { AuthenticateUser } from '../../application/usecases/auth/authenticateUser'
import type { AcceptInvitation } from '../../application/usecases/auth/acceptInvitation'
import type { ChangePassword } from '../../application/usecases/auth/changePassword'
import type { PreviewInvitation } from '../../application/usecases/auth/previewInvitation'
import type { ConfirmTotpEnrollment } from '../../application/usecases/auth/confirmTotpEnrollment'
import type { DisableSecondFactor } from '../../application/usecases/auth/disableSecondFactor'
import type { EnrollTotp } from '../../application/usecases/auth/enrollTotp'
import type { RegenerateRecoveryCodes } from '../../application/usecases/auth/regenerateRecoveryCodes'
import type { RegisterModerator } from '../../application/usecases/auth/registerModerator'
import type { RequestPasswordReset } from '../../application/usecases/auth/requestPasswordReset'
import type { ResetPassword } from '../../application/usecases/auth/resetPassword'
import type { RevokeOtherSessions } from '../../application/usecases/auth/revokeOtherSessions'
import type { StepUp } from '../../application/usecases/auth/stepUp'
import type { VerifySecondFactor } from '../../application/usecases/auth/verifySecondFactor'

import type { IssuePasswordResetForAccount } from '../../application/usecases/auth/issuePasswordResetForAccount'

import type { ApproveInvitation } from '../../application/usecases/clients/approveInvitation'
import type { ApprovePasswordReset } from '../../application/usecases/clients/approvePasswordReset'
import type { InviteToClientAsOperator } from '../../application/usecases/clients/inviteToClientAsOperator'
import type { ProvisionClientOwner } from '../../application/usecases/clients/provisionClientOwner'
import type { RenameClient } from '../../application/usecases/clients/renameClient'
import type { ResumeClient } from '../../application/usecases/clients/resumeClient'
import type { DisableAccount } from '../../application/usecases/auth/disableAccount'
import type { EnableAccount } from '../../application/usecases/auth/enableAccount'
import type { DeleteAccount } from '../../application/usecases/site/deleteAccount'
import type { OffboardClient } from '../../application/usecases/clients/offboardClient'
import type { SetClientCeilings } from '../../application/usecases/clients/setClientCeilings'
import type { SuspendClient } from '../../application/usecases/clients/suspendClient'
import type { GetSiteEventState } from '../../application/usecases/site/getSiteEventState'
import type { GetSitePhotoState } from '../../application/usecases/site/getSitePhotoState'
import type { LookupSiteEvents } from '../../application/usecases/site/lookupSiteEvents'
import type { SetEventPurgeHold } from '../../application/usecases/site/setEventPurgeHold'
import type { SetEventTakedown } from '../../application/usecases/site/setEventTakedown'
import type { SetPhotoTakedown } from '../../application/usecases/site/setPhotoTakedown'
import type { ListSiteAccounts } from '../../application/usecases/site/listSiteAccounts'
import type { ListSiteAudit } from '../../application/usecases/site/listSiteAudit'
import type { ListSiteClientEvents } from '../../application/usecases/site/listSiteClientEvents'
import type { ListSiteClients } from '../../application/usecases/site/listSiteClients'
import type { GetClientLimits } from '../../application/usecases/clients/getClientLimits'
import type { ListClientAudit } from '../../application/usecases/clients/listClientAudit'
import type { ListPendingInvitations } from '../../application/usecases/clients/listPendingInvitations'
import type { GetEventView } from '../../application/usecases/events/getEventView'

import type { ChangeEventStatus } from '../../application/usecases/events/changeEventStatus'
import type { CreateEvent } from '../../application/usecases/events/createEvent'
import type { GetEventBySlug } from '../../application/usecases/events/getEventBySlug'
import type { ListEventsForHost } from '../../application/usecases/events/listEventsForHost'
import type { ListModerators } from '../../application/usecases/events/listModerators'
import type { GetVenuePhotoMedia } from '../../application/usecases/venue/getVenuePhotoMedia'
import type { RemoveVenuePhoto } from '../../application/usecases/venue/removeVenuePhoto'
import type { SetVenuePhoto } from '../../application/usecases/venue/setVenuePhoto'
import type { RenameEvent } from '../../application/usecases/events/renameEvent'
import type { RevokeModerator } from '../../application/usecases/events/revokeModerator'
import type { PurgeEvent } from '../../application/usecases/events/purgeEvent'
import type { ResolveJoinCode } from '../../application/usecases/events/resolveJoinCode'
import type { RotateJoinCode } from '../../application/usecases/events/rotateJoinCode'
import type { ScheduleEvent } from '../../application/usecases/events/scheduleEvent'
import type { UpdateEventSettings } from '../../application/usecases/events/updateEventSettings'

import type { AcknowledgePrivacyNotice } from '../../application/usecases/guests/acknowledgePrivacyNotice'
import type { GetPrivacyNotice } from '../../application/usecases/guests/getPrivacyNotice'
import type { JoinEvent } from '../../application/usecases/guests/joinEvent'
import type { ListGuests } from '../../application/usecases/guests/listGuests'
import type { EraseGuestContribution } from '../../application/usecases/guests/eraseGuestContribution'
import type { RenameGuest } from '../../application/usecases/guests/renameGuest'
import type { RevokeGuest } from '../../application/usecases/guests/revokeGuest'

import type { GetModerationQueue } from '../../application/usecases/moderation/getModerationQueue'
import type { ModeratePhoto } from '../../application/usecases/moderation/moderatePhoto'
import type { ModeratePhotosBulk } from '../../application/usecases/moderation/moderatePhotosBulk'

import type { GetClipJob } from '../../application/usecases/clips/getClipJob'
import type { UploadClip } from '../../application/usecases/clips/uploadClip'

import type { DeletePhoto } from '../../application/usecases/photos/deletePhoto'
import type { ExportAlbum } from '../../application/usecases/photos/exportAlbum'
import type { GetPhotoMedia } from '../../application/usecases/photos/getPhotoMedia'
import type { IdentifyMediaViewer } from '../../application/usecases/photos/identifyMediaViewer'
import type { ListEventPhotos } from '../../application/usecases/photos/listEventPhotos'
import type { ListGuestPhotos } from '../../application/usecases/photos/listGuestPhotos'
import type { SetPhotoCaption } from '../../application/usecases/photos/setPhotoCaption'
import type { UploadPhotos } from '../../application/usecases/photos/uploadPhotos'

import type { GetPhotoReactions } from '../../application/usecases/reactions/getPhotoReactions'
import type { GetTopPhotos } from '../../application/usecases/reactions/getTopPhotos'
import type { ReactToPhoto } from '../../application/usecases/reactions/reactToPhoto'
import type { WithdrawReaction } from '../../application/usecases/reactions/withdrawReaction'

import type { GetWallPlaylist } from '../../application/usecases/slideshow/getWallPlaylist'

import type { CreateMission } from '../../application/usecases/missions/createMission'
import type { DeleteMission } from '../../application/usecases/missions/deleteMission'
import type { GetGuestChecklist } from '../../application/usecases/missions/getGuestChecklist'
import type { ListMissions } from '../../application/usecases/missions/listMissions'
import type { UpdateMission } from '../../application/usecases/missions/updateMission'

import type { CreateShareLink } from '../../application/usecases/gallery/createShareLink'
import type { DownloadGalleryArchive } from '../../application/usecases/gallery/downloadGalleryArchive'
import type { GetGalleryMedia } from '../../application/usecases/gallery/getGalleryMedia'
import type { GetShareLink } from '../../application/usecases/gallery/getShareLink'
import type { ListGalleryPhotos } from '../../application/usecases/gallery/listGalleryPhotos'
import type { OpenGallery } from '../../application/usecases/gallery/openGallery'
import type { RevokeShareLink } from '../../application/usecases/gallery/revokeShareLink'
import type { UnlockGallery } from '../../application/usecases/gallery/unlockGallery'

/**
 * What the HTTP layer needs from the application.
 *
 * Declared here rather than imported from `src/main`, because the boundary rules
 * forbid `src/interface` reaching into the composition root — and rightly: this way
 * the HTTP layer states its requirements and the container proves it satisfies them,
 * rather than the HTTP layer being shaped by whatever the container happens to build.
 *
 * `bootstrapOwner`, `purgeExpiredEvents` and `applyEventSchedules` are deliberately
 * absent: they are startup and scheduled work, with no route, and listing them here
 * would invite one. `scheduleEvent` is the host-facing half of the last of those, and
 * that one does have a route.
 *
 * `transcodeNextClip` and `recoverClipJobs` are absent for the same reason, and the
 * reason is sharper for them: both drain a queue across **every** event on the box, so a
 * route in front of either would be an endpoint with no tenant to scope it to.
 *
 * `pruneAuditLog` is absent for the sharpest reason of all: it is the one thing that ever
 * deletes from the append-only audit log (roadmap §10.8), and the retention sweep is its
 * only caller. A route that could trigger it is a route that could shorten the log's memory.
 */
export interface HttpUseCases {
  // auth
  readonly authenticateUser: AuthenticateUser
  readonly changePassword: ChangePassword
  readonly revokeOtherSessions: RevokeOtherSessions
  readonly requestPasswordReset: RequestPasswordReset
  readonly resetPassword: ResetPassword
  readonly verifySecondFactor: VerifySecondFactor
  readonly enrollTotp: EnrollTotp
  readonly confirmTotpEnrollment: ConfirmTotpEnrollment
  readonly stepUp: StepUp
  readonly regenerateRecoveryCodes: RegenerateRecoveryCodes
  readonly disableSecondFactor: DisableSecondFactor
  readonly registerModerator: RegisterModerator
  readonly previewInvitation: PreviewInvitation
  readonly acceptInvitation: AcceptInvitation

  // the client's own space (G2-12 / P3-14): the owner's half of R1
  readonly approveInvitation: ApproveInvitation
  // ... and what it reads of its own space (G2-16 / P3-17), each scoped by the caller's roster
  readonly getClientLimits: GetClientLimits
  readonly listClientAudit: ListClientAudit
  readonly listPendingInvitations: ListPendingInvitations

  // the owner's half of R2 (G2-14 / P3-13): another owner of an account's client lets an operator be
  // handed its password-reset link, on a box with no mail relay and `copyLinkWithOwnerApproval`
  readonly approvePasswordReset: ApprovePasswordReset

  // the operator's namespace, `/api/site` (G2-14 / P3-13), behind `requireOperator`: what it reads of
  // the box, content-free (`SiteOverview`) ...
  readonly listSiteClients: ListSiteClients
  readonly listSiteClientEvents: ListSiteClientEvents
  readonly listSiteAccounts: ListSiteAccounts
  readonly listSiteAudit: ListSiteAudit
  // ... and what it does to a client and its owner, each audited and each reading the caller's site
  // role again for itself where the operator guard (R1, R2) is concerned
  readonly provisionClientOwner: ProvisionClientOwner
  readonly renameClient: RenameClient
  readonly setClientCeilings: SetClientCeilings
  readonly suspendClient: SuspendClient
  readonly resumeClient: ResumeClient
  // the operator's "remove without viewing" levers, by id (launch review S5)
  readonly setPhotoTakedown: SetPhotoTakedown
  readonly lookupSiteEvents: LookupSiteEvents
  readonly getSiteEventState: GetSiteEventState
  readonly getSitePhotoState: GetSitePhotoState
  readonly setEventTakedown: SetEventTakedown
  readonly setEventPurgeHold: SetEventPurgeHold
  readonly offboardClient: OffboardClient
  readonly disableAccount: DisableAccount
  readonly enableAccount: EnableAccount
  readonly deleteAccount: DeleteAccount
  readonly inviteToClientAsOperator: InviteToClientAsOperator
  readonly issuePasswordResetForAccount: IssuePasswordResetForAccount

  // events
  readonly createEvent: CreateEvent
  readonly getEventBySlug: GetEventBySlug
  readonly getEventView: GetEventView
  readonly listEventsForHost: ListEventsForHost
  readonly resolveJoinCode: ResolveJoinCode
  readonly updateEventSettings: UpdateEventSettings
  readonly rotateJoinCode: RotateJoinCode
  readonly changeEventStatus: ChangeEventStatus
  readonly scheduleEvent: ScheduleEvent
  readonly purgeEvent: PurgeEvent
  readonly renameEvent: RenameEvent
  // the host's own venue photograph (ADR 0010)
  readonly setVenuePhoto: SetVenuePhoto
  readonly removeVenuePhoto: RemoveVenuePhoto
  readonly getVenuePhotoMedia: GetVenuePhotoMedia
  readonly listModerators: ListModerators
  readonly revokeModerator: RevokeModerator

  // guests
  readonly joinEvent: JoinEvent
  readonly renameGuest: RenameGuest
  readonly eraseGuestContribution: EraseGuestContribution
  readonly revokeGuest: RevokeGuest
  readonly listGuests: ListGuests
  readonly getPrivacyNotice: GetPrivacyNotice
  readonly acknowledgePrivacyNotice: AcknowledgePrivacyNotice

  // photos
  readonly uploadPhotos: UploadPhotos
  readonly listEventPhotos: ListEventPhotos
  readonly listGuestPhotos: ListGuestPhotos
  readonly deletePhoto: DeletePhoto
  readonly setPhotoCaption: SetPhotoCaption
  readonly getPhotoMedia: GetPhotoMedia
  /** Who is asking for the bytes: the media route's one answer to "who is this" (HTTP-H-02). */
  readonly identifyMediaViewer: IdentifyMediaViewer
  readonly exportAlbum: ExportAlbum

  // clips
  readonly uploadClip: UploadClip
  readonly getClipJob: GetClipJob

  // moderation
  readonly getModerationQueue: GetModerationQueue
  readonly moderatePhoto: ModeratePhoto
  readonly moderatePhotosBulk: ModeratePhotosBulk

  // the wall
  readonly getWallPlaylist: GetWallPlaylist

  // missions
  readonly listMissions: ListMissions
  readonly createMission: CreateMission
  readonly updateMission: UpdateMission
  readonly deleteMission: DeleteMission
  readonly getGuestChecklist: GetGuestChecklist

  // the shared gallery (roadmap §4.1): the host's three, then the link holder's five
  readonly createShareLink: CreateShareLink
  readonly getShareLink: GetShareLink
  readonly revokeShareLink: RevokeShareLink
  readonly openGallery: OpenGallery
  readonly unlockGallery: UnlockGallery
  readonly listGalleryPhotos: ListGalleryPhotos
  readonly getGalleryMedia: GetGalleryMedia
  readonly downloadGalleryArchive: DownloadGalleryArchive

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
