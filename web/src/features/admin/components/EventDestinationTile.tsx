import type { EventDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventDestination } from '../eventOverview'
import { DownloadTile, PanelTile, RouteTile, type TileSize } from './EventTiles'

/** The destinations that are a panel further down the event page rather than another page. */
export type PanelDestination = Extract<
  EventDestination,
  'share' | 'guestbook' | 'challenge' | 'missions' | 'guests' | 'moderators' | 'bestOf' | 'book'
>

export interface EventDestinationTileProps {
  readonly destination: EventDestination
  readonly size: TileSize
  readonly event: Pick<EventDto, 'slug' | 'status' | 'pendingCount' | 'guestCount'>
  /** Built by the API client, so the link and the endpoint cannot drift apart. */
  readonly albumUrl: string
  /** Takes the host to a panel on this page: focus on its heading, then the scroll. */
  readonly onOpenPanel: (panel: PanelDestination) => void
}

/**
 * One destination of the event page as a tile: its name, its glyph, the line that says what is
 * there, and the kind of control it has to be. The "Maintenant" card and the overview draw the
 * same destination the same way; only the size differs.
 */
export function EventDestinationTile({
  destination,
  size,
  event,
  albumUrl,
  onOpenPanel,
}: EventDestinationTileProps) {
  const t = useTranslations()
  const base = `/admin/events/${event.slug}`
  const hints = t.admin.overviewHints
  // Each panel's glyph has the panel's own name.
  const panel = (name: PanelDestination, label: string, hint: string) => (
    <PanelTile size={size} glyph={name} hint={hint} onOpen={() => onOpenPanel(name)}>
      {label}
    </PanelTile>
  )

  switch (destination) {
    case 'moderate':
      return (
        <RouteTile
          size={size}
          glyph="moderate"
          to={`${base}/moderation`}
          count={event.pendingCount}
          hint={
            event.pendingCount > 0
              ? t.admin.moderationWaiting(event.pendingCount)
              : t.admin.moderationNothingWaiting
          }
        >
          {t.admin.openModeration}
        </RouteTile>
      )
    case 'wall':
      return (
        <RouteTile
          size={size}
          glyph="wall"
          to={`/e/${event.slug}/display`}
          newTab
          hint={event.status === 'draft' ? t.admin.wallDraftHint : t.admin.wallTileHint}
        >
          {t.admin.openWall}
        </RouteTile>
      )
    case 'download':
      return (
        <DownloadTile size={size} glyph="album" href={albumUrl} hint={t.admin.downloadHint}>
          {t.admin.download}
        </DownloadTile>
      )
    case 'stats':
      return (
        <RouteTile size={size} glyph="stats" to={`${base}/stats`} hint={hints.stats}>
          {t.admin.stats.tile}
        </RouteTile>
      )
    case 'settings':
      return (
        <RouteTile size={size} glyph="settings" to={`${base}/settings`} hint={hints.settings}>
          {t.admin.settings}
        </RouteTile>
      )
    // In the "Maintenant" card it is the action ("Partager l'album"); in the overview, the panel.
    case 'share':
      return panel(
        'share',
        size === 'large' ? t.admin.afterShare : t.admin.shareLink,
        t.admin.shareHint,
      )
    case 'guestbook':
      return panel('guestbook', t.guestbookHost.title, hints.guestbook)
    case 'challenge':
      return panel('challenge', t.challenge.title, hints.challenge)
    case 'missions':
      return panel('missions', t.admin.missionsTitle, hints.missions)
    case 'guests':
      return panel('guests', t.admin.guestList, t.admin.guests(event.guestCount))
    case 'moderators':
      return panel('moderators', t.admin.moderators, hints.moderators)
    case 'bestOf':
      return panel('bestOf', t.admin.bestOf, hints.bestOf)
    case 'book':
      return panel('book', t.admin.book, hints.book)
  }
}
