import type { ChallengeId, GuestbookEntryId, GuestId, MissionId, PhotoId } from '../shared/ids'

/**
 * What `composeBook` knows of a photograph: numbers and ids only, never bytes and never a
 * guest's words. Captions, first names and mission prompts are read again when the pages are
 * drawn, as in the v1 book.
 */
export interface BookPhoto {
  readonly id: PhotoId
  /** The instant the photograph **arrived** on the server: the book has no other clock. */
  readonly createdAt: Date
  readonly width: number
  readonly height: number
  readonly guestId: GuestId | null
  /** Hearts, read once at the first pass and frozen: the plan never reads them again. */
  readonly reactions: number
  readonly highlighted: boolean
  readonly missionId: MissionId | null
  readonly challengeId: ChallengeId | null
  readonly hasCaption: boolean
}

/** A written guest-book message that may enter the book. Its text is read again at render time. */
export interface BookMessage {
  readonly id: GuestbookEntryId
  readonly guestId: GuestId | null
  readonly createdAt: Date
  /** Characters; at most 500. */
  readonly length: number
}

/** The evening in numbers, counted on the **event** at the first pass, not on the selection. */
export interface BookCounts {
  readonly photos: number
  readonly photographers: number
  readonly hearts: number
  /**
   * Written messages published at the snapshot, **uncapped**: `GuestbookRepository.listWrittenForBook`
   * is asked for at most `BOOK_MAX_MESSAGES`, so the caller counts them apart. It is what lets the
   * plan say how many are left in the album export.
   */
  readonly messages: number
  readonly voices: number
  readonly videos: number
}

export interface BookInput {
  readonly photos: readonly BookPhoto[]
  readonly messages: readonly BookMessage[]
  readonly counts: BookCounts
}

export type PhotoOrientation = 'landscape' | 'portrait' | 'square'

export const orientationOf = (photo: {
  readonly width: number
  readonly height: number
}): PhotoOrientation => {
  if (photo.width > photo.height) return 'landscape'
  if (photo.width < photo.height) return 'portrait'
  return 'square'
}

/** Arrival order, ties broken by id: a total order, so the input's own order never matters. */
export const byArrival = (
  a: { readonly createdAt: Date; readonly id: string },
  b: { readonly createdAt: Date; readonly id: string },
): number => {
  const delta = a.createdAt.getTime() - b.createdAt.getTime()
  if (delta !== 0) return delta
  if (a.id < b.id) return -1
  return a.id > b.id ? 1 : 0
}
