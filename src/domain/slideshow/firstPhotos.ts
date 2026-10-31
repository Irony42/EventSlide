import type { GuestId, PhotoId } from '../shared/ids'
import { compareIds } from '../shared/ordering'

/**
 * Which published photos are the first their sender has on the wall.
 *
 * The wall says "Première photo de Julie" when a guest's first photo goes up, which is a
 * small moment for the guest and a cue for the table to look up. The rule is here and not in
 * the presenter because "first" has edges a caption must not get wrong.
 *
 * - **First of anything.** A guest whose first published item was a clip has already been on
 *   the wall, so their first photo afterwards is not their first. The clip itself gets no line
 *   either: the line is about a photograph.
 * - **Earliest upload, ties by id.** A multi-file upload stamps every file with one instant,
 *   and two projectors must pick the same one.
 * - **Nobody to name, nothing to say.** A host's own upload has no guest, and an anonymous
 *   guest is filtered out by whoever knows their name; this rule only sees guests.
 */

export interface FirstPhotoCandidate {
  readonly id: PhotoId
  /** `null` for a host's own upload. */
  readonly guestId: GuestId | null
  readonly createdAt: Date
  readonly kind: 'photo' | 'clip'
}

const earlier = (left: FirstPhotoCandidate, right: FirstPhotoCandidate): boolean => {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime()
  return byTime === 0 ? compareIds(left.id, right.id) < 0 : byTime < 0
}

export const firstStillsOfGuests = (
  candidates: readonly FirstPhotoCandidate[],
): ReadonlySet<PhotoId> => {
  const firstByGuest = new Map<GuestId, FirstPhotoCandidate>()
  for (const candidate of candidates) {
    if (candidate.guestId === null) continue
    const known = firstByGuest.get(candidate.guestId)
    if (known === undefined || earlier(candidate, known)) {
      firstByGuest.set(candidate.guestId, candidate)
    }
  }

  const ids = new Set<PhotoId>()
  for (const first of firstByGuest.values()) {
    if (first.kind === 'photo') ids.add(first.id)
  }
  return ids
}
