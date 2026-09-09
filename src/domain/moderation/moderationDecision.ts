import type { PhotoStatus } from '../photos/photoStatus'

/**
 * What a moderator decides about one photo.
 *
 * These are the host's verbs, not the photo's states, and the two vocabularies are
 * kept apart on purpose: the console binds three keys during a party, the wire carries
 * `publish` rather than `published`, and `targetStatusFor` is the single bridge. A
 * client can therefore never post a status it invented, and the status machine stays
 * free to grow a state that no keystroke maps to.
 */

export const MODERATION_DECISIONS = ['publish', 'reject', 'hide'] as const

export type ModerationDecision = (typeof MODERATION_DECISIONS)[number]

const TARGET_STATUS: Readonly<Record<ModerationDecision, PhotoStatus>> = {
  publish: 'published',
  reject: 'rejected',
  hide: 'hidden',
}

/**
 * What undoes a decision, for the "annuler" affordance the host reaches for straight
 * after a mistyped keystroke.
 *
 * A decision records the status it moved the photo *to* and never the one it came
 * from, so an inverse exists only where the resulting status has a single possible
 * predecessor. `hidden` is reachable from `published` alone, so undoing `hide` is
 * unambiguous.
 *
 * `published` and `rejected` are each reachable from three statuses, so both are
 * `null`. Guessing `publish` as the undo of a reject is the dangerous one: the photo
 * the host just mistakenly turned down was usually still `pending`, and "put that
 * back" would then throw it onto the projector with no approval behind it — the one
 * thing the host is promised cannot happen. Sending it back to `pending` is not
 * expressible here either, because no decision verb produces that status. The
 * previous status is the caller's to keep and to supply.
 */
const INVERSE: Readonly<Record<ModerationDecision, ModerationDecision | null>> = {
  publish: null,
  reject: null,
  hide: 'publish',
}

export const isModerationDecision = (value: unknown): value is ModerationDecision =>
  typeof value === 'string' && (MODERATION_DECISIONS as readonly string[]).includes(value)

export const targetStatusFor = (decision: ModerationDecision): PhotoStatus =>
  TARGET_STATUS[decision]

export const inverseOf = (decision: ModerationDecision): ModerationDecision | null =>
  INVERSE[decision]
