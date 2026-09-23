import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { en } from '../../lib/i18n/en'
import {
  aGallery,
  aGalleryPhoto,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { GalleryPage } from './GalleryPage'
import type { Api } from '../../lib/api/client'

const TOKEN = 'Q'.repeat(43)

const render = (api: Api, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(<GalleryPage />, {
    api,
    route: `/g/${TOKEN}`,
    path: '/g/:token',
    locale,
  })

const refusing = (code: string, status: number): Partial<Api> => ({
  gallery: vi.fn(async () => {
    throw new ApiError(status, code)
  }),
})

describe('GalleryPage', () => {
  it('says the album is opening while the first answer is on its way', () => {
    render(fakeApi({ gallery: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.gallery.opening)
  })

  it('opens onto the event, its size and its expiry, with the token it was given', async () => {
    const api = fakeApi()
    render(api)

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.getByText(fr.gallery.photoCount(2))).toBeVisible()
    expect(screen.getByText(fr.gallery.privacyNote)).toBeVisible()
    expect(api.gallery).toHaveBeenCalledWith(TOKEN, expect.anything())
  })

  it('shows one tile per published photograph, each named for what it does', async () => {
    render(fakeApi())

    const tiles = await screen.findAllByRole('button', { name: /Agrandir la photo/ })
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      fr.gallery.openPhoto(1),
      fr.gallery.openPhoto(2),
    ])
  })

  it('offers the whole album as one download, by a plain link the browser saves', async () => {
    render(
      fakeApi({
        gallery: vi.fn(async () =>
          aGallery({ archiveUrl: '/api/gallery-media/l/album.zip?e=1&s=x' }),
        ),
      }),
    )

    const link = await screen.findByRole('link', { name: fr.gallery.downloadAll })
    expect(link).toHaveAttribute('href', '/api/gallery-media/l/album.zip?e=1&s=x')
    expect(link).toHaveAttribute('download')
  })

  it('opens a photograph larger, with its caption and its full-resolution download', async () => {
    render(
      fakeApi({
        galleryPhotos: vi.fn(async () => ({
          items: [aGalleryPhoto({ id: 'p1', caption: 'Les confettis !' })],
          nextCursor: null,
        })),
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: fr.gallery.openPhoto(1) }))

    const dialog = screen.getByRole('dialog', { name: fr.gallery.viewerTitle(1, 2) })
    expect(within(dialog).getByRole('img', { name: 'Les confettis !' })).toHaveAttribute(
      'src',
      '/api/gallery-media/link-1/p1/display?e=1&s=b',
    )
    const download = within(dialog).getByRole('link', { name: fr.gallery.download })
    expect(download).toHaveAttribute('href', '/api/gallery-media/link-1/p1/original?e=1&s=c')
    expect(download).toHaveAttribute('download')
  })

  it('names a photograph with no caption by its place in the album', async () => {
    render(fakeApi())

    await userEvent.click(await screen.findByRole('button', { name: fr.gallery.openPhoto(2) }))

    expect(screen.getByRole('img', { name: fr.gallery.photoAlt(2) })).toBeVisible()
  })

  it('marks a clip as a video and downloads it as one', async () => {
    render(
      fakeApi({
        galleryPhotos: vi.fn(async () => ({
          items: [aGalleryPhoto({ id: 'c1', kind: 'clip' })],
          nextCursor: null,
        })),
      }),
    )

    expect(await screen.findByText(fr.gallery.clipBadge)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.gallery.openPhoto(1) }))
    expect(screen.getByRole('link', { name: fr.gallery.downloadClip })).toBeVisible()
  })

  it('says so when nothing has been published yet, and offers no empty download', async () => {
    render(
      fakeApi({
        gallery: vi.fn(async () => aGallery({ photoCount: 0 })),
        galleryPhotos: vi.fn(async () => ({ items: [], nextCursor: null })),
      }),
    )

    expect(await screen.findByRole('heading', { name: fr.gallery.empty })).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.gallery.downloadAll })).toBeNull()
  })

  it('loads the next page with the cursor the server sealed, and keeps what is on screen', async () => {
    const galleryPhotos = vi
      .fn<Api['galleryPhotos']>()
      .mockResolvedValueOnce({ items: [aGalleryPhoto({ id: 'p1' })], nextCursor: 'sealed.1' })
      .mockResolvedValueOnce({ items: [aGalleryPhoto({ id: 'p2' })], nextCursor: null })
    render(fakeApi({ galleryPhotos }))

    await userEvent.click(await screen.findByRole('button', { name: fr.gallery.loadMore }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: /Agrandir/ })).toHaveLength(2))
    expect(galleryPhotos).toHaveBeenLastCalledWith(TOKEN, 'sealed.1')
    expect(screen.queryByRole('button', { name: fr.gallery.loadMore })).toBeNull()
  })

  it('answers a dead link with one neutral screen', async () => {
    render(fakeApi(refusing('gallery.notAvailable', 404)))

    expect(
      await screen.findByRole('heading', { level: 1, name: fr.gallery.unavailableTitle }),
    ).toBeVisible()
    expect(screen.getByText(fr.gallery.unavailableHint)).toBeVisible()
  })

  it('asks for the password, then opens the album with it', async () => {
    let unlocked = false
    const api = fakeApi({
      gallery: vi.fn(async () => {
        if (!unlocked) throw new ApiError(401, 'gallery.passwordRequired')
        return aGallery()
      }),
      unlockGallery: vi.fn(async () => {
        unlocked = true
      }),
    })
    render(api)

    await userEvent.type(
      await screen.findByLabelText(fr.gallery.passwordLabel),
      'les mariés de juin',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.gallery.unlock }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(api.unlockGallery).toHaveBeenCalledWith(TOKEN, 'les mariés de juin')
  })

  it('says the password is wrong, on the field, and keeps the form', async () => {
    render(
      fakeApi({
        ...refusing('gallery.passwordRequired', 401),
        unlockGallery: vi.fn(async () => {
          throw new ApiError(401, 'gallery.wrongPassword')
        }),
      }),
    )

    await userEvent.type(
      await screen.findByLabelText(fr.gallery.passwordLabel),
      'mauvais mot de passe',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.gallery.unlock }))

    expect(await screen.findByText(fr.errors['gallery.wrongPassword'])).toBeVisible()
    expect(screen.getByLabelText(fr.gallery.passwordLabel)).toBeVisible()
  })

  it('shows the neutral screen when the link dies while the password form is open', async () => {
    render(
      fakeApi({
        ...refusing('gallery.passwordRequired', 401),
        unlockGallery: vi.fn(async () => {
          throw new ApiError(404, 'gallery.notAvailable')
        }),
      }),
    )

    await userEvent.type(
      await screen.findByLabelText(fr.gallery.passwordLabel),
      'les mariés de juin',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.gallery.unlock }))

    expect(await screen.findByRole('heading', { name: fr.gallery.unavailableTitle })).toBeVisible()
  })

  it('offers a retry for a failure that is not the link’s', async () => {
    const gallery = vi
      .fn<Api['gallery']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(aGallery())
    render(fakeApi({ gallery }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
  })

  it('tells a crawler reading the markup not to index or follow the page', async () => {
    render(fakeApi())
    await screen.findByRole('heading', { level: 1 })

    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    )
  })

  it('speaks the reader’s language and leaves the host’s words alone', async () => {
    render(fakeApi(), 'en')

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.getByText(en.gallery.photoCount(2))).toBeVisible()
  })
})
