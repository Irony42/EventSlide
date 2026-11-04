import type { ModerationDecision, PhotoStatus } from '../../../lib/api/dto'

/**
 * The status a decision produces, mirrored from `docs/API.md`.
 *
 * A projection of the answer the server is about to give, not a rule: the endpoint
 * replies 204 with no body, so an optimistic tile has to know what it is showing. The
 * server stays the authority, and the refetch on the resulting signal corrects
 * anything this got wrong.
 */
export const TARGET_STATUS: Readonly<Record<ModerationDecision, PhotoStatus>> = {
  publish: 'published',
  reject: 'rejected',
  hide: 'hidden',
}

/**
 * Which decision puts a photo back into a status it used to hold.
 *
 * `pending` is deliberately absent: no decision verb produces it, so a photo that was
 * awaiting a decision cannot be sent back there. `src/domain/moderation/
 * moderationDecision.ts` spells out why guessing is dangerous — "put that back" on a
 * photo the host mistakenly refused while it was still pending would throw it onto the
 * projector with no approval behind it, which is the one thing a host is promised
 * cannot happen. So undo is offered only where the previous status is reachable, and
 * the console keeps the previous status itself rather than asking the server to invert
 * a decision it never recorded a source for.
 */
const RESTORING_DECISION: Readonly<Partial<Record<PhotoStatus, ModerationDecision>>> = {
  published: 'publish',
  rejected: 'reject',
  hidden: 'hide',
}

/**
 * What "annuler" does to a photo that was still awaiting a decision when the host
 * published it: take it back off the wall. `hide` is the only safe answer, which is why
 * it is not a parameter, and it is the same on the laptop and on the phone.
 *
 * Until MOD-1 the desktop console left it out, on the argument that the tile stays on
 * screen with a "retirer" button on it. It does not: the server signals `photo.moderated`,
 * the console reloads "En attente", and the tile is gone within the second. A mis-pressed
 * P then left a photo on the wall that only a change of tab could take down.
 */
const UNDO_OF_PUBLISH: ModerationDecision = 'hide'

/**
 * Which decision takes this one back, given where the photo came from and where it
 * went. `null` when nothing safely does, and the console then offers no undo at all.
 *
 * The `pending` case is the whole reason this is a function rather than the map above.
 * Nothing puts a photo back to `pending`, so the answer is `null` — except for one
 * direction:
 *
 * - **A publish can be taken back with `hide`**, on both consoles. The photo comes off
 *   the wall, which is what the host meant, and it lands in `hidden` rather than back in
 *   the queue — `hidden` keeps it in the album and reachable from the "Retirées" filter,
 *   and it is the only status change here that cannot put something unapproved on a
 *   screen. A decided photo leaves the queue as soon as the server confirms it, so
 *   without this nothing on either console could take it back.
 * - **A refusal is never taken back from `pending`.** The only verb that would reverse
 *   it is `publish`, and the photo was awaiting a decision, so "put that back" would
 *   throw it onto the projector with no approval behind it — the one thing a host is
 *   promised cannot happen. `src/domain/moderation/moderationDecision.ts` says the same
 *   thing about `inverseOf('reject')`, and this agrees with it rather than working
 *   around it.
 */
export interface Restore {
  /** What to send. `null` when nothing safely takes this decision back. */
  readonly decision: ModerationDecision | null
  /**
   * Whether that decision puts the photo back exactly where it was.
   *
   * `false` is not a detail of wording: an inexact restore is a *second decision*, and
   * a host told "décision annulée" would go looking for the photo in the queue it is
   * no longer in.
   */
  readonly exact: boolean
}

export const restoringDecision = (
  previousStatus: PhotoStatus,
  currentStatus: PhotoStatus,
): Restore => {
  /**
   * A refusal of a hidden photo cannot be taken back: the way back to `hidden` is `hide`,
   * and the status machine only lets a rejected photo return to `published`
   * (`src/domain/photos/photoStatus.ts`). Offering "Annuler" would be a button the server
   * skips without a word, under a notice that said the refusal could be taken back.
   * Every other previous status has a restoring decision the machine allows from where
   * the photo went, so this is the single case where the table above is not enough.
   */
  if (previousStatus === 'hidden' && currentStatus === 'rejected') {
    return { decision: null, exact: false }
  }
  const direct = RESTORING_DECISION[previousStatus]
  if (direct !== undefined) return { decision: direct, exact: true }
  return currentStatus === 'published'
    ? { decision: UNDO_OF_PUBLISH, exact: false }
    : { decision: null, exact: false }
}
