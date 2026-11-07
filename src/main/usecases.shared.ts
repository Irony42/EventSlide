import { makeDeleteAccount } from '../application/usecases/site/deleteAccount'
import { makeIssueInvitation } from '../application/usecases/auth/issueInvitation'
import { makeVerifySecondFactor } from '../application/usecases/auth/verifySecondFactor'
import { makeRecordEngagement } from '../application/usecases/stats/recordEngagement'
import { makeInvalidateReel } from '../application/usecases/highlights/invalidateReel'
import { makeInvalidateAlbumBook } from '../application/usecases/book/invalidateAlbumBook'
import { makeCreateClient } from '../application/usecases/clients/createClient'
import type { Adapters, UseCasePolicy } from './usecases'

/** The ports every gallery use case's access rule reads. */
export const galleryAccess = (adapters: Adapters) => ({
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
export const verifySecondFactorFrom = (adapters: Adapters) =>
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
export const invitationReaders = (adapters: Adapters) => ({
  tokens: adapters.accountTokens,
  secrets: adapters.secretTokens,
  events: adapters.events,
  clients: adapters.clients,
  memberships: adapters.memberships,
  users: adapters.users,
})

export const invitationIssuer = (adapters: Adapters, policy: UseCasePolicy) =>
  makeIssueInvitation({
    tokens: adapters.accountTokens,
    secrets: adapters.secretTokens,
    mailer: adapters.mailer,
    ids: adapters.ids,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
  })

/** The one erasure of an account, shared by the operator's route and the person's own. */
export const accountDeleter = (adapters: Adapters) =>
  makeDeleteAccount({
    users: adapters.users,
    clients: adapters.clients,
    holdings: adapters.accountHoldings,
    audit: adapters.audit,
    clock: adapters.clock,
  })

export const clientCreator = (adapters: Adapters) =>
  makeCreateClient({
    clients: adapters.clients,
    ids: adapters.ids,
    clock: adapters.clock,
  })

export interface SharedHooks {
  readonly issueInvitation: ReturnType<typeof invitationIssuer>
  readonly invalidateReel: ReturnType<typeof makeInvalidateReel>
  readonly invalidateBook: ReturnType<typeof makeInvalidateAlbumBook>
  readonly engagement: ReturnType<typeof makeRecordEngagement>
}

/**
 * The four collaborators more than one slice shares, built once per box.
 *
 * **One issuer for the whole box.** The per-address queue that keeps the cap and the one-live-link
 * rule true under concurrency lives inside it, so two instances would be two queues, and a host
 * inviting an address at the moment the operator opens a client for it would race past both.
 *
 * **One hook for every way a photograph leaves the evening** (spec 08): the five use cases that
 * remove or un-publish one call it first, so a highlight reel never shows what was taken out.
 * `reelInvalidation.guard.test.ts` fails the build when a new path forgets it.
 *
 * **The same for the photo book** (spec 04): awaited by the use cases that remove or un-publish a
 * photo or change a caption, before the bytes go. `bookInvalidation.guard.test.ts` fails the build
 * when a new path forgets it.
 *
 * And the after-party counters (spec 05): one writer, shared by the two gallery use cases.
 */
export const buildSharedHooks = (adapters: Adapters, policy: UseCasePolicy): SharedHooks => ({
  issueInvitation: invitationIssuer(adapters, policy),
  invalidateReel: makeInvalidateReel({
    reels: adapters.reels,
    media: adapters.media,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
  invalidateBook: makeInvalidateAlbumBook({
    books: adapters.books,
    bookFiles: adapters.bookFiles,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
  engagement: makeRecordEngagement({
    stats: adapters.eventStats,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
})
