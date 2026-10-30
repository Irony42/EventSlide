import { z } from 'zod'
import { CLIENT_LOCALES, DEFAULT_CLIENT_LOCALE } from '../../../domain/clients/clientLocale'
import { CLIENT_ROLES } from '../../../domain/clients/clientRole'
import { MAX_SITE_PAGE_SIZE } from '../../../application/usecases/site/sitePageLimit'

/**
 * The operator's request shapes (`/api/site`, G2-14 / P3-13).
 *
 * **Shape only.** Whether a ceiling is within the catalogue's bounds, whether a name is a name,
 * whether an address is one and whether a reason is acceptable are the domain's, answered with
 * their own codes; what zod guarantees is that a use case never receives a number where it
 * expected a string. Every body and every query is a `z.strictObject`, so a key this contract
 * does not have (an actor, a client id under another name, a flag that would widen a patch) is a
 * `400` and not something the sender believes took effect. A path-parameter schema is a plain
 * `z.object`: its keys are the route pattern's own, so there is none a caller could add.
 *
 * Ids are `z.guid()`, for the reason `requestSchemas.ts` gives, so a malformed one is a `400`
 * and never a storage lookup, and a well-formed one that is nobody's is the same `404` as one
 * that belongs to someone else.
 */

const NAME_MAX = 1_000

export const clientIdParams = z.object({ clientId: z.guid() })

export const accountIdParams = z.object({ userId: z.guid() })

/** `/api/site/events/:eventId/...`: an event named by its id, never by its slug. */
export const eventIdParams = z.object({ eventId: z.guid() })

/** `/api/site/photos/:photoId/...`: a photograph named by its id alone. */
export const photoIdParams = z.object({ photoId: z.guid() })

/**
 * `GET /api/site/events/lookup?q=`: what a report gave the operator, a slug, a join code, an address
 * or an exact name. Its bounds and meaning are the use case's (`lookupSiteEvents`): the schema only
 * says it is one string.
 */
export const siteEventLookupQuery = z.strictObject({ q: z.string().max(1_000) })

/**
 * The body of each of the operator's "remove without viewing" acts (launch review S5): take down,
 * restore, hold a purge, release it. **The reason is required**, like a ceiling's change: a body
 * without one is `400 request.invalid`, a blank or malformed one `400 audit.reasonInvalid`
 * (`parseAuditReason`, which holds its bound).
 */
export const operatorActBody = z.strictObject({ reason: z.string().max(NAME_MAX) })

/** How many rows one page of the operator's lists, or of its audit log, may ask for. */
const pageLimit = z.coerce.number().int().min(1).max(MAX_SITE_PAGE_SIZE).optional()

/**
 * `GET /api/site/clients`, `/accounts` and a client's events: a keyset page. `after` is the `next`
 * of the last one. One schema, under the three names the routes import, because the three
 * pages are one shape.
 */
const pageQuery = z.strictObject({ after: z.guid().optional(), limit: pageLimit })

export const siteClientsQuery = pageQuery

export const siteAccountsQuery = pageQuery

export const siteClientEventsQuery = pageQuery

/**
 * `GET /api/site/audit`. `clientId` narrows the log to one client; absent, it is the whole box,
 * which is the operator's view and not a client's. `before` is the `next` of the previous page.
 */
export const siteAuditQuery = z.strictObject({
  clientId: z.guid().optional(),
  before: z.coerce.number().int().min(1).optional(),
  limit: pageLimit,
})

/** An instant, as `toISOString` writes it and as the log and the responses carry it. */
const instant = z.iso.datetime().transform((text) => new Date(text))

const count = z.number().int()

/**
 * A client's ceilings, as a **patch**: a key left out keeps the client's value, an explicit `null`
 * removes that ceiling (`setClientCeilings`). Every value is shaped here and bounded by the
 * catalogue (`ClientCeilings.create`), so `0` and `-3` are the domain's `400`s.
 */
export const ceilingsBody = z.strictObject({
  maxEvents: count.nullable().optional(),
  maxTotalBytes: count.nullable().optional(),
  maxEventQuotaBytes: count.nullable().optional(),
  maxRetentionDays: count.nullable().optional(),
  clipsAllowed: z.boolean().optional(),
  liveAllowed: z.boolean().optional(),
  maxLiveDays: count.nullable().optional(),
  maxEventsPerPeriod: count.nullable().optional(),
  periodStartedAt: instant.nullable().optional(),
})

export type CeilingsBody = z.infer<typeof ceilingsBody>

/**
 * What a bound on a free-text field is for here: keeping an unbounded string out of the parser.
 *
 * It is deliberately **not** 254 on the two e-mail fields below, unlike the sign-in's: the domain
 * (`EmailAddress`) judges an address on the operator's routes and answers a long one with its own
 * `400 email.tooLong`, which `siteRoutes.clients.test.ts` pins and `docs/API.md` documents. A
 * tighter bound here would turn that answer into `request.invalid`.
 */

/**
 * `POST /api/site/clients`. The client's name and its owner's address are the domain's to judge
 * (`ClientName`, `EmailAddress`); `locale` is the language of the console's page, which is the
 * language the owner's invitation is mailed in.
 */
export const provisionClientBody = z.strictObject({
  clientName: z.string().max(NAME_MAX),
  ownerEmail: z.string().max(NAME_MAX),
  locale: z.enum(CLIENT_LOCALES).default(DEFAULT_CLIENT_LOCALE),
  ceilings: ceilingsBody.optional(),
})

export const renameClientBody = z.strictObject({ name: z.string().max(NAME_MAX) })

/**
 * `PUT /api/site/clients/:clientId/ceilings`. **The reason is required**, with no default
 * (decided 2026-10-23): a body without one is `400 request.invalid`, and a blank or malformed
 * one is `400 audit.reasonInvalid` (`parseAuditReason`, which holds its bound).
 */
export const setCeilingsBody = z.strictObject({
  ceilings: ceilingsBody,
  reason: z.string().max(NAME_MAX),
})

/** `POST /api/site/clients/:clientId/invitations`: the guard's R1 applies, not this schema. */
export const operatorInvitationBody = z.strictObject({
  email: z.string().max(NAME_MAX),
  role: z.enum(CLIENT_ROLES),
  locale: z.enum(CLIENT_LOCALES).default(DEFAULT_CLIENT_LOCALE),
})

/**
 * `POST /api/site/clients/:clientId/offboard`. The window is judged by the use case (`400
 * client.graceInvalid` outside 1 to 365 whole days), so there is one rule and one answer for it.
 */
export const offboardClientBody = z.strictObject({ graceDays: z.number() })

/**
 * `POST /api/site/accounts/:userId/password-reset`. `approvalId` is the id an owner of the
 * account's client approved, to redeem it on a box with no mail relay and
 * `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`; it is an id and never a secret.
 */
export const operatorPasswordResetBody = z.strictObject({
  locale: z.enum(CLIENT_LOCALES).default(DEFAULT_CLIENT_LOCALE),
  approvalId: z.guid().optional(),
})
