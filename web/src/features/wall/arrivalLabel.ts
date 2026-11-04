import type { UiText } from '../../lib/i18n/translations'
import type { Bubble } from './arrivals'

/**
 * What the bubble says. Counts only: it never names the guest (spec 11, decision 2), because the
 * name is already under the photograph where the layout shows it and a signal naming someone
 * would speak before their photograph is on screen.
 */
export const arrivalLabel = (text: UiText, bubble: Pick<Bubble, 'photos' | 'clips'>): string => {
  const { photos, clips } = bubble
  if (photos > 0 && clips > 0) return text.wall.arrivalMixed(photos + clips)
  if (clips > 0) return clips === 1 ? text.wall.arrivalClip : text.wall.arrivalClips(clips)
  return photos === 1 ? text.wall.arrivalPhoto : text.wall.arrivalPhotos(photos)
}
