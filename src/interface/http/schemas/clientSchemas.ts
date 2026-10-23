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
