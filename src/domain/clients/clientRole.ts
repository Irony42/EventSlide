/**
 * Who manages a client's account, as opposed to who may moderate one of its events.
 *
 * A `ClientRole` is a different vocabulary from `EventRole` and is never ranked against
 * it: ordering the two together is exactly the permission matrix roadmap §10.1 refuses to
 * build. An `owner` of a client can invite another member and rename the client; a
 * `member` belongs to the account. Neither grants anything inside an event on its own —
 * `client_members` is the client's roster, and `event_memberships` is still the only table
 * authorization reads for a single event.
 *
 * They do share the word `owner`, and that is a coincidence of English rather than a
 * relation: the two are stored in different tables under different `CHECK`s, so
 * `isClientRole('moderator')` and `isEventRole('member')` are both false and a role read
 * from one table is never accepted as the other.
 */

export const CLIENT_ROLES = ['owner', 'member'] as const

export type ClientRole = (typeof CLIENT_ROLES)[number]

export const isClientRole = (value: unknown): value is ClientRole =>
  typeof value === 'string' && (CLIENT_ROLES as readonly string[]).includes(value)
