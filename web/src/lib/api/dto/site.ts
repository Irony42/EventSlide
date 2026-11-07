// The client space and the operator console.

/** A client's nine ceilings, as it reads them. `null` is "no ceiling". */
export interface CeilingsDto {
  readonly maxEvents: number | null
  readonly maxTotalBytes: number | null
  readonly maxEventQuotaBytes: number | null
  readonly maxRetentionDays: number | null
  readonly clipsAllowed: boolean
  readonly booksAllowed: boolean
  readonly liveAllowed: boolean
  readonly maxLiveDays: number | null
  readonly maxEventsPerPeriod: number | null
  readonly periodStartedAt: string | null
}
/** `warning` from 90 per cent and `reached` at 100: the server decides, the screen shows it. */
export type CeilingLevelDto = 'ok' | 'warning' | 'reached'
export interface CeilingMeterDto {
  readonly kind: 'events' | 'eventsPerPeriod' | 'storage'
  readonly used: number
  readonly max: number
  readonly level: CeilingLevelDto
}
/** What a client has used against its ceilings. */
export interface ClientUsageDto {
  readonly events: number
  readonly eventsCreatedInPeriod: number
  /** The figure the byte ceiling is judged against, clips still queued included. */
  readonly usedBytes: number
}
export interface ClientLimitsDto {
  readonly id: string
  readonly name: string
  readonly role: 'owner' | 'member'
  readonly suspended: boolean
  readonly ceilings: CeilingsDto
  readonly usage: ClientUsageDto
  readonly meters: readonly CeilingMeterDto[]
}
/** `GET /api/me/limits`. */
export interface MyLimitsDto {
  readonly clients: readonly ClientLimitsDto[]
}
export interface ClientAuditEntryDto {
  readonly seq: number
  readonly at: string
  readonly action: string
  readonly actor: {
    readonly kind: 'operator' | 'member' | 'system' | 'integration'
    readonly label: string | null
  }
  readonly subject: { readonly type: string; readonly id?: string }
  readonly details: Readonly<Record<string, unknown>>
}
export interface ClientAuditPageDto {
  readonly items: readonly ClientAuditEntryDto[]
  readonly next: number | null
}
export interface PendingInvitationDto {
  readonly id: string
  readonly email: string
  readonly role: 'owner' | 'member'
  readonly createdAt: string
  readonly expiresAt: string
}
export interface PendingInvitationsDto {
  readonly items: readonly PendingInvitationDto[]
}
//
// What `/api/site/*` answers (docs/API.md §1, G2-14 / P3-13; the console is G2-15 / P3-16). Every
// shape here is a shape, a size or a count, and **none carries what a client or a guest made**: no
// event name, slug or join code, no photograph, caption or guest, no display name, no contact
// address, no hash or token. A field added here that could carry one is a defect the server's
// contract sweep (`siteRoutes.contentFree.test.ts`) would already have refused on the wire.

/** One client as the operator reads it: its name, its ceilings and what it uses. */
export interface SiteClientDto {
  readonly id: string
  /** One of the two free texts the console prints: the name the operator gave the client. */
  readonly name: string
  readonly createdAt: string
  readonly suspendedAt: string | null
  /** Set by offboarding: the day the retention sweep purges this client's albums. */
  readonly purgeAfter: string | null
  readonly ceilings: CeilingsDto
  readonly eventsCreatedInPeriod: number
  readonly usage: {
    readonly eventCount: number
    readonly liveEventCount: number
    readonly memberCount: number
    readonly usedBytes: number
  }
}
export interface SiteClientPageDto {
  readonly items: readonly SiteClientDto[]
  readonly next: string | null
}
/**
 * An event as the takedown screen reads it (`GET /api/site/events/lookup` and
 * `/api/site/events/:eventId`): ids, a status and two instants. **No name, no slug, no join code**.
 */
export interface SiteEventStateDto {
  readonly id: string
  readonly clientId: string | null
  readonly status: string
  readonly createdAt: string
  readonly takenDownAt: string | null
  readonly purgeHeldAt: string | null
}
export interface SiteEventLookupDto {
  readonly items: readonly SiteEventStateDto[]
}
/** A photograph named by its id: which event holds it and whether it is down. Nothing else. */
export interface SitePhotoStateDto {
  readonly id: string
  readonly eventId: string
  readonly takenDownAt: string | null
}
/** A guestbook message named by its id: which event holds it and whether it is down. Never its text. */
export interface SiteGuestbookStateDto {
  readonly id: string
  readonly eventId: string
  readonly takenDownAt: string | null
}
/** One event of a client, as a shape: an id, a status, instants, a quota and what it holds. */
export interface SiteEventDto {
  readonly id: string
  /** Not narrowed: the server declares it as text, and an unknown one is shown as it came. */
  readonly status: string
  readonly createdAt: string
  readonly startsAt: string | null
  readonly openedAt: string | null
  readonly closedAt: string | null
  readonly quotaBytes: number
  readonly usedBytes: number
  readonly photoCount: number
}
export interface SiteEventPageDto {
  readonly items: readonly SiteEventDto[]
  readonly next: string | null
}
/** One account as the operator reads it: its address, what it may do on the box, what it owns. */
export interface SiteAccountDto {
  readonly id: string
  /** The other free text the console prints: how an operator recognises a person. */
  readonly email: string
  readonly siteRole: 'none' | 'operator'
  readonly createdAt: string
  readonly lastLoginAt: string | null
  readonly disabledAt: string | null
  readonly mustChangePassword: boolean
  readonly ownedEventCount: number
  readonly clients: readonly { readonly clientId: string; readonly role: 'owner' | 'member' }[]
  /** The version of the terms the account last accepted, and when: the proof. `null` if none. */
  readonly termsVersion: string | null
  readonly termsAcceptedAt: string | null
}
export interface SiteAccountPageDto {
  readonly items: readonly SiteAccountDto[]
  readonly next: string | null
}
/**
 * One line of the box's whole log. Unlike the client's own view this names the account behind an
 * `operator` or a `member` actor, and carries the operator's own sentence under `reason`.
 */
export interface SiteAuditEntryDto {
  readonly seq: number
  readonly at: string
  readonly action: string
  readonly actor: {
    readonly kind: 'operator' | 'member' | 'system' | 'integration'
    readonly userId: string | null
    readonly label: string | null
  }
  readonly subject: { readonly type: string; readonly id: string }
  readonly clientId: string | null
  readonly details: Readonly<Record<string, unknown>>
}
export interface SiteAuditPageDto {
  readonly items: readonly SiteAuditEntryDto[]
  /** A number, and **a bound** (every line older than it), not a pointer; `null` ends the log. */
  readonly next: number | null
}
/** The seven ceilings a new client starts with. A number is a ceiling and `null` is none. */
export interface ClientDefaultsDto {
  readonly ceilings: {
    readonly maxEvents: number | null
    readonly maxEventsPerPeriod: number | null
    readonly maxTotalBytes: number | null
    readonly maxEventQuotaBytes: number | null
    readonly maxRetentionDays: number | null
    readonly maxLiveDays: number | null
    readonly clipsAllowed: boolean
    readonly booksAllowed: boolean
  }
}
/**
 * An invitation an operator wrote. **`link` is present only when no mail went out**, which is a
 * fact about the box's relay and never about the address: where a mailer delivers, this answer
 * holds no token and no link. A union, so that `{ delivery: 'mail', link }` is not a value the type
 * can hold. `pendingApproval` says the link opens nothing until an owner of the client has
 * approved it.
 */
export interface OperatorInvitationByMailDto {
  readonly id: string
  readonly delivery: 'mail'
  readonly expiresAt: string
  readonly pendingApproval: boolean
}
export interface OperatorInvitationByLinkDto {
  readonly id: string
  readonly delivery: 'link'
  readonly expiresAt: string
  readonly pendingApproval: boolean
  readonly link: string
}
export type OperatorInvitationDto = OperatorInvitationByMailDto | OperatorInvitationByLinkDto
export interface ProvisionedClientDto {
  readonly clientId: string
  readonly invitation: OperatorInvitationDto
}
/**
 * What the operator is told of a password reset it asked for, by how the link reached (or will
 * reach) its owner. `mail` went to the account's own mailbox and nothing else; `pendingApproval`
 * carries the id another owner of the client is asked to approve; `link` exists only on a box with
 * no relay and `copyLinkWithOwnerApproval`, after that approval.
 */
export interface OperatorPasswordResetByMailDto {
  readonly delivery: 'mail'
  readonly expiresAt: string
}
export interface OperatorPasswordResetPendingDto {
  readonly delivery: 'pendingApproval'
  readonly expiresAt: string
  readonly approvalId: string
}
export interface OperatorPasswordResetByLinkDto {
  readonly delivery: 'link'
  readonly expiresAt: string
  readonly link: string
}
export type OperatorPasswordResetDto =
  OperatorPasswordResetByMailDto | OperatorPasswordResetPendingDto | OperatorPasswordResetByLinkDto
/** A patch of ceilings, as `PUT …/ceilings` takes it: a key left out is kept, `null` removes. */
export type SiteCeilingsPatch = Partial<CeilingsDto>
export interface ClientCeilingsChangedDto {
  readonly ceilings: CeilingsDto
  readonly eventsCreatedInPeriod: number
}
