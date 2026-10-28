import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { EventActionLinks } from './EventActionLinks'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import type { EventStatus } from '../../../lib/api/dto'
import type { Locale } from '../../../lib/i18n/locale'

const ALBUM = '/api/events/camille-et-sacha/album.zip'

const render = (status: EventStatus = 'live', locale: Locale = 'fr') =>
  renderWithProviders(
    <EventActionLinks slug="camille-et-sacha" status={status} albumUrl={ALBUM} />,
    { locale },
  )

const priorityOf = (name: string): string | null =>
  screen.getByRole('link', { name }).getAttribute('data-priority')

describe('EventActionLinks', () => {
  it('links every action to where it has always gone, by its own name', () => {
    render()

    const hrefs = new Map([
      [fr.admin.openWall, '/e/camille-et-sacha/display'],
      [fr.admin.openModeration, '/admin/events/camille-et-sacha/moderation'],
      [fr.mobileModeration.title, '/admin/events/camille-et-sacha/moderation/mobile'],
      [fr.admin.settings, '/admin/events/camille-et-sacha/settings'],
      [fr.admin.download, ALBUM],
    ])
    expect(screen.getAllByRole('link')).toHaveLength(hrefs.size)
    for (const [name, href] of hrefs) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })

  it('marks the wall and the moderation queue as the primary actions, and the rest as secondary', () => {
    render()

    expect(priorityOf(fr.admin.openWall)).toBe('primary')
    expect(priorityOf(fr.admin.openModeration)).toBe('primary')
    expect(priorityOf(fr.mobileModeration.title)).toBe('secondary')
    expect(priorityOf(fr.admin.settings)).toBe('secondary')
    // The ZIP is a utility: it must never rank with the two actions the evening turns on.
    expect(priorityOf(fr.admin.download)).toBe('secondary')
  })

  it('keeps every action a link and none a button, so it can be opened in a new tab', () => {
    render()

    expect(screen.queryAllByRole('button')).toEqual([])
    // Same-tab navigation, as before: no tile forces a new window on the host.
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('target')
    }
  })

  it('hands the album to the browser as a download rather than navigating to it', () => {
    render()

    expect(screen.getByRole('link', { name: fr.admin.download })).toHaveAttribute('download')
    expect(screen.getByRole('link', { name: fr.admin.openWall })).not.toHaveAttribute('download')
  })

  it('names each link by its words alone: the glyph is decoration', () => {
    const { container } = render()

    // The exact-name queries above would already fail if a glyph leaked into the name;
    // this one says why: every drawing is hidden from assistive technology.
    const glyphs = container.querySelectorAll('svg')
    expect(glyphs).toHaveLength(5)
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true')
      expect(glyph).toHaveAttribute('focusable', 'false')
    }
    for (const link of screen.getAllByRole('link')) {
      expect(within(link).getAllByText(/\S/)).toHaveLength(1)
    }
  })

  it('offers no wall before the event is live, but the moderation queue is already there', () => {
    render('draft')

    expect(screen.queryByRole('link', { name: fr.admin.openWall })).toBeNull()
    expect(priorityOf(fr.admin.openModeration)).toBe('primary')
  })

  it('keeps the wall on once the event is closed, because the projector is usually still on', () => {
    render('closed')

    expect(priorityOf(fr.admin.openWall)).toBe('primary')
  })

  it('leaves only the settings and the album once the event is archived', () => {
    render('archived')

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      fr.admin.settings,
      fr.admin.download,
    ])
  })

  it('reads in the language on screen', () => {
    render('live', 'de')

    expect(screen.getByRole('link', { name: de.admin.openWall })).toHaveAttribute(
      'href',
      '/e/camille-et-sacha/display',
    )
    expect(screen.getByRole('link', { name: de.admin.download })).toHaveAttribute('href', ALBUM)
  })
})
