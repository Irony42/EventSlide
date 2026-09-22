import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { ApiError } from '../../../lib/http'
import { aGallery, aGalleryPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { GALLERY_REFRESH_MS, useGallery } from './useGallery'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'

const TOKEN = 'Q'.repeat(43)

const mount = (api: Api, refreshEveryMs?: number) =>
  renderHook(() => useGallery(TOKEN, refreshEveryMs === undefined ? {} : { refreshEveryMs }), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    ),
  })

describe('useGallery', () => {
  it('re-reads the album before the hour its URLs are signed for runs out', () => {
    // The grants live an hour (`GALLERY_GRANT_TTL_MS` on the server); a refresh after it
    // would leave a guest holding links that answer 404, which reads as a revoked album.
    expect(GALLERY_REFRESH_MS).toBeLessThan(60 * 60 * 1000)
  })

  it('replaces what is on screen with freshly signed URLs, keeping as many pages', async () => {
    let round = 0
    const galleryPhotos = vi.fn<Api['galleryPhotos']>(async (_token, cursor) => {
      const suffix = round
      return cursor === null
        ? { items: [aGalleryPhoto({ id: 'p1', previewUrl: `/p1?r=${suffix}` })], nextCursor: 'c1' }
        : { items: [aGalleryPhoto({ id: 'p2', previewUrl: `/p2?r=${suffix}` })], nextCursor: null }
    })
    const { result } = mount(fakeApi({ galleryPhotos }), 40)
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    await act(async () => result.current.loadMore())
    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'p2'])

    round = 1

    await waitFor(() =>
      expect(result.current.items.map((item) => item.previewUrl)).toEqual(['/p1?r=1', '/p2?r=1']),
    )
  })

  it('shows the neutral screen when the link dies while the album is open', async () => {
    let revoked = false
    const api = fakeApi({
      gallery: vi.fn(async () => {
        if (revoked) throw new ApiError(404, 'gallery.notAvailable')
        return aGallery()
      }),
    })
    const { result } = mount(api, 40)
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    revoked = true

    await waitFor(() => expect(result.current.phase).toBe('unavailable'))
  })

  it('keeps the album on screen through a refresh the network dropped', async () => {
    let offline = false
    const api = fakeApi({
      gallery: vi.fn(async () => {
        if (offline) throw ApiError.network()
        return aGallery()
      }),
    })
    const { result } = mount(api, 20)
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    offline = true
    await waitFor(() => expect(vi.mocked(api.gallery).mock.calls.length).toBeGreaterThan(2))

    expect(result.current.phase).toBe('ready')
  })

  it('reports a page that failed to load without losing the pages already shown', async () => {
    const galleryPhotos = vi
      .fn<Api['galleryPhotos']>()
      .mockResolvedValueOnce({ items: [aGalleryPhoto({ id: 'p1' })], nextCursor: 'c1' })
      .mockRejectedValueOnce(ApiError.network())
    const { result } = mount(fakeApi({ galleryPhotos }))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => result.current.loadMore())

    expect(result.current.items.map((item) => item.id)).toEqual(['p1'])
    expect(result.current.failure).toBeInstanceOf(ApiError)
    expect(result.current.hasMore).toBe(true)
  })

  it('treats a password it was never asked for as nothing to do on a page it cannot load', async () => {
    const galleryPhotos = vi
      .fn<Api['galleryPhotos']>()
      .mockResolvedValueOnce({ items: [aGalleryPhoto({ id: 'p1' })], nextCursor: 'c1' })
      .mockRejectedValueOnce(new ApiError(401, 'gallery.passwordRequired'))
    const { result } = mount(fakeApi({ galleryPhotos }))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => result.current.loadMore())

    // The unlock ran out between two pages: back to the password form, not an error.
    expect(result.current.phase).toBe('locked')
  })
})
