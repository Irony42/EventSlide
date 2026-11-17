import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import {
  aGallery,
  aGalleryPhoto,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { aRevealBlock } from '../../testing/revealFixtures'
import { GalleryPage } from './GalleryPage'
import type { RevealDto } from '../../lib/api/dto'

/**
 * The shared gallery of a disposable-camera evening (spec 23): the look is on the pictures it draws and
 * never on a download, and a link opened before the reveal says when the photographs open.
 */
const TOKEN = 'Q'.repeat(43)

const render = (reveal: RevealDto | undefined, held = false) =>
  renderWithProviders(<GalleryPage />, {
    api: fakeApi({
      gallery: vi.fn(async () => aGallery(reveal === undefined ? {} : { reveal })),
      galleryPhotos: vi.fn(async () => ({
        items: held ? [] : [aGalleryPhoto({ id: 'a' }), aGalleryPhoto({ id: 'b' })],
        nextCursor: null,
        ...(reveal === undefined ? {} : { reveal }),
      })),
    }),
    route: `/g/${TOKEN}`,
    path: '/g/:token',
  })

describe('the shared gallery with the film look (spec 23)', () => {
  it('puts the look on every tile and says the download is the original', async () => {
    const { container } = render(aRevealBlock({ revealed: true, film: true }))

    expect(await screen.findAllByRole('button', { name: /Agrandir la photo/ })).toHaveLength(2)
    const images = [...container.querySelectorAll('img')]
    expect(images).toHaveLength(2)
    for (const image of images) expect(image).toHaveClass('filmLook')
    expect(screen.getByText(fr.reveal.galleryOriginal)).toBeVisible()
  })

  it('puts the look on the photograph in the viewer, and keeps the download a plain link to the original', async () => {
    render(aRevealBlock({ revealed: true, film: true }))
    const tiles = await screen.findAllByRole('button', { name: /Agrandir la photo/ })
    await userEvent.click(tiles[0]!)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('img')).toHaveClass('filmLook')
    // The link goes to the original rendition, which the look never touches.
    expect(screen.getByRole('link', { name: fr.gallery.download })).toHaveAttribute(
      'href',
      expect.stringContaining('/original'),
    )
  })

  it('draws no look and no note on an evening without the film look', async () => {
    const { container } = render(aRevealBlock({ revealed: true, film: false }))

    expect(await screen.findAllByRole('button', { name: /Agrandir la photo/ })).toHaveLength(2)
    expect(container.querySelector('.filmLook')).toBeNull()
    expect(screen.queryByText(fr.reveal.galleryOriginal)).toBeNull()
  })

  it('draws no look and no note for a server that predates the reveal block', async () => {
    const { container } = render(undefined)

    expect(await screen.findAllByRole('button', { name: /Agrandir la photo/ })).toHaveLength(2)
    expect(container.querySelector('.filmLook')).toBeNull()
    expect(screen.queryByText(fr.reveal.galleryOriginal)).toBeNull()
  })

  it('says when the photographs open, instead of "no photo yet", for a link opened before the reveal', async () => {
    render(aRevealBlock({ film: true }), true)

    expect(await screen.findByTestId('gallery-reveal')).toHaveTextContent(
      /^Les photos seront révélées le /,
    )
    expect(screen.queryByText(fr.gallery.empty)).toBeNull()
    // The note about the original is true before the reveal as well.
    expect(screen.getByText(fr.reveal.galleryOriginal)).toBeVisible()
  })

  it('says it will be soon when the host reveals by hand', async () => {
    render(aRevealBlock({ atMs: null }), true)

    expect(await screen.findByText(fr.reveal.galleryHeldSoon)).toBeVisible()
  })

  it('is the ordinary empty album when the evening is revealed and nothing was published', async () => {
    render(aRevealBlock({ revealed: true }), true)

    expect(await screen.findByText(fr.gallery.empty)).toBeVisible()
    expect(screen.queryByTestId('gallery-reveal')).toBeNull()
  })
})
