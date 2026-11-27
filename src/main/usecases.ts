import type { OperatorResetLinks } from '../domain/clients/operatorGuard'
import type { Clock } from '../application/ports/clock'
import type { IdGenerator } from '../application/ports/idGenerator'
import type { Logger } from '../application/ports/logger'
import type { EventBus } from '../application/ports/eventBus'
import type { EventStatsRepository } from '../application/ports/eventStatsRepository'
import type { EventRepository } from '../application/ports/eventRepository'
import type { PhotoRepository } from '../application/ports/photoRepository'
import type { ChannelBindingRepository } from '../application/ports/channelBindingRepository'
import type { ChannelCursorStore } from '../application/ports/channelCursorStore'
import type { ChannelMediaJobRepository } from '../application/ports/channelMediaJobRepository'
import type { ChannelSenderKeyer } from '../application/ports/channelSenderKeyer'
import type { MessagingChannel } from '../application/ports/messagingChannel'
import type { ChannelKind } from '../domain/channels/channelKind'
import type { GuestRepository } from '../application/ports/guestRepository'
import type { ReactionRepository } from '../application/ports/reactionRepository'
import type { MembershipRepository, UserRepository } from '../application/ports/userRepository'
import type { MediaStore } from '../application/ports/mediaStore'
import type { ImageProcessor } from '../application/ports/imageProcessor'
import type { ClipJobRepository } from '../application/ports/clipJobRepository'
import type { AnnouncementRepository } from '../application/ports/announcementRepository'
import type { GuestInviteRepository } from '../application/ports/guestInviteRepository'
import type { PushSubscriptionRepository } from '../application/ports/pushSubscriptionRepository'
import type { PushConfig } from '../application/usecases/push/pushSubscriptions'
import type { GuestHouseholdRepository } from '../application/ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../application/ports/guestRsvpRepository'
import type { ChallengeRepository } from '../application/ports/challengeRepository'
import type { MissionRepository } from '../application/ports/missionRepository'
import type { GuestbookRepository } from '../application/ports/guestbookRepository'
import type { GuestbookVoiceRepository } from '../application/ports/guestbookVoiceRepository'
import type { AudioTranscoder } from '../application/ports/audioTranscoder'
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
import type { StreamHasher } from '../application/ports/streamHasher'
import type { PurgeNoticeLedger } from '../application/ports/purgeNoticeLedger'
import type { EventMailNoticeLedger } from '../application/ports/eventMailNoticeLedger'
import type { MailBudget } from '../application/ports/mailBudget'
import type { MailPreferenceRepository } from '../application/ports/mailPreferenceRepository'
import type { TourLedger } from '../application/ports/tourLedger'
import type { TotpEngine } from '../application/ports/totpEngine'
import type { InvitationAcceptance } from '../application/ports/invitationAcceptance'
import type { SignupRepository } from '../application/ports/signupRepository'
import type { Mailer } from '../application/ports/mailer'
import type { SecretTokens } from '../application/ports/secretTokens'
import type { GallerySigner } from '../application/ports/gallerySigner'
import type { AccountHoldings } from '../application/ports/accountHoldings'
import { type EventCreationPolicy } from '../application/usecases/events/createEvent'
import type { AlbumBookRepository } from '../application/ports/albumBookRepository'
import type { BookFileStore } from '../application/ports/bookFileStore'
import type { AlbumExportRepository } from '../application/ports/albumExportRepository'
import type { ExportFileStore } from '../application/ports/exportFileStore'
import type { ReelRenderer } from '../application/ports/reelRenderer'
import type { ReelRepository } from '../application/ports/reelRepository'
import type { NewClientDefaults } from '../domain/clients/newClientCeilings'
import type { TermsOfUse } from '../domain/legal/termsOfUse'
import type { SignupMode } from '../domain/signups/signupMode'
import type { EmailAddress } from '../domain/users/emailAddress'
import { makePruneAuditLog } from '../application/usecases/audit/pruneAuditLog'
import { authUseCases } from './usecases.auth'
import { eventsUseCases } from './usecases.events'
import { guestsUseCases } from './usecases.guests'
import { photosUseCases } from './usecases.photos'
import { channelsUseCases } from './usecases.channels'
import { clipsUseCases } from './usecases.clips'
import { wallUseCases } from './usecases.wall'
import { galleryUseCases } from './usecases.gallery'
import { clientsUseCases } from './usecases.clients'
import type { DiskSpaceChecker } from '../application/ports/diskSpace'
import { noticeUseCases } from './usecases.notices'
import { signupUseCases } from './usecases.signups'
import { buildSharedHooks } from './usecases.shared'
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
  /** The event's highlight reel (spec 08). */
  readonly reels: ReelRepository
  /** The event's photo book (spec 04): its row, and the PDF file it names. */
  readonly books: AlbumBookRepository
  readonly bookFiles: BookFileStore
  /** The event's verified archive (spec 22): its row, and the ZIP file it names. */
  readonly exports: AlbumExportRepository
  readonly exportFiles: ExportFileStore
  /** The reel's encoder, or the Null Object when this box has no ffmpeg. */
  readonly reelRenderer: ReelRenderer
  readonly guests: GuestRepository
  /** Messaging channels (spec 27): the links from a conversation to an event, their queue, and where the poll stood. */
  readonly channelBindings: ChannelBindingRepository
  readonly channelJobs: ChannelMediaJobRepository
  readonly channelCursors: ChannelCursorStore
  /** The fingerprint of a sender; the one thing a channel stores about a person. */
  readonly channelSenderKeyer: ChannelSenderKeyer
  /** The channels this box has a bot for: empty unless `TELEGRAM_BOT_TOKEN` is set and accepted. */
  readonly messagingChannels: ReadonlyMap<ChannelKind, MessagingChannel>
  readonly reactions: ReactionRepository
  /** The host statistics page: aggregates derived from photos, guests and reactions (spec 05). */
  readonly eventStats: EventStatsRepository
  readonly missions: MissionRepository
  /** Timed photo challenges (spec 10). */
  readonly challenges: ChallengeRepository
  /** Scheduled wall announcements (spec 21). */
  readonly announcements: AnnouncementRepository
  /** The guest invitation of an event (spec 29). */
  readonly guestInvites: GuestInviteRepository
  /** The replies of the guests to the invitation (spec 30). */
  readonly guestRsvps: GuestRsvpRepository
  /** The households of the guest list (spec 30, lot 3). */
  readonly guestHouseholds: GuestHouseholdRepository
  readonly pushSubscriptions: PushSubscriptionRepository
  readonly guestbook: GuestbookRepository
  /** The recordings behind the guestbook's voice messages, and their queue (spec 25). */
  readonly voices: GuestbookVoiceRepository
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  /** The real encoder, or the Null Object when this box has none. */
  readonly videoTranscoder: VideoTranscoder
  /** The audio encoder, or the Null Object when this box has none (spec 25). */
  readonly audioTranscoder: AudioTranscoder
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
  /** The console's guided tours each account was shown (`user_tours`). */
  readonly tours: TourLedger
  /** SHA-256 of a file as it streams (the host's album manifest). */
  readonly streamHasher: StreamHasher
  /** Which deletion warning an event's owners were last sent (spec 22). */
  readonly purgeNotices: PurgeNoticeLedger
  /** Which notices were already served for an event (spec 32). */
  readonly eventMailNotices: EventMailNoticeLedger
  /** How many mails the box sent today, against `MAIL_FOLLOWUP_MAX_PER_DAY` (spec 32). */
  readonly mailBudget: MailBudget
  /** What each account chose to receive by mail, and an owner's digest state (spec 32). */
  readonly mailPreferences: MailPreferenceRepository
  /** RFC 6238's one primitive. */
  readonly totpEngine: TotpEngine
  /** Encryption of a secret at rest; `null` on a box with no `MFA_ENCRYPTION_KEY`. */
  readonly mfaVault: MfaVault | null
  /** How many second-factor guesses each half-finished sign-in has spent. In memory, one per box. */
  readonly signInAttempts: SignInAttempts
  /** Spending an invitation: the link, the account and the grant in one transaction. */
  readonly invitationAcceptance: InvitationAcceptance
  /** The signup requests and their confirmation tokens (spec 31). */
  readonly signups: SignupRepository
  /** The free-space probe the signup disk guard of mode `open` reads. */
  readonly diskSpace: DiskSpaceChecker
}

/** The policy values a use case needs, drawn from validated configuration. */
export interface UseCasePolicy {
  /** `OPERATOR_RESET_LINKS`: whether an operator's reset may ever be handed to them as a link (G2-12 / P3-14). */
  readonly operatorResetLinks: OperatorResetLinks
  /** `PUBLIC_URL`, without a trailing slash: the origin a mailed link points at. */
  readonly publicUrl: string
  /**
   * Browser notifications for the host (spec 30, lot 4): the public key a browser subscribes with and the push
   * services the box may call, or `null` while `VAPID_*` are not set (the feature is off). **Never the private key.**
   */
  readonly push: PushConfig | null
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
  /** `HOST_MAIL_NOTICES` is not `off` (spec 32): half of what `available` in an account's mail page says. */
  readonly hostMailNotices: boolean
  /** Self-service signup (spec 31): `SIGNUP*` and what the disk guard of mode `open` reads. */
  readonly signup: {
    readonly mode: SignupMode
    readonly maxPerDay: number
    /** `SIGNUP_NOTIFY_EMAIL`, or `null`. */
    readonly notifyEmail: string | null
    readonly minFreeDiskBytes: number
    /** The directories whose free space bounds the box: the database's and the media root. */
    readonly diskPaths: readonly string[]
    /** What the welcome mail names (`null` when the operator's contact or support page is not set: no mail). */
    readonly welcome: { readonly contact: EmailAddress; readonly guidesLink: string } | null
  }
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
   * `operator.contactEmail`: the `Reply-To` of the mail that tells a refused signup it was refused (spec 31),
   * or `null` on a box that names no contact.
   */
  readonly operatorContactEmail: string | null
  /**
   * `termsOfUse`: the terms an invitation's acceptance asks the person to agree to, or `null`
   * on a box that asks for none, which is every self-hosted box (`LEGAL_TERMS_URL` with
   * `LEGAL_TERMS_VERSION`, G2-20). Required here and not optional, so a composition that forgets
   * it does not fail open: the test that boots the real container holds it to the config.
   */
  readonly termsOfUse: TermsOfUse | null
  /** `BOOK_ENABLED` and `BOOK_MAX_PER_EVENT_PER_DAY` (spec 04). */
  readonly book: {
    readonly enabled: boolean
    readonly maxPerEventPerDay: number
    readonly printEnabled: boolean
    /** `BOOK_MAX_PHOTOS`: the most photographs a book holds, which the form tells the host. */
    readonly maxPhotos: number
    /** `BOOK_MAX_MESSAGES`: the most guest-book messages one book prints, which the form tells the host. */
    readonly maxMessages: number
  }
  /**
   * `EXPORT_*` (spec 22): the box's switch and ceilings for the verified archive, and the free-space
   * probe the request judges the disk with (`null` when it cannot be read: a refusal).
   */
  readonly export: {
    readonly enabled: boolean
    readonly maxBytes: number
    readonly maxTotalBytes: number
    readonly maxPerEventPerDay: number
    readonly ttlDays: number
    readonly minFreeDiskBytes: number
    readonly freeDiskBytes: () => Promise<number | null>
  }
  /** `REEL_*` and `MAX_QUEUED_REELS` (spec 08). */
  readonly reel: {
    readonly enabled: boolean
    readonly maxPhotos: number
    readonly secondsPerPhoto: number
    readonly maxOutputBytes: number
    readonly maxQueued: number
  }
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
  /** Voice messages of the guestbook (spec 25): what the worker judges a recording against. */
  readonly voice: {
    /** The longest message (`MAX_VOICE_SECONDS`). */
    readonly maxDurationMs: number
    /** What the encoder may write for it, from `voiceOutputCeilingBytes`. */
    readonly maxOutputBytes: number
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
export const buildUseCases = (adapters: Adapters, policy: UseCasePolicy) => {
  const hooks = buildSharedHooks(adapters, policy)

  return {
    ...authUseCases(adapters, policy, hooks),
    ...eventsUseCases(adapters, policy, hooks),
    ...guestsUseCases(adapters, policy, hooks),
    ...photosUseCases(adapters, policy, hooks),
    ...clipsUseCases(adapters, policy, hooks),
    ...channelsUseCases(adapters),
    ...wallUseCases(adapters, policy, hooks),
    ...galleryUseCases(adapters, hooks),
    ...clientsUseCases(adapters, policy, hooks),
    ...signupUseCases(adapters, policy, hooks),
    ...noticeUseCases(adapters, policy),
    /** The account notices (spec 32, A1), for the composition's own tests to wait on: no route reaches it. */
    accountNotice: hooks.accountNotice,
    /** The job and invitation notices (spec 32, A2, A6): the workers are given `jobNotice.notify`; tests wait on `idle`. */
    jobNotice: hooks.jobNotice,
    invitationNotice: hooks.invitationNotice,
    //
    // **The only way a row ever leaves the audit log**, and so deliberately not reachable
    // from any route: `src/main/retentionSweeper.ts` is its one caller. No actor, because
    // nothing about it is a request.
    pruneAuditLog: makePruneAuditLog({
      audit: adapters.audit,
      clock: adapters.clock,
      retentionDays: policy.auditRetentionDays,
    }),
  }
}

export type UseCases = ReturnType<typeof buildUseCases>
