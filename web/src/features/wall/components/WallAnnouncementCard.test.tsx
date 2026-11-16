import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { aWallAnnouncement } from '../../../testing/renderWithProviders'
import styles from './WallAnnouncementCard.module.css'
import { WallAnnouncementCard } from './WallAnnouncementCard'

const mount = (text = 'Le gâteau arrive') =>
  render(
    <LocaleProvider initialLocale="fr">
      <WallAnnouncementCard announcement={aWallAnnouncement(0, { text })} />
    </LocaleProvider>,
  )

describe('WallAnnouncementCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prints the host’s sentence as it was written', () => {
    mount('Discours à 21 h <b>vite</b>')

    expect(screen.getByText('Discours à 21 h <b>vite</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('says it once to a screen reader and hides the visible copy from the tree', () => {
    const { container } = mount()

    expect(screen.getByRole('status')).toHaveTextContent(
      fr.wall.announcementSay('Le gâteau arrive'),
    )
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('Le gâteau arrive')
  })

  it('enters with a fade, unless the browser asks for no motion', () => {
    const { container, unmount } = mount()
    expect(container.firstElementChild).toHaveClass(styles['enters'] ?? 'enters')
    unmount()

    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )
    const reduced = mount()

    expect(reduced.container.firstElementChild).not.toHaveClass(styles['enters'] ?? 'enters')
  })
})
