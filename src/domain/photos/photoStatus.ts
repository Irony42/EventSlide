/**
 * The moderation state machine.
 *
 * Only `published` photos ever reach the projector. That is the product's core
 * promise — a host must be able to guarantee that nothing appears on a screen in front
 * of two hundred people without a decision — so it is expressed here, as data, rather
 * than as a `WHERE status = 'accepted'` string repeated across route handlers the way
 * 1.0 did it.
 *
 * `hidden` exists because "take it off the wall" and "this was inappropriate" are
 * different intents with different consequences: a hidden photo stays in the album and
 * in the guest's own view, a rejected one does not.
 */

export const PHOTO_STATUSES = ['pending', 'published', 'rejected', 'hidden'] as const

export type PhotoStatus = (typeof PHOTO_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<PhotoStatus, readonly PhotoStatus[]>> = {
  // Fresh from a guest: approve it or turn it down.
  pending: ['published', 'rejected'],
  // On the wall: pull it off gently, or turn it down outright.
  published: ['hidden', 'rejected'],
  // Hosts change their minds, and a bulk reject is easy to fire by accident.
  rejected: ['published'],
  hidden: ['published', 'rejected'],
}

export const isPhotoStatus = (value: unknown): value is PhotoStatus =>
  typeof value === 'string' && (PHOTO_STATUSES as readonly string[]).includes(value)

/** A no-op transition is allowed, so a double-click on "publish" is idempotent. */
export const canTransition = (from: PhotoStatus, to: PhotoStatus): boolean =>
  from === to || ALLOWED_TRANSITIONS[from].includes(to)

export const allowedTransitionsFrom = (from: PhotoStatus): readonly PhotoStatus[] =>
  ALLOWED_TRANSITIONS[from]

/**
 * The read model of the wall. The display query filters on exactly this, and the
 * authorization layer never lets a public reader ask for anything else.
 */
export const isVisibleOnWall = (status: PhotoStatus): boolean => status === 'published'

/** Awaiting a host decision — what the moderation badge counts. */
export const needsDecision = (status: PhotoStatus): boolean => status === 'pending'

/**
 * Included in the album export and in the post-event gallery. A rejected photo is
 * excluded: 1.0's ZIP download shipped every row regardless of status, so a host who
 * carefully rejected a photo still handed it out afterwards.
 */
export const isInAlbum = (status: PhotoStatus): boolean =>
  status === 'published' || status === 'hidden'

/**
 * Every status is visible to the guest who sent the photo — including `rejected`,
 * shown as declined rather than silently vanishing, and `pending`, shown as awaiting
 * moderation rather than leaving the guest to wonder whether the upload worked. There
 * is deliberately no predicate for this: an author-scoped query filters by author, not
 * by status.
 */
