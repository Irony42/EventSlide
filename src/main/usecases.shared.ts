import { makeDeleteAccount } from '../application/usecases/site/deleteAccount'
import {
  makeAccountNotice,
  type AccountNotice,
} from '../application/usecases/notices/accountNotice'
import {
  makeNotifyJobDone,
  type NotifyJobDone,
} from '../application/usecases/notices/notifyJobDone'
import {
  makeNotifyInvitationAccepted,
  type NotifyInvitationAccepted,
} from '../application/usecases/notices/notifyInvitationAccepted'
import {
  makeNotifyTakedown,
  type NotifyTakedown,
} from '../application/usecases/notices/notifyTakedown'
import { EmailAddress } from '../domain/users/emailAddress'
import { makeIssueInvitation } from '../application/usecases/auth/issueInvitation'
import { makeVerifySecondFactor } from '../application/usecases/auth/verifySecondFactor'
import { makeRecordEngagement } from '../application/usecases/stats/recordEngagement'
import { makeInvalidateReel } from '../application/usecases/highlights/invalidateReel'
import { makeInvalidateAlbumBook } from '../application/usecases/book/invalidateAlbumBook'
import { makeInvalidateAlbumExport } from '../application/usecases/exports/invalidateAlbumExport'
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
export const accountDeleter = (adapters: Adapters, notice: AccountNotice) =>
  makeDeleteAccount({
    notice,
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
  readonly invalidateExport: ReturnType<typeof makeInvalidateAlbumExport>
  readonly engagement: ReturnType<typeof makeRecordEngagement>
  /** The mails that tell a holder what was done to the account (spec 32, A1), one for the whole box. */
  readonly accountNotice: AccountNotice
  /** The mail that tells a host a long job is over (spec 32, A2): the three builders are given its `notify`. */
  readonly jobNotice: NotifyJobDone
  /** The mail that tells a host an invitation was accepted (spec 32, A6). */
  readonly invitationNotice: NotifyInvitationAccepted
  /** The mail that tells a host what the operator did (spec 32, A4): the operator's use cases are given its `notify`. */
  readonly takedownNotice: NotifyTakedown
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
 * **And for the verified archive the box keeps** (spec 22): awaited, before the bytes go, by every path that
 * takes a photograph, a clip or a message out of the evening, and by a reopening. A guest who erased
 * themselves must not survive in a copy the box holds. `exportInvalidation.guard.test.ts` fails the
 * build when a new path forgets it.
 *
 * And the after-party counters (spec 05): one writer, shared by the two gallery use cases.
 */
export const buildSharedHooks = (adapters: Adapters, policy: UseCasePolicy): SharedHooks => ({
  issueInvitation: invitationIssuer(adapters, policy),
  accountNotice: makeAccountNotice({
    users: adapters.users,
    clients: adapters.clients,
    mailer: adapters.mailer,
    budget: adapters.mailBudget,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
    operatorContact: contactAddress(policy.operatorContactEmail),
  }),
  jobNotice: makeNotifyJobDone({
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    notices: adapters.eventMailNotices,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
    hostMailNotices: policy.hostMailNotices,
  }),
  invitationNotice: makeNotifyInvitationAccepted({
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
    hostMailNotices: policy.hostMailNotices,
  }),
  takedownNotice: makeNotifyTakedown({
    events: adapters.events,
    clients: adapters.clients,
    users: adapters.users,
    memberships: adapters.memberships,
    budget: adapters.mailBudget,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    operatorContact: contactAddress(policy.operatorContactEmail),
  }),
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
  invalidateExport: makeInvalidateAlbumExport({
    exports: adapters.exports,
    exportFiles: adapters.exportFiles,
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

/** The configured contact as an address, or `null` (configuration already refused a malformed one). */
export const contactAddress = (value: string | null): EmailAddress | null => {
  if (value === null) return null
  const parsed = EmailAddress.create(value)
  return parsed.ok ? parsed.value : null
}
