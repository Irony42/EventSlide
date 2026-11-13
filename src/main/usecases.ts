import type { OperatorResetLinks } from '../domain/clients/operatorGuard'
import type { Clock } from '../application/ports/clock'
import type { IdGenerator } from '../application/ports/idGenerator'
import type { Logger } from '../application/ports/logger'
import type { EventBus } from '../application/ports/eventBus'
import type { EventStatsRepository } from '../application/ports/eventStatsRepository'
import type { EventRepository } from '../application/ports/eventRepository'
import type { PhotoRepository } from '../application/ports/photoRepository'
import type { GuestRepository } from '../application/ports/guestRepository'
import type { ReactionRepository } from '../application/ports/reactionRepository'
import type { MembershipRepository, UserRepository } from '../application/ports/userRepository'
import type { MediaStore } from '../application/ports/mediaStore'
import type { ImageProcessor } from '../application/ports/imageProcessor'
import type { ClipJobRepository } from '../application/ports/clipJobRepository'
import type { ChallengeRepository } from '../application/ports/challengeRepository'
import type { MissionRepository } from '../application/ports/missionRepository'
import type { GuestbookRepository } from '../application/ports/guestbookRepository'
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
import type { TourLedger } from '../application/ports/tourLedger'
import type { TotpEngine } from '../application/ports/totpEngine'
import type { InvitationAcceptance } from '../application/ports/invitationAcceptance'
import type { Mailer } from '../application/ports/mailer'
import type { SecretTokens } from '../application/ports/secretTokens'
import type { GallerySigner } from '../application/ports/gallerySigner'
import type { AccountHoldings } from '../application/ports/accountHoldings'
import { type EventCreationPolicy } from '../application/usecases/events/createEvent'
import type { AlbumBookRepository } from '../application/ports/albumBookRepository'
import type { BookFileStore } from '../application/ports/bookFileStore'
import type { ReelRenderer } from '../application/ports/reelRenderer'
import type { ReelRepository } from '../application/ports/reelRepository'
import type { NewClientDefaults } from '../domain/clients/newClientCeilings'
import type { TermsOfUse } from '../domain/legal/termsOfUse'
import { makePruneAuditLog } from '../application/usecases/audit/pruneAuditLog'
import { authUseCases } from './usecases.auth'
import { eventsUseCases } from './usecases.events'
import { guestsUseCases } from './usecases.guests'
import { photosUseCases } from './usecases.photos'
import { clipsUseCases } from './usecases.clips'
import { wallUseCases } from './usecases.wall'
import { galleryUseCases } from './usecases.gallery'
import { clientsUseCases } from './usecases.clients'
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
  /** The reel's encoder, or the Null Object when this box has no ffmpeg. */
  readonly reelRenderer: ReelRenderer
  readonly guests: GuestRepository
  readonly reactions: ReactionRepository
  /** The host statistics page: aggregates derived from photos, guests and reactions (spec 05). */
  readonly eventStats: EventStatsRepository
  readonly missions: MissionRepository
  /** Timed photo challenges (spec 10). */
  readonly challenges: ChallengeRepository
  readonly guestbook: GuestbookRepository
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
  /** The console's guided tours each account was shown (`user_tours`). */
  readonly tours: TourLedger
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
  /** `BOOK_ENABLED` and `BOOK_MAX_PER_EVENT_PER_DAY` (spec 04). */
  readonly book: { readonly enabled: boolean; readonly maxPerEventPerDay: number }
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
    ...eventsUseCases(adapters, policy),
    ...guestsUseCases(adapters, policy, hooks),
    ...photosUseCases(adapters, policy, hooks),
    ...clipsUseCases(adapters, policy),
    ...wallUseCases(adapters, policy, hooks),
    ...galleryUseCases(adapters, hooks),
    ...clientsUseCases(adapters, policy, hooks),
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
