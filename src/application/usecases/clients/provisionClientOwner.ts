import type { Client } from '../../../domain/clients/client'
import type { ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import type { ClientLocale } from '../../../domain/clients/clientLocale'
import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
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
  /** What the operator wants limited; every omitted bound is unlimited. */
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
}

export type ProvisionClientOwner = (
  input: ProvisionClientOwnerInput,
) => Promise<Result<ProvisionedClientOwner, DomainError>>

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
 * **Not here yet.** The audit entries for `client.created` and `invitation.issued` arrive with
 * the operator API that calls this (G2-14), which is also where the actor they name exists;
 * the default ceilings of a new client (`NEW_CLIENT_*`, G2-18) are applied by the same route.
 */
export const makeProvisionClientOwner =
  ({ createClient, issueInvitation, clients }: ProvisionClientOwnerDeps): ProvisionClientOwner =>
  async ({ clientName, ownerEmail, locale, ceilings, createdBy }) => {
    const address = EmailAddress.create(ownerEmail)
    if (!address.ok) return address

    const created = await createClient({
      name: clientName,
      contactEmail: address.value.value,
      locale,
      ...(ceilings === undefined ? {} : { ceilings }),
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
