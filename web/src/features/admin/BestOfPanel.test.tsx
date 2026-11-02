import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { BestOfPanel } from './BestOfPanel'
import type { Api } from '../../lib/api/client'

const SLUG = 'camille-et-sacha'

const render = (api: Api, canStar = true) =>
  renderWithProviders(<BestOfPanel slug={SLUG} canStar={canStar} />, { api })

describe('BestOfPanel', () => {
  it('invites the host to star photos, and offers no ZIP, when there is no favourite', async () => {
    render(fakeApi())

    expect(await screen.findByText(fr.admin.bestOfNone)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.bestOfDownload })).toBeDisabled()
  })

  it('shows the server count and links the ZIP of the favourites', async () => {
    render(fakeApi({ highlights: vi.fn(async () => ({ count: 12 })) }))

    expect(await screen.findByText(fr.admin.bestOfCount(12))).toBeVisible()
    expect(screen.getByRole('link', { name: fr.admin.bestOfDownload })).toHaveAttribute(
      'href',
      `/api/events/${SLUG}/best-of.zip`,
    )
  })

  it('pre-selects the twenty most liked, says so, and reads the count again', async () => {
    const highlights = vi.fn(async () => ({ count: 0 }))
    const preselectHighlights = vi.fn(async () => ({ added: 3 }))
    render(fakeApi({ highlights, preselectHighlights }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bestOfPreselect }))

    await waitFor(() => expect(preselectHighlights).toHaveBeenCalledWith(SLUG, 20))
    expect(await screen.findByText(fr.admin.bestOfPreselected(20))).toBeVisible()
    await waitFor(() => expect(highlights).toHaveBeenCalledTimes(2))
  })

  it('says when the pre-selection had nothing to add', async () => {
    render(fakeApi({ preselectHighlights: vi.fn(async () => ({ added: 0 })) }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bestOfPreselect }))

    expect(await screen.findByText(fr.admin.bestOfPreselectNothing)).toBeVisible()
  })

  it('does not offer the pre-selection where the event can no longer be moderated', async () => {
    render(fakeApi(), false)

    await screen.findByText(fr.admin.bestOfNone)
    expect(screen.queryByRole('button', { name: fr.admin.bestOfPreselect })).toBeNull()
  })

  it('says why the pre-selection failed', async () => {
    render(
      fakeApi({
        preselectHighlights: vi.fn(async () => {
          throw new ApiError(409, 'photo.illegalTransition')
        }),
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bestOfPreselect }))

    expect(await screen.findByText(fr.errors['photo.illegalTransition'])).toBeVisible()
  })

  it('renders nothing against a server that does not know the routes', async () => {
    const highlights = vi.fn(async () => {
      throw new ApiError(404, 'request.notFound')
    })
    render(fakeApi({ highlights }))

    await waitFor(() => expect(highlights).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('heading', { name: fr.admin.bestOf })).toBeNull())
    expect(screen.queryByText(fr.admin.bestOfHint)).toBeNull()
    expect(screen.queryByText(fr.admin.bestOfNone)).toBeNull()
  })

  it('keeps an absent event an error rather than hiding the panel', async () => {
    render(
      fakeApi({
        highlights: vi.fn(async () => {
          throw new ApiError(404, 'event.notFound')
        }),
      }),
    )

    expect(await screen.findByText(fr.errors['event.notFound'])).toBeVisible()
  })
})

describe('BestOfPanel, the highlight video', () => {
  const reel = (status: string, extra = {}) => ({
    status,
    photoCount: 5,
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...extra,
  })
  const withReel = (r: unknown, more: Partial<Api> = {}) =>
    fakeApi({ highlights: vi.fn(async () => ({ count: 5, reel: r })), ...more } as Partial<Api>)

  it('offers no video without a favourite', async () => {
    render(fakeApi())
    await screen.findByText(fr.admin.bestOfNone)
    expect(screen.queryByText(fr.admin.reelTitle)).toBeNull()
  })

  it('asks for the video and says it was started', async () => {
    const requestReel = vi.fn(async () => reel('queued'))
    render(withReel(null, { requestReel } as Partial<Api>))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.reelCreate }))

    await waitFor(() => expect(requestReel).toHaveBeenCalledWith(SLUG))
    expect(await screen.findByText(fr.admin.reelAsked)).toBeVisible()
  })

  it.each([
    ['queued', fr.admin.reelQueued],
    ['running', fr.admin.reelRunning],
    ['stale', fr.admin.reelStale],
  ])('says the video is %s', async (status, text) => {
    render(withReel(reel(status)))
    expect(await screen.findByText(text)).toBeVisible()
  })

  it('disables the button while the video is made', async () => {
    render(withReel(reel('running')))
    await screen.findByText(fr.admin.reelRunning)
    expect(screen.getByRole('button', { name: fr.admin.reelRedo })).toBeDisabled()
  })

  it('reads the state again every three seconds while it is made', async () => {
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    try {
      const highlights = vi.fn(async () => ({ count: 5, reel: reel('running') }))
      render(fakeApi({ highlights } as Partial<Api>))
      await screen.findByText(fr.admin.reelRunning)
      await waitFor(() => expect(highlights.mock.calls.length).toBeGreaterThan(1), {
        timeout: 5000,
      })
    } finally {
      visible.mockRestore()
    }
  }, 10000)

  it('explains a failure with its own code, and a generic sentence for an unknown one', async () => {
    const { unmount } = render(withReel(reel('failed', { failureCode: 'reel.timedOut' })))
    expect(await screen.findByText(fr.errors['reel.timedOut'])).toBeVisible()
    unmount()
    render(withReel(reel('failed', { failureCode: 'who.knows' })))
    expect(await screen.findByText(fr.admin.reelFailed)).toBeVisible()
  })

  it('plays and links the finished video', async () => {
    const { container } = render(withReel(reel('done', { durationMs: 20000, byteSize: 9 })))

    expect(await screen.findByText(fr.admin.reelReady(5))).toBeVisible()
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      `/api/events/${SLUG}/highlights/reel.mp4`,
    )
    expect(screen.getByRole('link', { name: fr.admin.reelDownload })).toBeVisible()
  })

  it('says why a refusal happened', async () => {
    render(
      withReel(null, {
        requestReel: vi.fn(async () => {
          throw new ApiError(409, 'reel.notEnoughPhotos')
        }),
      } as Partial<Api>),
    )
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.reelCreate }))
    expect(await screen.findByText(fr.errors['reel.notEnoughPhotos'])).toBeVisible()
  })

  it('removes the video step when the server has no transcoder', async () => {
    render(
      withReel(null, {
        requestReel: vi.fn(async () => {
          throw new ApiError(500, 'reel.transcoderUnavailable')
        }),
      } as Partial<Api>),
    )
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.reelCreate }))
    await waitFor(() => expect(screen.queryByText(fr.admin.reelTitle)).toBeNull())
  })
})
