import type { WallAnnouncementDto } from '../../lib/api/dto'
import { wallAnnouncementPhaseAt } from './announcementPhase'

/**
 * Which announcement layers the room sees at one instant of the server's clock (spec 21, §6).
 *
 * Pure and derived: the same list and the same `nowMs` give the same answer on every projector,
 * which is the whole promise of an announcement made to the second. Only the **fullscreen** kind
 * lives here (a discreet one is a later change).
 */
export interface AnnouncementLayers {
  /** The countdown banner: the fullscreen announcement nearest to its moment, while it counts. */
  readonly band: WallAnnouncementDto | null
  /** The full-frame card: the fullscreen announcement that is on screen now. */
  readonly card: WallAnnouncementDto | null
  /** Whether a fullscreen announcement counts or shows: the room's attention is spoken for. */
  readonly active: boolean
  /**
   * The next server instant at which a layer starts or ends, or `null` when none will. The page
   * renders again then, and nowhere in between: it is the one timer of the derivation.
   */
  readonly nextChangeMs: number | null
}

const NONE: AnnouncementLayers = { band: null, card: null, active: false, nextChangeMs: null }

export const announcementLayersAt = (
  items: readonly WallAnnouncementDto[] | undefined,
  nowMs: number,
): AnnouncementLayers => {
  if (items === undefined || items.length === 0) return NONE

  let band: WallAnnouncementDto | null = null
  let bandLeftMs = Infinity
  let card: WallAnnouncementDto | null = null
  let nextChangeMs = Infinity

  for (const item of items) {
    if (item.kind !== 'fullscreen') continue
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
    active: band !== null || card !== null,
    nextChangeMs: nextChangeMs === Infinity ? null : nextChangeMs,
  }
}
