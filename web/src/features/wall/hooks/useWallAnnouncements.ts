import { useEffect, useState } from 'react'
import type { WallAnnouncementsDto } from '../../../lib/api/dto'
import { announcementLayersAt, type AnnouncementLayers } from '../announcementLayers'

/** The longest a `setTimeout` can be asked to wait (a signed 32-bit number of milliseconds). */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * The announcement layers of the wall, derived from the server's clock on every render (spec 21,
 * §5): nothing is counted, nothing is stored.
 *
 * One `setTimeout`, replaced at each boundary, makes sure a render happens when a layer starts or
 * ends: an eight-hour evening accumulates nothing. The countdown's seconds are the banner's own
 * business, mounted only while it counts. A hidden tab throttles timers, so coming back to the
 * foreground renders again.
 *
 * `now` is the server's time now (this machine's clock plus the offset of the last read). The
 * response is kept when a read fails, so a network that went away after the text was read changes
 * nothing: the card still starts at its second.
 */
export const useWallAnnouncements = (
  announcements: WallAnnouncementsDto | undefined,
  now: () => number,
): AnnouncementLayers => {
  const [tick, setTick] = useState(0)
  const layers = announcementLayersAt(announcements?.items, now())
  const next = layers.nextChangeMs

  useEffect(() => {
    if (next === null) return undefined
    const delay = Math.min(Math.max(0, next - now()), MAX_TIMEOUT_MS)
    const timer = window.setTimeout(() => setTick((count) => count + 1), delay)
    return () => window.clearTimeout(timer)
    // `tick` re-arms a timer that fired a hair before the boundary: the derived `next` is then unchanged.
  }, [next, now, tick])

  const watching = announcements !== undefined
  useEffect(() => {
    if (!watching) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((count) => count + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [watching])

  return layers
}
