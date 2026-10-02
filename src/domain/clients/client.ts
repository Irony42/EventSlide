import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { ClientId } from '../shared/ids'
import { EmailAddress } from '../users/emailAddress'
import { ClientCeilings } from './clientCeilings'
import { ClientName } from './clientName'
import { DEFAULT_CLIENT_LOCALE, isClientLocale, type ClientLocale } from './clientLocale'

/**
 * A client of the box: a name, a contact, zero or more events, and a lifecycle of its
 * own (roadmap §10.2). An event already has an `ownerId`; what did not exist before this
 * is the record that several events, and the ceilings over them, belong to.
 *
 * **The full D-05 catalogue lands with this one migration, because migrations are
 * append-only and the paid plan reuses it.** `suspendedAt`, `purgeAfter` and
 * `retentionCapSince` are therefore carried on every instance from the first row, even
 * though nothing in this pull request suspends or offboards a client — those are roadmap
 * §10.7 (handover) and §10.6/§10.8's own items, behind the operator console (§10.4) that
 * does not exist yet. A field with no mutator here is not dead: it round-trips through
 * the repository so a later item can write it without a second migration.
 */

export interface ClientProps {
  readonly id: ClientId
  readonly name: ClientName
  readonly contactEmail: EmailAddress | null
  readonly createdAt: Date
  readonly suspendedAt: Date | null
  readonly purgeAfter: Date | null
  readonly retentionCapSince: Date | null
  readonly ceilings: ClientCeilings
  /** Never decreases when an event is deleted — see `ClientCeilings.allowsAnotherEvent`. */
  readonly eventsCreatedInPeriod: number
  readonly locale: ClientLocale
}

export interface NewClient {
  readonly name: string
  /** Absent or `null` both mean "no contact on file yet". */
  readonly contactEmail?: string | null
  readonly ceilings?: ClientCeilings
  /** A raw tag, validated here: absent means {@link DEFAULT_CLIENT_LOCALE}. */
  readonly locale?: string
}

/** Both `null`, or the same instant — never two different instants compared loosely. */
const sameInstant = (left: Date | null, right: Date | null): boolean =>
  (left?.getTime() ?? null) === (right?.getTime() ?? null)

const parseContactEmail = (
  raw: string | null | undefined,
): Result<EmailAddress | null, DomainError> => {
  if (raw === null || raw === undefined) return ok(null)
  return EmailAddress.create(raw)
}

export class Client {
  private constructor(private readonly props: ClientProps) {}

  static create(input: NewClient, id: ClientId, now: Date): Result<Client, DomainError> {
    const name = ClientName.create(input.name)
    if (!name.ok) return name

    const contactEmail = parseContactEmail(input.contactEmail)
    if (!contactEmail.ok) return contactEmail

    if (input.locale !== undefined && !isClientLocale(input.locale)) {
      return err(DomainError.invalid('client.localeInvalid'))
    }

    return ok(
      new Client({
        id,
        name: name.value,
        contactEmail: contactEmail.value,
        createdAt: now,
        suspendedAt: null,
        purgeAfter: null,
        retentionCapSince: null,
        ceilings: input.ceilings ?? ClientCeilings.unlimited(),
        eventsCreatedInPeriod: 0,
        locale: input.locale ?? DEFAULT_CLIENT_LOCALE,
      }),
    )
  }

  /** Rehydrate from storage. The row already satisfied every `CHECK` on the way in. */
  static restore(props: ClientProps): Client {
    return new Client(props)
  }

  get id(): ClientId {
    return this.props.id
  }

  get name(): ClientName {
    return this.props.name
  }

  get contactEmail(): EmailAddress | null {
    return this.props.contactEmail
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get suspendedAt(): Date | null {
    return this.props.suspendedAt
  }

  get purgeAfter(): Date | null {
    return this.props.purgeAfter
  }

  get retentionCapSince(): Date | null {
    return this.props.retentionCapSince
  }

  get ceilings(): ClientCeilings {
    return this.props.ceilings
  }

  get eventsCreatedInPeriod(): number {
    return this.props.eventsCreatedInPeriod
  }

  get locale(): ClientLocale {
    return this.props.locale
  }

  // -------------------------------------------------------------------- editing --

  rename(name: string): Result<Client, DomainError> {
    const parsed = ClientName.create(name)
    if (!parsed.ok) return parsed
    return ok(this.with({ name: parsed.value }))
  }

  setContactEmail(email: string | null): Result<Client, DomainError> {
    const parsed = parseContactEmail(email)
    if (!parsed.ok) return parsed
    return ok(this.with({ contactEmail: parsed.value }))
  }

  /**
   * Replace the ceilings, resetting the per-period counter exactly when `periodStartedAt`
   * itself changes — a renewal — and never on an ordinary edit of some other ceiling.
   *
   * The audit entry `client.periodReset {before, after}` the paid plan's design calls for
   * belongs to the use case, once `AuditLog` exists (roadmap §10.8 / G2-06): this method
   * only carries the counter reset itself, which the schema needs regardless of whether
   * anything is there yet to read the audit trail.
   */
  withCeilings(ceilings: ClientCeilings): Client {
    const periodChanged = !sameInstant(
      this.props.ceilings.periodStartedAt,
      ceilings.periodStartedAt,
    )
    return this.with({
      ceilings,
      eventsCreatedInPeriod: periodChanged ? 0 : this.props.eventsCreatedInPeriod,
    })
  }

  // ------------------------------------------------------------------ lifecycle --

  /** Idempotent, like `Guest.revoke`: the first suspension wins the timestamp. */
  suspend(at: Date): Client {
    if (this.props.suspendedAt !== null) return this
    return this.with({ suspendedAt: at })
  }

  reinstate(): Client {
    if (this.props.suspendedAt === null) return this
    return this.with({ suspendedAt: null })
  }

  isSuspended(): boolean {
    return this.props.suspendedAt !== null
  }

  // -------------------------------------------------------------------- helpers --

  equals(other: Client): boolean {
    return this.props.id === other.props.id
  }

  toProps(): ClientProps {
    return this.props
  }

  private with(changes: Partial<ClientProps>): Client {
    return new Client({ ...this.props, ...changes })
  }
}
