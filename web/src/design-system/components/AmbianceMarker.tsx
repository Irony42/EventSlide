import type { ThemeAmbiance } from '../../lib/api/dto'
import { DEFAULT_EVENT_THEME, venueGroundProps } from '../eventTheme'

export interface AmbianceMarkerProps {
  /** The ambiance of the event the page is about, or nothing while it is not known yet. */
  readonly ambiance: ThemeAmbiance | null | undefined
  /**
   * The host's own photograph of their venue, when they uploaded one (ADR 0010, decision 8).
   * It replaces the ambiance's bundled ground on the page this marker dresses.
   */
  readonly groundUrl?: string | null | undefined
}

/**
 * Dresses the whole page in an event's ambiance (ADR 0010, decision 3 as amended on 28/10).
 *
 * `tokens.css` re-skins the page through `:root:has([data-event-ambiance])`, so a page that is
 * about one event only has to carry the attribute somewhere for the body, the header and every
 * primitive to follow, in the same paint. That is what this renders: an empty, hidden element
 * and nothing else. The product's own look emits nothing, so a page about a Chambre noire event
 * is byte for byte the page it was.
 *
 * Used where a page knows its event but is not a themed surface itself: the guest's welcome
 * after a scan, and the host's pages under one event. The semantic colours stay fixed in every
 * ambiance, which is what keeps the moderation queue's vocabulary readable when it is dressed.
 */
export function AmbianceMarker({ ambiance, groundUrl }: AmbianceMarkerProps) {
  if (ambiance === null || ambiance === undefined || ambiance === DEFAULT_EVENT_THEME.ambiance) {
    return null
  }

  // With the host's photograph the marker is no longer hidden: it is the element whose
  // `::before` paints the ground (`base.css`), because the page's own `html::before` can only read
  // the root's custom properties and an inline one on a descendant does not reach it. It is
  // `display: contents` there, so it still takes no room.
  const ground = venueGroundProps({ ambiance, groundUrl }, 'guest')
  if (ground === null) return <span hidden data-event-ambiance={ambiance} data-ambiance-marker="" />

  return (
    <span
      aria-hidden="true"
      data-event-ambiance={ambiance}
      data-ambiance-marker=""
      data-venue-ground={ground['data-venue-ground']}
      style={ground.style}
    />
  )
}
