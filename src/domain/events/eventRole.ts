/**
 * What a member of an event may do.
 *
 * A role is always **per event** — there is no global administrator. 1.0 had a single
 * shared admin password, so lending the moderation screen to a friend for one wedding
 * handed them every other event on the box.
 *
 * Two roles, deliberately. The host owns the event; a moderator is someone handed a
 * laptop for the evening to approve photos, and nothing else. The split exists so that
 * lending out moderation cannot lose the event, rotate the join code out from under the
 * printed cards, or change the retention policy.
 */

export const EVENT_ROLES = ['owner', 'moderator'] as const

export type EventRole = (typeof EVENT_ROLES)[number]

export const isEventRole = (value: unknown): value is EventRole =>
  typeof value === 'string' && (EVENT_ROLES as readonly string[]).includes(value)

/**
 * Roles are ordered, so authorization can ask "at least a moderator?" instead of
 * listing every role that qualifies — a list that goes stale the moment a role is
 * added, silently granting or denying.
 */
const RANKS: Readonly<Record<EventRole, number>> = {
  moderator: 1,
  owner: 2,
}

export const rank = (role: EventRole): number => RANKS[role]

export const isAtLeast = (role: EventRole, minimum: EventRole): boolean =>
  rank(role) >= rank(minimum)

/** Approve, hide and reject photos. The whole point of inviting a moderator. */
export const canModerate = (role: EventRole): boolean => isAtLeast(role, 'moderator')

/** Settings, join-code rotation and the lifecycle: the host's own decisions. */
export const canManageEvent = (role: EventRole): boolean => isAtLeast(role, 'owner')

/** A moderator who could invite moderators would be an owner with extra steps. */
export const canInviteModerators = (role: EventRole): boolean => isAtLeast(role, 'owner')

/** Deletion cascades to every photo of the event and is not undoable. */
export const canDeleteEvent = (role: EventRole): boolean => isAtLeast(role, 'owner')
