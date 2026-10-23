import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { invitationLink, invitationMail } from '../../../domain/mail/invitationMail'
import { DomainError } from '../../../domain/shared/errors'
import type { AccountTokenId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import {
  ACCOUNT_TOKEN_LIFETIME_MS,
  ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS,
  INVITATION_MAX_PER_ADDRESS_PER_HOUR,
  INVITATION_WINDOW_MS,
  issueAccountToken,
  type AccountTokenDelivery,
  type InvitationTarget,
} from '../../../domain/users/accountToken'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { SecretTokens } from '../../ports/secretTokens'

/** What an invitation is to, and what to call it in the mail. */
export type InvitedPlace = InvitationTarget & {
  /** The event's name or the client's: content a person typed, printed as it was written. */
  readonly name: string
}

export interface IssueInvitationInput {
  /** What the inviter typed. Parsed here; the reason it is refused reaches the inviter. */
  readonly email: string
  /** The language of the inviter's page, which is the language the mail is written in. */
  readonly locale: ClientLocale
  readonly place: InvitedPlace
  /** Who is inviting, or `null` for the system. Kept on the record, never shown to the invitee. */
  readonly createdBy: UserId | null
}

export type IssuedInvitation = {
  readonly invitationId: AccountTokenId
  readonly expiresAt: Date
} & (
  | { readonly delivery: 'mail' }
  /**
   * The link, to be shown to whoever issued the invitation so they can pass it on. Present
   * **only** when no mail went out, which is a fact about the box and the relay and never
   * about the address.
   */
  | { readonly delivery: 'link'; readonly link: string }
)

export interface IssueInvitationDeps {
  readonly tokens: AccountTokenRepository
  readonly secrets: SecretTokens
  readonly mailer: Mailer
  readonly ids: Pick<IdGenerator, 'accountTokenId'>
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL`, without a trailing slash: the origin the link points at. */
  readonly publicUrl: string
}

export type IssueInvitation = (
  input: IssueInvitationInput,
) => Promise<Result<IssuedInvitation, DomainError>>

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Writes an invitation link to an address and gets it to its owner — **by mail when the box
 * can send mail, and otherwise as a link for the inviter to pass on** (docs/ROADMAP.md
 * §10.3; free plan G2-09, paid plan P3-10).
 *
 * **This use case does not decide who may invite.** It is the mechanism under the callers
 * that do: an event's owner inviting a moderator (`registerModerator`), the operator opening
 * a client (`provisionClientOwner`). Each of them has read the authority it needs from
 * storage before it asks, and none of the rules about it belong here. Nothing HTTP-facing
 * calls this directly.
 *
 * ## What it guarantees
 *
 * - **No account exists afterwards that did not exist before.** Writing an invitation
 *   creates one `account_tokens` row and nothing in `users`: the account is made when the
 *   invitation is accepted (`acceptInvitation`), by the person it is for, with a password
 *   they chose. That is the end of an account that a third party made for an address and
 *   chose the password of.
 * - **The answer has one shape.** It says nothing about whether the address already has an
 *   account — this use case never looks — so a host cannot use the invitation form to learn
 *   who is on the box. The mail is the same for an address that has an account and for one
 *   that has not.
 * - **A link is shown only when no mail went out.** The `delivery` recorded on the token is
 *   the truth about how the link travelled, because it decides what accepting it proves:
 *   a link that came by mail proves its holder controls the mailbox, and a link the inviter
 *   was handed proves nothing of the kind (the inviter could have used it). The mail is sent
 *   first and the record written from its outcome, so a relay that is down becomes a
 *   copyable link instead of an invitation nobody received. `transient` is not "not sent": a
 *   mail that did arrive carries the same link, which the record then calls `link` — the
 *   conservative reading, and the invitee loses nothing by it.
 * - **There is one live link per address and place.** Writing a new invitation to an address
 *   for the same event or client revokes the earlier one first, so the inviter who lost a
 *   link, or sent it to the wrong person, can replace it and know the first opens nothing.
 *   An invitation to a different event is left alone.
 * - **At most {@link INVITATION_MAX_PER_ADDRESS_PER_HOUR} an hour to one address**, from
 *   anybody: a host can write a hundred invitations an hour to a hundred inboxes, and the
 *   per-account limit of the route already slows that; this bounds what any one inbox is sent.
 *   Held under concurrency: writes for one address run one after another (see `queues`).
 *   The cap is global to the address, so one host can spend the five slots and make an
 *   operator's invitation to that address wait an hour; that is accepted, and a cap per
 *   inviter beside it is a later decision, not a hole in this one.
 * - **An invitation to an event has an author.** `createdBy` may be `null` only for a
 *   client, because an event's invitation is honoured only while its author is still an owner.
 *
 * ## What is never logged
 *
 * Not the address, not the token, not the link, not the target's name. A failed mail is
 * logged by its code and nothing else, as `requestPasswordReset` does.
 */
export const makeIssueInvitation = ({
  tokens,
  secrets,
  mailer,
  ids,
  clock,
  logger,
  publicUrl,
}: IssueInvitationDeps): IssueInvitation => {
  /**
   * One invitation at a time per address, in this process.
   *
   * The cap and the "one live link" rule are both **count, then act** around a mail that takes
   * as long as a relay takes: twelve requests for one address that arrive together would each
   * count zero, each send a mail and each save a link — a cap of five that lets twelve through
   * and twelve links that all open. This box is one process over one SQLite file, so a queue
   * keyed by address is exactly as wide as the race is, and it costs a request for an address
   * that is already being written to the wait of the one ahead of it (a relay's own deadline at
   * the worst), and nobody else anything.
   */
  const queues = new Map<string, Promise<void>>()
  const serially = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const ahead = queues.get(key) ?? Promise.resolve()
    const run = ahead.then(task)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    queues.set(key, settled)
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key)
    })
    return run
  }

  return async ({ email, locale, place, createdBy }) => {
    const address = EmailAddress.create(email)
    if (!address.ok) return address

    // An invitation to an event is honoured only while its author is still an owner of it
    // (`makeResolveInvitation`), and one with no author never is. Refused here so the mail that
    // could never be opened is not sent, and a slot of the hourly cap is not spent on it.
    if (place.kind === 'event' && createdBy === null) {
      return err(DomainError.invalid('invitation.inviterRequired'))
    }

    return serially(
      address.value.value,
      async (): Promise<Result<IssuedInvitation, DomainError>> => {
        const now = clock.now()

        await tokens.deleteExpired(
          new Date(now.getTime() - ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS),
        )

        const recent = await tokens.countCreatedSince(
          address.value,
          'invitation',
          new Date(now.getTime() - INVITATION_WINDOW_MS),
        )
        if (recent >= INVITATION_MAX_PER_ADDRESS_PER_HOUR) {
          return err(DomainError.rateLimited('invitation.tooManyForAddress'))
        }

        const minted = secrets.mint()
        const link = invitationLink(publicUrl, minted.token)

        // Built, and so validated, before anything is sent: a mail must never carry a link to a
        // record the rules would have refused. How it travelled is settled below, from the mail's
        // outcome, and written onto this record rather than into a second one.
        const draft = issueAccountToken(
          {
            purpose: 'invitation',
            tokenDigest: minted.digest,
            email: address.value,
            userId: null,
            ...(place.kind === 'event'
              ? { eventId: place.eventId, eventRole: place.role }
              : { clientId: place.clientId, clientRole: place.role }),
            delivery: 'link',
            createdBy,
          },
          ids.accountTokenId(),
          now,
        )
        if (!draft.ok) return draft

        let delivery: AccountTokenDelivery = 'link'
        if (mailer.canDeliver) {
          const sent = await mailer.send(
            invitationMail({
              to: address.value,
              locale,
              link,
              target:
                place.kind === 'event'
                  ? { kind: 'event', name: place.name }
                  : { kind: 'client', name: place.name, role: place.role },
              lifetimeDays: ACCOUNT_TOKEN_LIFETIME_MS.invitation / DAY_MS,
            }),
          )
          if (sent.ok) {
            delivery = 'mail'
          } else {
            logger.warn('an invitation mail was not sent', { code: sent.error.code })
          }
        }

        const record = { ...draft.value, delivery }

        // Revoke before saving, never after: the new link must not be one of the outstanding
        // ones it replaces.
        await tokens.revokeOutstandingInvitations(address.value, place, now)
        await tokens.save(record)

        const base = { invitationId: record.id, expiresAt: record.expiresAt }
        return ok(delivery === 'mail' ? { ...base, delivery } : { ...base, delivery, link })
      },
    )
  }
}
