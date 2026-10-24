import type { OperatorResetLinks } from '../domain/clients/operatorGuard'
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
import type { ClientRepository } from '../application/ports/clientRepository'
import type { AuditLog } from '../application/ports/auditLog'
import type { SiteOverview } from '../application/ports/siteOverview'
import type { AccountTokenRepository } from '../application/ports/accountTokenRepository'
import type { MfaVault } from '../application/ports/mfaVault'
import type { SignInAttempts } from '../application/ports/signInAttempts'
import type { SecondFactorRepository } from '../application/ports/secondFactorRepository'
import type { TotpEngine } from '../application/ports/totpEngine'
import type { InvitationAcceptance } from '../application/ports/invitationAcceptance'
import type { Mailer } from '../application/ports/mailer'
import type { SecretTokens } from '../application/ports/secretTokens'
import type { GallerySigner } from '../application/ports/gallerySigner'

import { makeAuthenticateUser } from '../application/usecases/auth/authenticateUser'
import { makeAcceptInvitation } from '../application/usecases/auth/acceptInvitation'
import { makeBootstrapOwner } from '../application/usecases/auth/bootstrapOwner'
import { makeChangePassword } from '../application/usecases/auth/changePassword'
import { makeConfirmTotpEnrollment } from '../application/usecases/auth/confirmTotpEnrollment'
import { makeDisableAccount } from '../application/usecases/auth/disableAccount'
import { makeEnableAccount } from '../application/usecases/auth/enableAccount'
import { makeDeleteAccount } from '../application/usecases/site/deleteAccount'
import { makeOffboardClient } from '../application/usecases/clients/offboardClient'
import { makeFinalizeOffboardedClients } from '../application/usecases/clients/finalizeOffboardedClients'
import type { AccountHoldings } from '../application/ports/accountHoldings'
import { makeDisableSecondFactor } from '../application/usecases/auth/disableSecondFactor'
import { makeEnrollTotp } from '../application/usecases/auth/enrollTotp'
import { makeRegenerateRecoveryCodes } from '../application/usecases/auth/regenerateRecoveryCodes'
import { makeIssueInvitation } from '../application/usecases/auth/issueInvitation'
import { makeIssuePasswordResetForAccount } from '../application/usecases/auth/issuePasswordResetForAccount'
import { makePreviewInvitation } from '../application/usecases/auth/previewInvitation'
import { makeRegisterModerator } from '../application/usecases/auth/registerModerator'
import { makeRequestPasswordReset } from '../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../application/usecases/auth/resetPassword'
import { makeRevokeOtherSessions } from '../application/usecases/auth/revokeOtherSessions'
import { makeStepUp } from '../application/usecases/auth/stepUp'
import { makeVerifySecondFactor } from '../application/usecases/auth/verifySecondFactor'

import { makeApplyEventSchedules } from '../application/usecases/events/applyEventSchedules'
import { makeChangeEventStatus } from '../application/usecases/events/changeEventStatus'
import {
  makeCreateEvent,
  type EventCreationPolicy,
} from '../application/usecases/events/createEvent'
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
import { makeIdentifyMediaViewer } from '../application/usecases/photos/identifyMediaViewer'
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

import { makeCreateClient } from '../application/usecases/clients/createClient'
import { makeDeleteEmptyClient } from '../application/usecases/clients/deleteEmptyClient'
import { makeListClients } from '../application/usecases/clients/listClients'
import { makeApproveInvitation } from '../application/usecases/clients/approveInvitation'
import { makeGetClientLimits } from '../application/usecases/clients/getClientLimits'
import { makeListClientAudit } from '../application/usecases/clients/listClientAudit'
import { makeListPendingInvitations } from '../application/usecases/clients/listPendingInvitations'
import { makeGetEventLimits } from '../application/usecases/events/getEventLimits'
import { makeApprovePasswordReset } from '../application/usecases/clients/approvePasswordReset'
import { makeInviteToClientAsOperator } from '../application/usecases/clients/inviteToClientAsOperator'
import { makeProvisionClientOwner } from '../application/usecases/clients/provisionClientOwner'
import { makeRenameClient } from '../application/usecases/clients/renameClient'
import { makeResumeClient } from '../application/usecases/clients/resumeClient'
import { makeSetClientCeilings } from '../application/usecases/clients/setClientCeilings'
import { makeSuspendClient } from '../application/usecases/clients/suspendClient'
import { makeListSiteAccounts } from '../application/usecases/site/listSiteAccounts'
import { makeListSiteAudit } from '../application/usecases/site/listSiteAudit'
import { makeListSiteClientEvents } from '../application/usecases/site/listSiteClientEvents'
import { makeListSiteClients } from '../application/usecases/site/listSiteClients'
import type { NewClientDefaults } from '../domain/clients/newClientCeilings'
import type { TermsOfUse } from '../domain/legal/termsOfUse'
import { makePruneAuditLog } from '../application/usecases/audit/pruneAuditLog'
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
  /** Clients as records (roadmap §10.2). Empty on a box that never created one. */
  readonly clients: ClientRepository
  /** Tokens, their digests, and the MAC behind every signed gallery URL. */
  readonly gallerySigner: GallerySigner
  /** The append-only audit log (roadmap §10.8). Empty on a box nobody operates. */
  readonly audit: AuditLog
  /** What the operator may see of the box: ids, statuses, instants and sizes, no content (§10.4). */
  readonly siteOverview: SiteOverview
  /** What an account holds that deleting it would destroy: counts only (G2-14 part 3). */
  readonly accountHoldings: AccountHoldings
  /** One-use links that prove control of a mailbox (roadmap §10.3). Digests only. */
  readonly accountTokens: AccountTokenRepository
  /** The secrets that go in those links, and the digests they are stored as. */
  readonly secretTokens: SecretTokens
  /** `NullMailer` unless `SMTP_URL` is set (roadmap §10.3). */
  readonly mailer: Mailer
  /** The operators' authenticators and recovery codes (roadmap §10.1, G2-13). */
  readonly secondFactors: SecondFactorRepository
  /** RFC 6238's one primitive. */
  readonly totpEngine: TotpEngine
  /** Encryption of a secret at rest; `null` on a box with no `MFA_ENCRYPTION_KEY`. */
  readonly mfaVault: MfaVault | null
  /** How many second-factor guesses each half-finished sign-in has spent. In memory, one per box. */
  readonly signInAttempts: SignInAttempts
  /** Spending an invitation: the link, the account and the grant in one transaction. */
  readonly invitationAcceptance: InvitationAcceptance
}

/** The policy values a use case needs, drawn from validated configuration. */
export interface UseCasePolicy {
  /** `OPERATOR_RESET_LINKS`: whether an operator's reset may ever be handed to them as a link (G2-12 / P3-14). */
  readonly operatorResetLinks: OperatorResetLinks
  /** `PUBLIC_URL`, without a trailing slash: the origin a mailed link points at. */
  readonly publicUrl: string
  readonly defaultEventQuotaBytes: number
  /** `uploads.maxEventQuotaBytes`: the box-wide ceiling (G3-02), `null` meaning none. */
  readonly maxEventQuotaBytes: number | null
  readonly maxImagePixels: number
  /**
   * P4-09 / D-14 (roadmap G3-05), grouped the way `createEvent` and `rotateJoinCode`
   * consume them. See `AppConfig['events']` for what each one defaults to and why.
   */
  readonly events: {
    readonly slugSuffix: 'none' | 'random'
    readonly allowCustomSlugs: boolean
    readonly joinCodeLength: number
    /** `EVENT_CREATION`: who may create an event (P3-05 / G2-04). */
    readonly creation: EventCreationPolicy
  }
  /** What an authenticator app shows above the digits: the box's operator, or the product. */
  readonly mfaIssuer: string
  /** `RETENTION_CAP_NOTICE_DAYS`, read by the purge. */
  readonly retention: { readonly capNoticeDays: number }
  readonly reactionBudget: {
    readonly windowMs: number
    readonly maxPerWindow: number
  }
  /** How recently written an object must be for the reconciliation sweep to spare it. */
  readonly mediaSweepMinimumAgeMs: number
  /** The most digests one reconciliation pass will consider, across every event. */
  readonly mediaSweepMaxDigestsPerPass: number
  /** `audit.retentionDays`: how long a row of the audit log is kept. 365 at the least. */
  readonly auditRetentionDays: number
  /**
   * `newClientCeilings`: what `provisionClientOwner` gives a client whose operator named no
   * ceiling (`NEW_CLIENT_*`, G2-18). No ceiling at all on a box that set none.
   */
  readonly newClientDefaults: NewClientDefaults
  /**
   * `operator.name`: who the guest's privacy notice says hosts their photo, or `null` on a
   * box whose operator said nothing (roadmap G2-17). One value for the three use cases that
   * derive the notice, so a guest's acknowledgement is always compared with the text they saw.
   */
  readonly operatorName: string | null
  /**
   * `termsOfUse`: the terms an invitation's acceptance asks the person to agree to, or `null`
   * on a box that asks for none, which is every self-hosted box (`LEGAL_TERMS_URL` with
   * `LEGAL_TERMS_VERSION`, G2-20). Required here and not optional, so a composition that forgets
   * it does not fail open: the test that boots the real container holds it to the config.
   */
  readonly termsOfUse: TermsOfUse | null
  readonly clips: {
    readonly maxQueuedClips: number
    /** The same backpressure, scoped to one event. */
    readonly maxQueuedClipsPerEvent: number
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
 * One instance of the second-factor check per caller. The check holds no state of its own; what
 * is counted across calls (a sign-in's guesses) lives in `adapters.signInAttempts`, which is one
 * object for the whole box, so every instance reads the same count.
 */
const verifySecondFactorFrom = (adapters: Adapters) =>
  makeVerifySecondFactor({
    users: adapters.users,
    factors: adapters.secondFactors,
    vault: adapters.mfaVault,
    engine: adapters.totpEngine,
    secrets: adapters.secretTokens,
    attempts: adapters.signInAttempts,
    audit: adapters.audit,
    clock: adapters.clock,
    logger: adapters.logger,
  })

/**
 * The ports that read an invitation and judge it, which the preview and the acceptance share
 * so what a page shows and what an acceptance does are one reading of one link.
 */
const invitationReaders = (adapters: Adapters) => ({
  tokens: adapters.accountTokens,
  secrets: adapters.secretTokens,
  events: adapters.events,
  clients: adapters.clients,
  memberships: adapters.memberships,
  users: adapters.users,
})

const invitationIssuer = (adapters: Adapters, policy: UseCasePolicy) =>
  makeIssueInvitation({
    tokens: adapters.accountTokens,
    secrets: adapters.secretTokens,
    mailer: adapters.mailer,
    ids: adapters.ids,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
  })

const clientCreator = (adapters: Adapters) =>
  makeCreateClient({
    clients: adapters.clients,
    ids: adapters.ids,
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
export const buildUseCases = (adapters: Adapters, policy: UseCasePolicy) => {
  /**
   * **One issuer for the whole box.** The per-address queue that keeps the cap and the one-live-link
   * rule true under concurrency lives inside it, so two instances would be two queues, and a host
   * inviting an address at the moment the operator opens a client for it would race past both.
   */
  const issueInvitation = invitationIssuer(adapters, policy)

  return {
    // ------------------------------------------------------------------- auth --
    authenticateUser: makeAuthenticateUser({
      users: adapters.users,
      factors: adapters.secondFactors,
      hasher: adapters.passwordHasher,
      clock: adapters.clock,
    }),
    changePassword: makeChangePassword({
      users: adapters.users,
      hasher: adapters.passwordHasher,
      clock: adapters.clock,
    }),
    revokeOtherSessions: makeRevokeOtherSessions({
      users: adapters.users,
      clock: adapters.clock,
    }),
    requestPasswordReset: makeRequestPasswordReset({
      users: adapters.users,
      tokens: adapters.accountTokens,
      secrets: adapters.secretTokens,
      mailer: adapters.mailer,
      ids: adapters.ids,
      clock: adapters.clock,
      logger: adapters.logger,
      publicUrl: policy.publicUrl,
    }),
    resetPassword: makeResetPassword({
      users: adapters.users,
      tokens: adapters.accountTokens,
      secrets: adapters.secretTokens,
      hasher: adapters.passwordHasher,
      clock: adapters.clock,
    }),
    verifySecondFactor: verifySecondFactorFrom(adapters),
    enrollTotp: makeEnrollTotp({
      users: adapters.users,
      factors: adapters.secondFactors,
      hasher: adapters.passwordHasher,
      vault: adapters.mfaVault,
      ids: adapters.ids,
      clock: adapters.clock,
      issuer: policy.mfaIssuer,
    }),
    confirmTotpEnrollment: makeConfirmTotpEnrollment({
      users: adapters.users,
      factors: adapters.secondFactors,
      vault: adapters.mfaVault,
      engine: adapters.totpEngine,
      secrets: adapters.secretTokens,
      ids: adapters.ids,
      audit: adapters.audit,
      clock: adapters.clock,
      logger: adapters.logger,
    }),
    stepUp: makeStepUp({
      users: adapters.users,
      factors: adapters.secondFactors,
      hasher: adapters.passwordHasher,
      verifySecondFactor: verifySecondFactorFrom(adapters),
    }),
    regenerateRecoveryCodes: makeRegenerateRecoveryCodes({
      users: adapters.users,
      factors: adapters.secondFactors,
      secrets: adapters.secretTokens,
      ids: adapters.ids,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    disableSecondFactor: makeDisableSecondFactor({
      users: adapters.users,
      factors: adapters.secondFactors,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * Built, and called by nothing yet: the operator API that puts its authorization in front
     * of it is its own item. Constructed here rather than there so the dependencies it needs —
     * the audit log among them — are wired once, with the rest of the auth use cases.
     */
    disableAccount: makeDisableAccount({
      users: adapters.users,
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /** The operator's account acts (G2-14 part 3): behind `/api/site`, a second factor and a step-up. */
    enableAccount: makeEnableAccount({
      users: adapters.users,
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    deleteAccount: makeDeleteAccount({
      users: adapters.users,
      clients: adapters.clients,
      holdings: adapters.accountHoldings,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * Previewing and accepting an invitation (G2-09 / P3-10): the invitee's, a link in a mail
     * and the account it creates. Writing one is the mechanism under the callers that decide
     * who may invite (`registerModerator`, `provisionClientOwner`), which build it for
     * themselves from `invitationIssuer`: it is not on this bag, so no route can reach it.
     */
    previewInvitation: makePreviewInvitation({
      ...invitationReaders(adapters),
      clock: adapters.clock,
      terms: policy.termsOfUse,
    }),
    acceptInvitation: makeAcceptInvitation({
      ...invitationReaders(adapters),
      users: adapters.users,
      hasher: adapters.passwordHasher,
      acceptance: adapters.invitationAcceptance,
      ids: adapters.ids,
      clock: adapters.clock,
      terms: policy.termsOfUse,
    }),
    registerModerator: makeRegisterModerator({
      events: adapters.events,
      users: adapters.users,
      memberships: adapters.memberships,
      issueInvitation,
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
      clients: adapters.clients,
      users: adapters.users,
      eventCreation: policy.events.creation,
      ids: adapters.ids,
      clock: adapters.clock,
      defaultQuotaBytes: policy.defaultEventQuotaBytes,
      maxQuotaBytes: policy.maxEventQuotaBytes,
      slugSuffix: policy.events.slugSuffix,
      allowCustomSlugs: policy.events.allowCustomSlugs,
      joinCodeLength: policy.events.joinCodeLength,
    }),
    getEventBySlug: makeGetEventBySlug({ events: adapters.events }),
    getEventLimits: makeGetEventLimits({ clients: adapters.clients }),
    listEventsForHost: makeListEventsForHost({ events: adapters.events }),
    resolveJoinCode: makeResolveJoinCode({ events: adapters.events }),
    updateEventSettings: makeUpdateEventSettings({
      events: adapters.events,
      clients: adapters.clients,
      memberships: adapters.memberships,
      bus: adapters.bus,
    }),
    rotateJoinCode: makeRotateJoinCode({
      events: adapters.events,
      memberships: adapters.memberships,
      ids: adapters.ids,
      bus: adapters.bus,
      joinCodeLength: policy.events.joinCodeLength,
    }),
    changeEventStatus: makeChangeEventStatus({
      events: adapters.events,
      clients: adapters.clients,
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
      capNoticeDays: policy.retention.capNoticeDays,
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
      clients: adapters.clients,
      bus: adapters.bus,
      clock: adapters.clock,
    }),

    // ----------------------------------------------------------------- guests --
    joinEvent: makeJoinEvent({
      events: adapters.events,
      clients: adapters.clients,
      guests: adapters.guests,
      tokens: adapters.guestTokens,
      ids: adapters.ids,
      clock: adapters.clock,
      bus: adapters.bus,
      operatorName: policy.operatorName,
    }),
    authenticateGuest: makeAuthenticateGuest({
      events: adapters.events,
      guests: adapters.guests,
      tokens: adapters.guestTokens,
      clock: adapters.clock,
      logger: adapters.logger,
    }),
    renameGuest: makeRenameGuest({ guests: adapters.guests, events: adapters.events }),
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
    getPrivacyNotice: makeGetPrivacyNotice({
      events: adapters.events,
      clients: adapters.clients,
      guests: adapters.guests,
      operatorName: policy.operatorName,
    }),
    acknowledgePrivacyNotice: makeAcknowledgePrivacyNotice({
      events: adapters.events,
      clients: adapters.clients,
      guests: adapters.guests,
      clock: adapters.clock,
      operatorName: policy.operatorName,
    }),

    // ----------------------------------------------------------------- photos --
    uploadPhotos: makeUploadPhotos({
      events: adapters.events,
      clients: adapters.clients,
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
    identifyMediaViewer: makeIdentifyMediaViewer({
      guests: adapters.guests,
      tokens: adapters.guestTokens,
      memberships: adapters.memberships,
      clock: adapters.clock,
    }),
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
      clients: adapters.clients,
      clips: adapters.clips,
      photos: adapters.photos,
      media: adapters.media,
      transcoder: adapters.videoTranscoder,
      hasher: adapters.contentHasher,
      bus: adapters.bus,
      clock: adapters.clock,
      ids: adapters.ids,
      logger: adapters.logger,
      limits: {
        maxQueuedClips: policy.clips.maxQueuedClips,
        maxQueuedClipsPerEvent: policy.clips.maxQueuedClipsPerEvent,
      },
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
      clients: adapters.clients,
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
    }),

    // ---------------------------------------------------------------- clients --
    //
    // Built whatever `SITE_ADMIN` says, like every use case: the mode decides which routes
    // are mounted (roadmap §10.9), never which use cases exist. The operator's routes call them
    // (`/api/site`, G2-14), behind `SITE_ADMIN` and `requireOperator`. The gate is the HTTP
    // layer's, so the use cases that write the audit log (§10.8) take an actor: an entry must say
    // who did it. `createClient` and `deleteEmptyClient` have no route: the first is what
    // `provisionClientOwner` builds on, and the second only removes the husk of a failed provisioning.
    createClient: clientCreator(adapters),
    /**
     * Opens a client and invites its owner (G2-09 / P3-10), behind `requireOperator` and a
     * step-up in `POST /api/site/clients` (G2-14).
     */
    provisionClientOwner: makeProvisionClientOwner({
      createClient: clientCreator(adapters),
      issueInvitation,
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      newClientDefaults: policy.newClientDefaults,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * The operator guard's use cases (G2-12 / P3-14, rules R1 and R2). The owner's two have
     * routes (`POST /api/client/invitations/:id/approve` and
     * `POST /api/client/password-resets/:id/approve`); the operator's two are called by
     * `/api/site/clients/:clientId/invitations` and `/api/site/accounts/:userId/password-reset`
     * (G2-14), behind `requireOperator`, the second factor and a step-up, and each reads the
     * caller's site role itself rather than trust the route to have checked it. They write invitations through the box's one issuer, so the
     * per-address queue is still one queue.
     */
    inviteToClientAsOperator: makeInviteToClientAsOperator({
      users: adapters.users,
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      issueInvitation,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    approveInvitation: makeApproveInvitation({
      users: adapters.users,
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * The client's own space, read-only (G2-16 / P3-17): the caller's limits, the log of their
     * own client and what waits for their approval. Mounted only on a box with `SITE_ADMIN=on`,
     * and scoped by the caller's own roster in each use case, never by an id from the request.
     */
    getClientLimits: makeGetClientLimits({ clients: adapters.clients, photos: adapters.photos }),
    listClientAudit: makeListClientAudit({ clients: adapters.clients, audit: adapters.audit }),
    listPendingInvitations: makeListPendingInvitations({
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      clock: adapters.clock,
    }),
    approvePasswordReset: makeApprovePasswordReset({
      users: adapters.users,
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    issuePasswordResetForAccount: makeIssuePasswordResetForAccount({
      users: adapters.users,
      clients: adapters.clients,
      tokens: adapters.accountTokens,
      secrets: adapters.secretTokens,
      mailer: adapters.mailer,
      ids: adapters.ids,
      clock: adapters.clock,
      logger: adapters.logger,
      publicUrl: policy.publicUrl,
      mode: policy.operatorResetLinks,
      audit: adapters.audit,
    }),
    // The operator's reads (G2-14): the read model and the log, and nothing else.
    listSiteClients: makeListSiteClients({ overview: adapters.siteOverview }),
    listSiteClientEvents: makeListSiteClientEvents({ overview: adapters.siteOverview }),
    listSiteAccounts: makeListSiteAccounts({ overview: adapters.siteOverview }),
    listSiteAudit: makeListSiteAudit({ audit: adapters.audit }),
    renameClient: makeRenameClient({
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    setClientCeilings: makeSetClientCeilings({
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * Freezing a client and lifting it (G2-14): `POST /api/site/clients/:clientId/suspend` and
     * `/resume`, behind the operator's gate and a step-up.
     */
    suspendClient: makeSuspendClient({
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    resumeClient: makeResumeClient({
      clients: adapters.clients,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    offboardClient: makeOffboardClient({
      clients: adapters.clients,
      events: adapters.events,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    /**
     * The end of an offboarding (G2-14 part 3). Like `pruneAuditLog`, **not reachable from any
     * route**: `src/main/retentionSweeper.ts` is its one caller, after it purged what was due.
     */
    finalizeOffboardedClients: makeFinalizeOffboardedClients({
      clients: adapters.clients,
      users: adapters.users,
      holdings: adapters.accountHoldings,
      audit: adapters.audit,
      clock: adapters.clock,
    }),
    listClients: makeListClients({ clients: adapters.clients }),
    deleteEmptyClient: makeDeleteEmptyClient({ clients: adapters.clients }),

    // ------------------------------------------------------------------ audit --
    //
    // **The only way a row ever leaves the audit log**, and so deliberately not reachable
    // from any route: `src/main/retentionSweeper.ts` is its one caller. No actor, because
    // nothing about it is a request.
    pruneAuditLog: makePruneAuditLog({
      audit: adapters.audit,
      clock: adapters.clock,
      retentionDays: policy.auditRetentionDays,
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
  }
}

export type UseCases = ReturnType<typeof buildUseCases>
