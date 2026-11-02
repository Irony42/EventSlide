import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { en } from '../../lib/i18n/en'
import type { Api } from '../../lib/api/client'
import type { AlbumBookDto } from '../../lib/api/dto'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { AlbumBookPanel } from './AlbumBookPanel'
import { BOOK_POLL_MS } from './hooks/useAlbumBook'

const SLUG = 'camille-et-sacha'
const AT = '2026-06-14T20:00:00.000Z'

const book = (
  status: 'queued' | 'running' | 'done' | 'failed' | 'stale',
  extra: Partial<Extract<AlbumBookDto, { status: string; options: unknown }>> = {},
): AlbumBookDto => ({
  status,
  options: {
    title: 'Mariage',
    subtitle: '',
    language: 'fr',
    layout: 'one',
    showAuthors: true,
    showCaptions: true,
  },
  requestedAt: AT,
  doneAt: null,
  photoCount: null,
  skippedCount: null,
  pageCount: null,
  byteSize: null,
  expiresAt: null,
  failureCode: null,
  staleReason: null,
  ...extra,
})

const DONE = book('done', {
  doneAt: AT,
  photoCount: 42,
  pageCount: 44,
  byteSize: 12_000_000,
  expiresAt: '2026-06-21T20:00:00.000Z',
})

const render = (api: Api, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(<AlbumBookPanel slug={SLUG} defaultTitle="Camille & Sacha" />, {
    api,
    locale,
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('AlbumBookPanel', () => {
  it('offers the form, titled with the event name, when no book was ever asked for', async () => {
    render(fakeApi())

    expect(await screen.findByRole('button', { name: fr.admin.bookCreate })).toBeVisible()
    expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Camille & Sacha')
  })

  it('sends what the host chose, and reads the book again', async () => {
    const albumBook = vi.fn(async () => ({ status: 'none' as const }))
    const requestAlbumBook = vi.fn(async () => book('queued'))
    render(fakeApi({ albumBook, requestAlbumBook }))

    const title = await screen.findByLabelText(fr.admin.bookTitle)
    await userEvent.clear(title)
    await userEvent.type(title, 'Notre mariage')
    await userEvent.type(screen.getByLabelText(new RegExp(fr.admin.bookSubtitle)), '14 juin')
    await userEvent.selectOptions(screen.getByLabelText(fr.admin.bookLayout), 'four')
    await userEvent.click(screen.getByLabelText(fr.admin.bookShowAuthors))
    await userEvent.click(screen.getByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() =>
      expect(requestAlbumBook).toHaveBeenCalledWith(SLUG, {
        title: 'Notre mariage',
        subtitle: '14 juin',
        layout: 'four',
        showAuthors: false,
        showCaptions: true,
      }),
    )
    await waitFor(() => expect(albumBook).toHaveBeenCalledTimes(2))
  })

  it('says the server refusal in the reader language, and keeps the form', async () => {
    render(
      fakeApi({
        requestAlbumBook: vi.fn(async () => {
          throw new ApiError(429, 'book.dailyLimitReached')
        }),
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookCreate }))

    expect(await screen.findByText(fr.errors['book.dailyLimitReached'])).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.bookCreate })).toBeVisible()
  })

  it('shows a book being made as a status, with no form to start a second one', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => book('running')) }))

    expect(await screen.findByText(fr.admin.bookWorking)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.bookCreate })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.bookRebuild })).toBeNull()
  })

  it('asks again while the book is being made, and stops once it is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const albumBook = vi
      .fn<() => Promise<AlbumBookDto>>()
      .mockResolvedValueOnce(book('queued'))
      .mockResolvedValue(DONE)
    render(fakeApi({ albumBook }))
    await screen.findByText(fr.admin.bookWorking)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_POLL_MS + 100)
    })
    expect(await screen.findByRole('link', { name: fr.admin.bookDownload })).toBeVisible()

    const calls = albumBook.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_POLL_MS * 3)
    })
    expect(albumBook).toHaveBeenCalledTimes(calls)
  })

  it('links the finished PDF, says what it holds, and offers to make it again', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE) }))

    const link = await screen.findByRole('link', { name: fr.admin.bookDownload })
    expect(link).toHaveAttribute('href', `/api/events/${SLUG}/book.pdf`)
    expect(screen.getByRole('status')).toHaveTextContent('42 photos')
    expect(screen.getByRole('status')).toHaveTextContent('44 pages')
    expect(screen.getByRole('button', { name: fr.admin.bookRebuild })).toBeVisible()
  })

  it('states the book in English for an English reader', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE) }), 'en')

    expect(await screen.findByRole('link', { name: en.admin.bookDownload })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Your book is ready')
  })

  it('asks before deleting the book, and deletes it once confirmed', async () => {
    const albumBook = vi.fn(async () => DONE)
    const deleteAlbumBook = vi.fn(async () => undefined)
    render(fakeApi({ albumBook, deleteAlbumBook }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookDelete }))
    expect(deleteAlbumBook).not.toHaveBeenCalled()
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: fr.admin.bookDelete }),
    )

    await waitFor(() => expect(deleteAlbumBook).toHaveBeenCalledWith(SLUG))
    await waitFor(() => expect(albumBook).toHaveBeenCalledTimes(2))
  })

  it('explains a stale book and offers a new one, with no download', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => book('stale')) }))

    expect(await screen.findByText(fr.admin.bookStale)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.admin.bookDownload })).toBeNull()
    expect(screen.getByRole('button', { name: fr.admin.bookRebuild })).toBeVisible()
  })

  it('says a failure plainly, and a book that was too large in its own words', async () => {
    const view = render(fakeApi({ albumBook: vi.fn(async () => book('failed')) }))
    expect(await screen.findByText(fr.admin.bookFailed)).toBeVisible()
    view.unmount()

    render(
      fakeApi({
        albumBook: vi.fn(async () => book('failed', { failureCode: 'tooLarge' })),
      }),
    )
    expect(await screen.findByText(fr.admin.bookFailedTooLarge)).toBeVisible()
  })

  it('renders nothing against a server that does not know the routes', async () => {
    const albumBook = vi.fn(async () => {
      throw new ApiError(404, 'request.notFound')
    })
    render(fakeApi({ albumBook }))

    await waitFor(() => expect(albumBook).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(fr.admin.book)).toBeNull())
    expect(screen.queryByText(fr.admin.bookHint)).toBeNull()
  })
})
