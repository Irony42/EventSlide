import type { WallAnnouncementDto } from '../../lib/api/dto'
import { wallAnnouncementPhaseAt } from './announcementPhase'

/**
 * Which announcement layers the room sees at one instant of the server's clock (spec 21, §6).
 *
 * Pure and derived: the same list and the same `nowMs` give the same answer on every projector,
 * which is the whole promise of an announcement made to the second. The **fullscreen** kind gives
 * the banner and the card; the **discreet** kind gives the pill, which counts down nothing and
 * holds nothing: it is not part of `active` (rule 19), so it neither keeps the guestbook card away
 * nor touches the slideshow.
 */
export interface AnnouncementLayers {
  /** The countdown banner: the fullscreen announcement nearest to its moment, while it counts. */
  readonly band: WallAnnouncementDto | null
  /** The full-frame card: the fullscreen announcement that is on screen now. */
  readonly card: WallAnnouncementDto | null
  /** The pill: the discreet announcement that is on screen now, left under whatever covers it. */
  readonly pill: WallAnnouncementDto | null
  /** Whether a fullscreen announcement counts or shows: the room's attention is spoken for. */
  readonly active: boolean
  /**
   * The next server instant at which a layer starts or ends, or `null` when none will. The page
   * renders again then, and nowhere in between: it is the one timer of the derivation.
   */
  readonly nextChangeMs: number | null
}

const NONE: AnnouncementLayers = {
  band: null,
  card: null,
  pill: null,
  active: false,
  nextChangeMs: null,
}

export const announcementLayersAt = (
  items: readonly WallAnnouncementDto[] | undefined,
  nowMs: number,
): AnnouncementLayers => {
  if (items === undefined || items.length === 0) return NONE

  let band: WallAnnouncementDto | null = null
  let bandLeftMs = Infinity
  let card: WallAnnouncementDto | null = null
  let pill: WallAnnouncementDto | null = null
  let nextChangeMs = Infinity

  for (const item of items) {
    const atMs = Date.parse(item.at)
    const boundaries = [
      atMs - item.countdownSeconds * 1000,
      atMs,
      atMs + item.durationSeconds * 1000,
    ]
    for (const boundary of boundaries) {
      if (boundary > nowMs && boundary < nextChangeMs) nextChangeMs = boundary
    }

    const state = wallAnnouncementPhaseAt(item, nowMs)
    if (item.kind === 'discreet') {
      // Two discreet ones never overlap (rules 7 and 20): the first one showing is the only one.
      if (state.phase === 'showing' && pill === null) pill = item
      continue
    }
    // The server sorts by time then id, and two fullscreen cards never overlap (rule 7): the
    // first one showing is the only one, and a tie between counts goes to the earlier in the list.
    if (state.phase === 'showing' && card === null) card = item
    if (state.phase === 'counting' && state.remainingMs < bandLeftMs) {
      band = item
      bandLeftMs = state.remainingMs
    }
  }

  return {
    band,
    card,
    pill,
    active: band !== null || card !== null,
    nextChangeMs: nextChangeMs === Infinity ? null : nextChangeMs,
  }
}
