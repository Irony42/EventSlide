import { z } from 'zod'

/**
 * The client space's request shapes (`/api/client/*`, G2-12 / P3-14).
 *
 * An id is a uuid, which is what `IdGenerator.accountTokenId` mints, so a malformed one is a
 * `400` and never a storage lookup. Nothing about whether it exists is learned from it: a
 * well-formed id that is nobody's is the same `404` as one that belongs to another client.
 */
export const approveInvitationParams = z.object({ invitationId: z.string().uuid() })
