import { z } from 'zod'

/**
 * The client space's request shapes (`/api/client/*`, G2-12 / P3-14).
 *
 * An id is eight, four, four, four and twelve hexadecimal digits, which is what
 * `IdGenerator.accountTokenId` mints and the same pattern the other routes take (`z.guid()`,
 * for the reason `requestSchemas.ts` gives), so a malformed one is a `400` and never a storage
 * lookup. Nothing about whether it exists is learned from it: a well-formed id that is nobody's
 * is the same `404` as one that belongs to another client.
 *
 * A path-parameter schema is a plain `z.object`, as there: its keys are the route pattern's
 * own, so there is no key a client could add.
 */
export const approveInvitationParams = z.object({ invitationId: z.guid() })

/** The ceiling on one page of the log, whatever the caller asks for. */
export const CLIENT_AUDIT_MAX_LIMIT = 100
export const CLIENT_AUDIT_DEFAULT_LIMIT = 50

/**
 * `GET /api/client/audit` (G2-16 / P3-17). `clientId` is needed only by an account in several
 * clients, and is **never trusted**: the use case checks it against the caller's own roster.
 * `before` is the `next` of the previous page. A strict object, so a filter this contract does
 * not have (an actor, an action, another client's id under another name) is a `400` and not
 * something the caller believes was applied.
 */
export const clientAuditQuery = z.strictObject({
  clientId: z.guid().optional(),
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CLIENT_AUDIT_MAX_LIMIT)
    .default(CLIENT_AUDIT_DEFAULT_LIMIT),
})

/** `GET /api/client/invitations`: which client, for an account in several. */
export const pendingInvitationsQuery = z.strictObject({ clientId: z.guid().optional() })

/** `GET /api/me/limits` takes no parameter: whose limits they are is the session's to say. */
export const myLimitsQuery = z.strictObject({})
