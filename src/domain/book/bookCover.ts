import type { PhotoId } from '../shared/ids'
import type { BookPlan } from './bookPlan'

/**
 * The photograph of the cover: the most loved one of the book (the hearts frozen in the plan), the
 * first in page order on a tie and when nobody gave a heart; `null` for a plan with no photograph.
 * The reminder page of favourites is not looked at: it only repeats photographs.
 */
export const pickCoverPhoto = (plan: BookPlan): PhotoId | null => {
  let best: PhotoId | null = null
  let bestHearts = -1
  for (const page of plan.pages) {
    if (page.template === 'favourites') continue
    for (const slot of page.slots) {
      const hearts = plan.hearts[slot.photoId] ?? 0
      if (hearts > bestHearts) {
        best = slot.photoId
        bestHearts = hearts
      }
    }
  }
  return best
}
