import type { ThemeAmbiance, ThemeCustom } from '../../lib/api/dto'
import { customGroundProps, DEFAULT_EVENT_THEME, venueGroundProps } from '../eventTheme'
import { useRootGroundHue } from '../useRootGroundHue'

export interface AmbianceMarkerProps {
  /** The ambiance of the event the page is about, or nothing while it is not known yet. */
  readonly ambiance: ThemeAmbiance | null | undefined
  /**
   * The host's own photograph of their venue, when they uploaded one (ADR 0010, decision 8).
   * It replaces the ambiance's bundled ground on the page this marker dresses.
   */
  readonly groundUrl?: string | null | undefined
  /**
   * The host's own ambiance (ADR 0011), read when `ambiance` is `custom`: it adds
   * `data-ambiance-ground`, `data-ambiance-faces` and the inline `--ground-hue` angle.
   */
  readonly custom?: ThemeCustom | null | undefined
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
export function AmbianceMarker({ ambiance, groundUrl, custom }: AmbianceMarkerProps) {
  // The page around it reads the hue on the root (see useRootGroundHue).
  useRootGroundHue(ambiance, custom)
  // Nothing while the event is not known yet.
  if (ambiance === null || ambiance === undefined) return null

  // The root look carries no attribute: it is what the page already is.
  const dressing = ambiance === DEFAULT_EVENT_THEME.ambiance ? undefined : ambiance
  const ground = venueGroundProps({ groundUrl }, 'guest')
  const own = customGroundProps(ambiance, custom)
  if (dressing === undefined && ground === null) return null
  const ownAttributes =
    own === null
      ? {}
      : {
          'data-ambiance-ground': own['data-ambiance-ground'],
          'data-ambiance-faces': own['data-ambiance-faces'],
        }

  // With the host's photograph the marker is no longer hidden: it is the element whose
  // `::before` paints the ground (`base.css`), because the page's own `html::before` can only
  // read the root's custom properties and an inline one on a descendant does not reach it. It is
  // `display: contents` there, so it still takes no room.
  if (ground === null) {
    return (
      <span
        hidden
        data-event-ambiance={dressing}
        data-ambiance-marker=""
        {...ownAttributes}
        style={own?.style}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      data-event-ambiance={dressing}
      data-ambiance-marker=""
      data-venue-ground={ground['data-venue-ground']}
      {...ownAttributes}
      style={{ ...own?.style, ...ground.style }}
    />
  )
}
