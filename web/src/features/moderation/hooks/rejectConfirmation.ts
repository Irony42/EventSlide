import type { ModerationPhotoDto } from '../../../lib/api/dto'

/**
 * From this many photos, a bulk refusal asks first.
 *
 * Three, because a pair is a deliberate pick and a screenful is how a stray R or a click
 * on the red button next to "Publier (30)" turns thirty approvals into thirty refusals.
 */
export const REJECT_CONFIRMATION_FROM = 3

/**
 * Whether refusing these photos at once needs the host's say-so.
 *
 * Only when something here cannot be taken back. A photo that was waiting has no status
 * any decision puts it back into (`useModerationQueue`'s undo says why), so refusing it
 * is final and the guest sees "Non retenue" on their phone. A selection of photos already
 * on the wall or taken off it is undone with the notice's own button, and asking first
 * would only slow down a host who has a way back.
 */
export const needsRejectConfirmation = (
  photos: readonly Pick<ModerationPhotoDto, 'status'>[],
): boolean =>
  photos.length >= REJECT_CONFIRMATION_FROM && photos.some((photo) => photo.status === 'pending')
