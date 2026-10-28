import type { ThemeAmbiance } from '../../lib/api/dto'
import { DEFAULT_EVENT_THEME } from '../eventTheme'

export interface AmbianceMarkerProps {
  /** The ambiance of the event the page is about, or nothing while it is not known yet. */
  readonly ambiance: ThemeAmbiance | null | undefined
}

/**
 * Dresses the whole page in an event's ambiance (ADR 0010, decision 3 as amended on 28/10).
 *
 * `tokens.css` re-skins the page through `:root:has([data-event-ambiance])`, so a page that is
 * about one event only has to carry the attribute somewhere for the body, the header and every
 * primitive to follow, in the same paint. That is what this renders: an empty, hidden element
 * and nothing else. The product's own look, the Guinguette, emits nothing, so a page about a
 * Guinguette event is byte for byte the page it was.
 *
 * Used where a page knows its event but is not a themed surface itself: the guest's welcome
 * after a scan, and the host's pages under one event. The semantic colours stay fixed in every
 * ambiance, which is what keeps the moderation queue's vocabulary readable when it is dressed.
 */
export function AmbianceMarker({ ambiance }: AmbianceMarkerProps) {
  if (ambiance === null || ambiance === undefined || ambiance === DEFAULT_EVENT_THEME.ambiance) {
    return null
  }
  return <span hidden data-event-ambiance={ambiance} data-ambiance-marker="" />
}
