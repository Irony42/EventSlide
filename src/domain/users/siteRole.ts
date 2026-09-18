/**
 * What an account may do **on the box**, as opposed to inside any one event.
 *
 * Two roles, deliberately, and not a permission matrix: an operator, and everyone else.
 * An operator is the person who runs this instance for other people — a photographer, an
 * agency, a school — and creates the evening a client then owns. Everyone else is an
 * ordinary account whose whole authority comes from `event_memberships`, which is where
 * it came from before this type existed (docs/ROADMAP.md §10.1).
 *
 * ## Why this is not an `EventRole`, and never ranks against one
 *
 * `eventRole.ts` orders its two roles so authorization can ask "at least a moderator?".
 * A site role is deliberately **outside** that order. Ranking the two together would make
 * `isAtLeast(siteRole, 'owner')` expressible, and the first route that wrote it would
 * hand an operator every event on the box — which is the exact failure this item exists
 * to avoid. The two vocabularies do not even share a member, and `siteRole.test.ts`
 * asserts that as a rule rather than as a coincidence.
 *
 * ## What an operator may do
 *
 * Nothing that is not on this list, and today the list is empty of routes: 10.1 ships the
 * role, the gate that reads it, and the guarantee that no existing check widened.
 * The operator's own surface — clients (§10.2), invitations (§10.3), the console (§10.4),
 * ceilings (§10.5) — arrives behind {@link canOperateSite} as each item lands.
 *
 * ## What an operator may never do
 *
 * **Read a client's photographs, or moderate their queue.** The console of §10.4 "sees
 * shapes and sizes, not photographs" and support access is its own item (§10.6), which
 * ships time-boxed, announced in the client's own interface, and written to a log the
 * client can read. So a site role grants nothing inside an event: an operator who is not
 * a member of an event is refused by `requireRole` exactly as a stranger is, and is a
 * member of the public to `mediaRoutes`. That is not an omission a later route may
 * quietly fill — it has named tests at ring 4 (`authz.test.ts`,
 * `siteOperatorScope.test.ts`) and ring 6 (`tests/e2e/security/tenant-isolation.spec.ts`).
 */

export const SITE_ROLES = ['none', 'operator'] as const

export type SiteRole = (typeof SITE_ROLES)[number]

export const isSiteRole = (value: unknown): value is SiteRole =>
  typeof value === 'string' && (SITE_ROLES as readonly string[]).includes(value)

/**
 * What an account gets when nobody decided otherwise.
 *
 * Every account is this unless something says otherwise in so many words: the column
 * defaults to it, the invitation path passes it explicitly, and an install that never
 * wanted an operator behaves exactly as it did before the column existed.
 */
export const DEFAULT_SITE_ROLE: SiteRole = 'none'

/**
 * Run the box: the operator's own surface, and nothing inside anyone's event.
 *
 * One predicate rather than one per future screen. The roadmap is explicit that this is
 * two roles and not a matrix, so a second predicate here would be the matrix arriving by
 * increments — and each one would be a new place where "operator" could come to mean
 * something inside an event.
 */
export const canOperateSite = (role: SiteRole): boolean => role === 'operator'
