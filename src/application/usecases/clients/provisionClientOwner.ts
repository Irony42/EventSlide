import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { describeClientCreation } from '../../../domain/audit/clientCeilingsAudit'
import type { Client } from '../../../domain/clients/client'
import type { ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { startingCeilings, type NewClientDefaults } from '../../../domain/clients/newClientCeilings'
import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { IssueInvitation, IssuedInvitation } from '../auth/issueInvitation'
import type { CreateClient } from './createClient'

export interface ProvisionClientOwnerInput {
  readonly clientName: string
  /** Where the owner's invitation goes. Also the client's contact until it says otherwise. */
  readonly ownerEmail: string
  /**
   * The language of the client's mail and the one it is recorded with (`clients.locale`):
   * the invitation is the first message it is sent, and every later one follows it.
   */
  readonly locale: ClientLocale
  /**
   * What the operator wants limited. A ceiling it names is kept, `null` included (which lifts
   * the box's default for this client); one it leaves out takes the box's `NEW_CLIENT_*`
   * default, which is "none" on a box that set no default.
   */
  readonly ceilings?: ClientCeilingsInput
  /** The operator who is provisioning, or `null` for the system. Kept on the invitation. */
  readonly createdBy: UserId | null
}

export interface ProvisionedClientOwner {
  readonly clientId: ClientId
  readonly invitation: IssuedInvitation
}

export interface ProvisionClientOwnerDeps {
  readonly createClient: CreateClient
  readonly issueInvitation: IssueInvitation
  /** Only the compensation: an empty client is removed if its invitation could not be written. */
  readonly clients: Pick<ClientRepository, 'deleteIfEmpty'>
  /**
   * The ceilings a new client starts with when the operator names none (`NEW_CLIENT_*`, G2-18),
   * read from configuration once at boot. Unlimited on a box that set none, which is every
   * self-hosted box, so those provision exactly as they did before the variables existed.
   */
  readonly newClientDefaults: NewClientDefaults
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  /** When the client is opened: the entry's instant, and the start of a period the defaults set. */
  readonly clock: Clock
}

export type ProvisionClientOwner = (
  input: ProvisionClientOwnerInput,
) => Promise<Result<ProvisionedClientOwner, DomainError>>

/** The operator who is provisioning, or the system when nobody is: never a label for a person. */
const actorOf = (createdBy: UserId | null): AuditActorInput =>
  createdBy === null
    ? { kind: 'system', label: 'provision-client-owner' }
    : { kind: 'operator', userId: createdBy }

/**
 * Opens a client's account and invites its owner (docs/ROADMAP.md §10.2 and §10.3; free plan
 * G2-09, paid plan P3-10): the operator's way of creating a customer.
 *
 * **The owner arrives by invitation and by nothing else.** The client is created with no
 * member and no event, and its owner's address receives a single-use, week-long link; no
 * `users` row is written for that address until the link is accepted. So the operator never
 * types a password, never reads one aloud, and cannot become the owner of a client by
 * provisioning it — they hold at most the link, and accepting it is the invitee's act.
 *
 * **Who may call it is decided at the HTTP layer** (`requireOperator`, behind `SITE_ADMIN`,
 * G2-14), exactly as for `createClient`. The operator guard's rules about *which* invitations
 * the operator may issue and which link they may be shown (G2-12) are about invitations to a
 * client that already has events; a client created a moment ago has none, which is the case
 * the plan's first rule leaves open.
 *
 * **Order.** The address is parsed before anything is written, so an address that is not one
 * creates no client. The client is created, then the invitation; if the invitation cannot be
 * written (the address is over its hourly cap, or storage failed) the client is removed
 * again, since a client with no member and no event is exactly what `deleteIfEmpty` exists
 * to remove, and an operator who retries should not find the first attempt's husk. A failure
 * of that removal is not reported over the failure that caused it.
 *
 * **The ceilings are the operator's, completed by the box's** (G2-18). A ceiling the operator
 * names is kept (`null` lifts the default for this client); every other takes its
 * `NEW_CLIENT_*` default, and a default per-period count starts its period now. That is
 * `startingCeilings`, a pure rule; what this use case adds is that the result is **written
 * down**: `client.created` carries the whole snapshot the client starts with, because the
 * defaults are configuration and change at the next boot while "what was this client promised
 * on the day it was opened" must still have an answer.
 *
 * **The entry is written before the invitation, and the client is removed if it cannot be.**
 * Write-ahead, as in `setClientCeilings`: a client cannot be opened with a ceiling nobody can
 * read back. It cannot come after, because by then a mail may have gone. The actor is
 * `createdBy`, an operator, or the system when there is none. If the invitation then fails
 * the client is removed again and its entry stays, a line for an intent that failed: the log
 * never holds a foreign key to a client, so history outlives it, and the lesser error is the
 * one that is visible.
 *
 * **Not here yet.** The `invitation.issued` entry arrives with the operator API that calls
 * this (G2-14), which is also where the console's own audit of an approval lives.
 */
export const makeProvisionClientOwner =
  ({
    createClient,
    issueInvitation,
    clients,
    newClientDefaults,
    audit,
    clock,
  }: ProvisionClientOwnerDeps): ProvisionClientOwner =>
  async ({ clientName, ownerEmail, locale, ceilings, createdBy }) => {
    const address = EmailAddress.create(ownerEmail)
    if (!address.ok) return address

    const at = clock.now()
    const created = await createClient({
      name: clientName,
      contactEmail: address.value.value,
      locale,
      ceilings: startingCeilings(newClientDefaults, ceilings, at),
    })
    if (!created.ok) return created
    const client: Client = created.value

    // A client with no member and no event is exactly what `deleteIfEmpty` removes. Removing it
    // must never replace the failure that made it necessary, so its own failure is dropped.
    const discard = async (): Promise<void> => {
      try {
        await clients.deleteIfEmpty(client.id)
      } catch {
        // The error being reported is the one that mattered.
      }
    }

    // What the client starts with is written before anything is sent. A failure here, a refusal
    // of the entry or a log that cannot be written, leaves nothing the operator could not retry:
    // the client is removed, and no invitation has gone.
    const planned = describeClientCreation(client)
    const entry = AuditEntry.create({
      at,
      actor: actorOf(createdBy),
      action: planned.action,
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: planned.details,
    })
    if (!entry.ok) {
      await discard()
      return entry
    }
    try {
      await audit.record(entry.value)
    } catch (error) {
      await discard()
      throw error
    }

    let invitation: Result<IssuedInvitation, DomainError>
    try {
      invitation = await issueInvitation({
        email: address.value.value,
        locale: client.locale,
        place: { kind: 'client', clientId: client.id, role: 'owner', name: client.name.value },
        createdBy,
      })
    } catch (error) {
      await discard()
      throw error
    }
    if (!invitation.ok) {
      await discard()
      return invitation
    }

    return ok({ clientId: client.id, invitation: invitation.value })
  }
