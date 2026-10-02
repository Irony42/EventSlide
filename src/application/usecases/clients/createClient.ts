import { Client } from '../../../domain/clients/client'
import { ClientCeilings, type ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import type { DomainError } from '../../../domain/shared/errors'
import { ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'

/**
 * Creates a client record (roadmap §10.2): a name, an optional contact, and the ceilings
 * the operator wants it to start with.
 *
 * **No actor, and that is deliberate.** Creating a client is an operator's act on the
 * box, not an act inside any one event, so there is no membership for this use case to
 * read; the gate is `requireOperator` at the HTTP layer (G2-14, behind `SITE_ADMIN`),
 * exactly as for every other operator route. A client is created **with no member**: its
 * owner arrives by invitation (G2-09), never by being typed in here.
 *
 * Every ceiling defaults to "none", which is also what a solo installation's one
 * implicit client has.
 */

export interface CreateClientInput {
  readonly name: string
  readonly contactEmail?: string | null
  /** A raw tag, validated by the domain: absent means the catalogue default. */
  readonly locale?: string
  /** What the operator wants limited; every omitted bound is unlimited. */
  readonly ceilings?: ClientCeilingsInput
}

export interface CreateClientDeps {
  readonly clients: ClientRepository
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type CreateClient = (input: CreateClientInput) => Promise<Result<Client, DomainError>>

export const makeCreateClient =
  ({ clients, ids, clock }: CreateClientDeps): CreateClient =>
  async (input) => {
    const ceilings = ClientCeilings.create(input.ceilings)
    if (!ceilings.ok) return ceilings

    const created = Client.create(
      {
        name: input.name,
        ceilings: ceilings.value,
        // `exactOptionalPropertyTypes`: an absent key and an explicit `undefined` are
        // different things to say, so each is spread only when it was given.
        ...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      },
      ids.clientId(),
      clock.now(),
    )
    if (!created.ok) return created

    await clients.save(created.value)
    return ok(created.value)
  }
