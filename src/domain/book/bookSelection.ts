import type { GuestId } from '../shared/ids'
import { splitIntoRanges } from './bookChapters'
import { byArrival, orientationOf, type BookPhoto } from './bookInput'
import type { BookSelection } from './bookOptionsV2'

/** Two photographs of one guest this close (or closer) and of one orientation are a burst. */
export const BURST_GAP_MS = 20_000

/** 3 per heart, 2 for a caption, 2 for answering a mission or a challenge. */
export const photoScore = (photo: BookPhoto): number =>
  3 * photo.reactions +
  (photo.hasCaption ? 2 : 0) +
  (photo.missionId !== null || photo.challengeId !== null ? 2 : 0)

/** Best first: score, then the oldest, then the id. */
export const byQuality = (a: BookPhoto, b: BookPhoto): number =>
  photoScore(b) - photoScore(a) || byArrival(a, b)

/** The photograph a page gives its biggest slot to: a starred one first, then by quality. */
export const byProminence = (a: BookPhoto, b: BookPhoto): number =>
  Number(b.highlighted) - Number(a.highlighted) || byQuality(a, b)

const continuesBurst = (last: BookPhoto, photo: BookPhoto): boolean =>
  photo.createdAt.getTime() - last.createdAt.getTime() <= BURST_GAP_MS &&
  orientationOf(photo) === orientationOf(last)

/** Bursts of two photographs or more, each in arrival order. `sorted` is in arrival order. */
export const findBursts = (sorted: readonly BookPhoto[]): readonly (readonly BookPhoto[])[] => {
  const open = new Map<GuestId, BookPhoto[]>()
  const bursts: BookPhoto[][] = []
  for (const photo of sorted) {
    if (photo.guestId === null) continue
    const current = open.get(photo.guestId)
    if (current !== undefined && continuesBurst(current[current.length - 1]!, photo)) {
      current.push(photo)
    } else {
      const fresh = [photo]
      open.set(photo.guestId, fresh)
      bursts.push(fresh)
    }
  }
  return bursts.filter((burst) => burst.length > 1)
}

/** One photograph per burst (starred ones all stay, being always retained). */
const collapseBursts = (sorted: readonly BookPhoto[]): readonly BookPhoto[] => {
  const dropped = new Set<string>()
  for (const burst of findBursts(sorted)) {
    const starred = burst.filter((photo) => photo.highlighted)
    const keep = starred.length > 0 ? starred : [[...burst].sort(byQuality)[0]!]
    for (const photo of burst) if (!keep.includes(photo)) dropped.add(photo.id)
  }
  return sorted.filter((photo) => !dropped.has(photo.id))
}

/**
 * The photographs a selection keeps, in arrival order.
 *
 * `best` of target T: starred photographs first (the T best of them if there are more);
 * then one photograph per photographer not yet represented, their best (the best of those
 * if places run short); then the rest by score, shared among the chapters in proportion to
 * their size so no moment of the evening disappears. Ties break by arrival then id.
 * A target at or above the number of photographs keeps everything.
 */
export const selectPhotos = (
  photos: readonly BookPhoto[],
  selection: BookSelection,
): readonly BookPhoto[] => {
  const sorted = [...photos].sort(byArrival)
  if (selection.kind === 'all' || selection.target >= sorted.length) return sorted

  const target = selection.target
  const candidates = collapseBursts(sorted)
  if (candidates.length <= target) return candidates

  const chosen = new Set<BookPhoto>()
  const starred = candidates.filter((photo) => photo.highlighted).sort(byQuality)
  for (const photo of starred.slice(0, target)) chosen.add(photo)

  if (chosen.size < target) {
    const represented = new Set<GuestId>()
    for (const photo of chosen) if (photo.guestId !== null) represented.add(photo.guestId)
    const bestOfGuest = new Map<GuestId, BookPhoto>()
    for (const photo of [...candidates].sort(byQuality)) {
      if (photo.guestId === null || represented.has(photo.guestId) || chosen.has(photo)) continue
      if (!bestOfGuest.has(photo.guestId)) bestOfGuest.set(photo.guestId, photo)
    }
    const firsts = [...bestOfGuest.values()].sort(byQuality)
    for (const photo of firsts.slice(0, target - chosen.size)) chosen.add(photo)
  }

  if (chosen.size < target) fillByChapter(candidates, chosen, target)
  return candidates.filter((photo) => chosen.has(photo))
}

/** The remaining places, by score, shared among the chapters (D'Hondt, ties to the earliest). */
const fillByChapter = (
  candidates: readonly BookPhoto[],
  chosen: Set<BookPhoto>,
  target: number,
): void => {
  const ranges = splitIntoRanges(candidates.map((photo) => photo.createdAt.getTime()))
  const pools = ranges.map((range) =>
    candidates
      .slice(range.start, range.end)
      .filter((photo) => !chosen.has(photo))
      .sort(byQuality),
  )
  const given = ranges.map(() => 0)
  // Places already held by a chapter count towards its share.
  const held = ranges.map(
    (range) => candidates.slice(range.start, range.end).filter((photo) => chosen.has(photo)).length,
  )
  const take = (index: number): void => {
    chosen.add(pools[index]![given[index]!]!)
    given[index]! += 1
    held[index]! += 1
  }

  // No moment disappears: a chapter with no photograph yet gets its best.
  ranges.forEach((range, index) => {
    const represented = candidates.slice(range.start, range.end).some((photo) => chosen.has(photo))
    if (!represented && chosen.size < target) take(index)
  })

  while (chosen.size < target) {
    let best = -1
    let bestQuotient = -1
    ranges.forEach((range, index) => {
      if (given[index]! >= pools[index]!.length) return
      const quotient = (range.end - range.start) / (held[index]! + 1)
      if (quotient > bestQuotient) {
        best = index
        bestQuotient = quotient
      }
    })
    take(best)
  }
}
