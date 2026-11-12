import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventDestinationTile } from './EventDestinationTile'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { anEventDto, renderWithProviders } from '../../../testing/renderWithProviders'
import type { EventDestination } from '../eventOverview'
import type { EventDto } from '../../../lib/api/dto'
import type { Locale } from '../../../lib/i18n/locale'
import type { TileSize } from './EventTiles'

const ALBUM = '/api/events/camille-et-sacha/album.zip'

const render = (
  destination: EventDestination,
  {
    size = 'small',
    event = {},
    locale = 'fr',
    onOpenPanel = vi.fn(),
  }: {
    readonly size?: TileSize
    readonly event?: Partial<EventDto>
    readonly locale?: Locale
    readonly onOpenPanel?: () => void
  } = {},
) =>
  renderWithProviders(
    <EventDestinationTile
      destination={destination}
      size={size}
      event={anEventDto(event)}
      albumUrl={ALBUM}
      onOpenPanel={onOpenPanel}
    />,
    { locale },
  )

describe('a destination of the event page, as a tile', () => {
  it.each([
    ['moderate', fr.admin.openModeration, '/admin/events/camille-et-sacha/moderation'],
    ['wall', fr.admin.openWall, '/e/camille-et-sacha/display'],
    ['stats', fr.admin.stats.tile, '/admin/events/camille-et-sacha/stats'],
    ['settings', fr.admin.settings, '/admin/events/camille-et-sacha/settings'],
    ['download', fr.admin.download, ALBUM],
  ] as const)(
    'links %s to where it has always gone, by its own name',
    (destination, name, href) => {
      render(destination)

      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    },
  )

  it('offers one way into the moderation queue: the same address on a phone and on a laptop', () => {
    render('moderate')

    // The queue's page opens the phone's screen by itself (`lib/moderationView.ts`).
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/moderation',
    )
  })

  it('says how many photos wait on the queue’s tile, in words and on a badge', () => {
    render('moderate', { event: { pendingCount: 3 } })

    const tile = screen.getByRole('link', { name: fr.admin.openModeration })
    expect(tile).toHaveAccessibleDescription(fr.admin.moderationWaiting(3))
    expect(within(tile).getByText('3')).toBeInTheDocument()
    expect(tile).toHaveAttribute('data-attention')
  })

  it('says nothing waits, with no badge, when the queue is empty', () => {
    render('moderate', { event: { pendingCount: 0 } })

    const tile = screen.getByRole('link', { name: fr.admin.openModeration })
    expect(tile).toHaveAccessibleDescription(fr.admin.moderationNothingWaiting)
    expect(tile).not.toHaveAttribute('data-attention')
  })

  // The wall is the projector's screen and has no way back to the console, so the console
  // stays in its own tab and the wall opens beside it (navigation pass, decision 5).
  it('opens the wall in a tab of its own, without handing it the console, and says so aloud', () => {
    render('wall', { event: { status: 'live' } })

    const wall = screen.getByRole('link', { name: fr.admin.openWall })
    expect(wall).toHaveAttribute('target', '_blank')
    expect(wall).toHaveAttribute('rel', 'noopener')
    expect(wall).toHaveAccessibleDescription(`${fr.about.opensInNewTab} ${fr.admin.wallTileHint}`)
  })

  // The projector is plugged in before the doors open (HOT-1).
  it('offers the wall from the draft on, saying it will light up by itself', () => {
    render('wall', { event: { status: 'draft' } })

    const wall = screen.getByRole('link', { name: fr.admin.openWall })
    expect(within(wall).getByText(fr.admin.wallDraftHint)).toBeInTheDocument()
  })

  it('hands the album to the browser as a download rather than navigating to it', () => {
    render('download')

    expect(screen.getByRole('link', { name: fr.admin.download })).toHaveAttribute('download')
  })

  it('opens a panel of the page with a button, since it moves within the page', async () => {
    const onOpenPanel = vi.fn()
    render('guests', { event: { guestCount: 2 }, onOpenPanel })

    const tile = screen.getByRole('button', { name: fr.admin.guestList })
    expect(tile).toHaveAccessibleDescription(fr.admin.guests(2))
    await userEvent.click(tile)

    expect(onOpenPanel).toHaveBeenCalledWith('guests')
  })

  it('calls the album link the action in the first card, and the panel in the overview', () => {
    const { unmount } = render('share', { size: 'large' })
    expect(screen.getByRole('button', { name: fr.admin.afterShare })).toBeInTheDocument()
    unmount()

    render('share', { size: 'small' })
    expect(screen.getByRole('button', { name: fr.admin.shareLink })).toBeInTheDocument()
  })

  it('names each tile by its words alone: the glyph and the badge are decoration', () => {
    const { container } = render('moderate', { event: { pendingCount: 4 } })

    const glyph = container.querySelector('svg')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(glyph).toHaveAttribute('focusable', 'false')
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toBeInTheDocument()
  })

  it('draws its size as an attribute the stylesheet reads, and nothing else', () => {
    render('stats', { size: 'large' })

    expect(screen.getByRole('link', { name: fr.admin.stats.tile })).toHaveAttribute(
      'data-size',
      'large',
    )
  })

  it('reads in the language on screen', () => {
    render('wall', { locale: 'de' })

    expect(screen.getByRole('link', { name: de.admin.openWall })).toHaveAttribute(
      'href',
      '/e/camille-et-sacha/display',
    )
  })
})
