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
