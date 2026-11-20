import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { en } from '../../lib/i18n/en'
import type { Api } from '../../lib/api/client'
import type { AlbumBookDto, ThemeAmbiance } from '../../lib/api/dto'
import { aBook, aNoBook, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { AlbumBookPanel, BookForm } from './AlbumBookPanel'
import { BOOK_POLL_MS } from './hooks/useAlbumBook'

const SLUG = 'camille-et-sacha'
const AT = '2026-06-14T20:00:00.000Z'

const DONE = aBook('done', {
  doneAt: AT,
  photoCount: 42,
  pageCount: 44,
  byteSize: 12_000_000,
  selectedCount: 42,
  files: { screen: { byteSize: 12_000_000 } },
  expiresAt: '2026-06-21T20:00:00.000Z',
})

const DONE_WITH_PRINT = aBook('done', {
  doneAt: AT,
  photoCount: 118,
  pageCount: 64,
  byteSize: 38_000_000,
  files: {
    screen: { byteSize: 38_000_000 },
    printInterior: { byteSize: 210_000_000 },
    printCover: { byteSize: 4_000_000 },
  },
  options: { ...DONE.options, printVersion: true, selection: { kind: 'best', target: 120 } },
  albumCounts: { photos: 412, messages: 0 },
  expiresAt: '2026-06-21T20:00:00.000Z',
})

const render = (api: Api, locale: 'fr' | 'en' = 'fr', ambiance: ThemeAmbiance = 'noces') =>
  renderWithProviders(
    <AlbumBookPanel slug={SLUG} defaultTitle="Camille & Sacha" ambiance={ambiance} />,
    { api, locale },
  )

const styleRadio = (name: string) => screen.getByRole('radio', { name: new RegExp(name) })

afterEach(() => {
  vi.useRealTimers()
})

describe('AlbumBookPanel, the form', () => {
  it('offers the form, titled with the event name, when no book was ever asked for', async () => {
    render(fakeApi())

    expect(await screen.findByRole('button', { name: fr.admin.bookCreate })).toBeVisible()
    expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Camille & Sacha')
    expect(screen.getByText(fr.admin.bookStyleFromWall)).toBeVisible()
  })

  it.each([
    ['noces', 'Classique'],
    ['eventslide', 'Classique'],
    ['riviera', 'Magazine'],
    ['cabaret', 'Magazine'],
    ['guinguette', 'Souvenir'],
    ['bivouac', 'Souvenir'],
  ] as const)('opens on the style %s suggests: %s', async (ambiance, name) => {
    render(fakeApi(), 'fr', ambiance)

    await screen.findByRole('button', { name: fr.admin.bookCreate })

    expect(styleRadio(name)).toBeChecked()
  })

  it('lays the three styles out as one radio group, each with its own words', async () => {
    render(fakeApi())
    await screen.findByRole('button', { name: fr.admin.bookCreate })

    const group = screen.getByRole('group', { name: fr.admin.bookStyleLegend })
    const radios = within(group).getAllByRole('radio')

    expect(radios).toHaveLength(3)
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1)
    for (const hint of Object.values(fr.admin.bookStyleHints)) {
      expect(within(group).getByText(hint)).toBeVisible()
    }
    expect(group.querySelectorAll('img[alt=""]')).toHaveLength(3)
  })

  it('offers every photograph when the book holds them, and a selection to length when it does not', async () => {
    const view = render(
      fakeApi({ albumBook: vi.fn(async () => aNoBook({ photos: 100, messages: 0 })) }),
    )
    await screen.findByRole('button', { name: fr.admin.bookCreate })
    expect(
      screen.getByRole('radio', { name: new RegExp(fr.admin.bookSelectionBest) }),
    ).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Toutes les photos/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /Moyenne/ })).toBeNull()
    view.unmount()

    render(fakeApi({ albumBook: vi.fn(async () => aNoBook({ photos: 412, messages: 0 })) }))
    await screen.findByRole('button', { name: fr.admin.bookCreate })
    expect(screen.getByRole('radio', { name: /Toutes les photos/ })).toBeDisabled()
    expect(screen.getByText(fr.admin.bookSelectionAllTooMany(300))).toBeVisible()
    expect(screen.getByRole('radio', { name: /Une sélection/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Moyenne/ })).toBeChecked()
  })

  it('uses the box’s own ceiling, not a number of the page', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aNoBook(
            { photos: 120, messages: 0 },
            { maxPhotos: 100, maxMessages: 60, printVersion: true },
          ),
        ),
      }),
    )
    await screen.findByRole('button', { name: fr.admin.bookCreate })

    expect(screen.getByRole('radio', { name: /Toutes les photos/ })).toBeDisabled()
    expect(screen.getByText(fr.admin.bookSelectionAllTooMany(100))).toBeVisible()
  })

  it('shows the guest book only when there are written messages, and says how many', async () => {
    const view = render(fakeApi())
    await screen.findByRole('button', { name: fr.admin.bookCreate })
    expect(screen.queryByLabelText(fr.admin.bookGuestbook)).toBeNull()
    view.unmount()

    render(fakeApi({ albumBook: vi.fn(async () => aNoBook({ photos: 42, messages: 46 })) }))
    const box = await screen.findByLabelText(fr.admin.bookGuestbook)
    expect(box).toBeChecked()
    expect(screen.getByText(fr.admin.bookGuestbookHint(46, 60))).toBeVisible()
  })

  it('does not offer the printer version when the box does not', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aNoBook(
            { photos: 42, messages: 0 },
            { maxPhotos: 300, maxMessages: 60, printVersion: false },
          ),
        ),
      }),
    )
    await screen.findByRole('button', { name: fr.admin.bookCreate })

    expect(screen.queryByLabelText(fr.admin.bookPrintVersion)).toBeNull()
  })

  it('sends what the host chose, the browser’s zone included, and reads the book again', async () => {
    const albumBook = vi.fn(async () => aNoBook({ photos: 412, messages: 46 }))
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    render(fakeApi({ albumBook, requestAlbumBook }))

    const title = await screen.findByLabelText(fr.admin.bookTitle)
    await userEvent.clear(title)
    await userEvent.type(title, 'Notre mariage')
    await userEvent.type(screen.getByLabelText(new RegExp(fr.admin.bookSubtitle)), '14 juin')
    await userEvent.click(styleRadio('Souvenir'))
    await userEvent.click(screen.getByRole('radio', { name: /Longue/ }))
    await userEvent.click(screen.getByLabelText(fr.admin.bookShowAuthors))
    await userEvent.click(screen.getByLabelText(fr.admin.bookGuestbook))
    await userEvent.click(screen.getByLabelText(fr.admin.bookPrintVersion))
    await userEvent.click(screen.getByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() =>
      expect(requestAlbumBook).toHaveBeenCalledWith(SLUG, {
        title: 'Notre mariage',
        subtitle: '14 juin',
        style: 'souvenir',
        selection: { kind: 'best', target: 200 },
        showAuthors: false,
        showCaptions: true,
        includeGuestbook: false,
        printVersion: true,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    )
    await waitFor(() => expect(albumBook).toHaveBeenCalledTimes(2))
  })

  it('does not submit a choice the album made impossible while the form was open', async () => {
    const requestAlbumBook = vi.fn(async (_slug: string, _body: object) => aBook('queued'))
    const form = (book: AlbumBookDto) => (
      <BookForm
        slug={SLUG}
        book={book}
        defaultTitle="Camille & Sacha"
        ambiance="noces"
        onRequested={() => undefined}
      />
    )
    const view = renderWithProviders(form(aNoBook({ photos: 100, messages: 3 })), {
      api: fakeApi({ requestAlbumBook }),
      locale: 'fr',
    })
    expect(screen.getByRole('radio', { name: /Toutes les photos/ })).toBeChecked()
    expect(screen.getByLabelText(fr.admin.bookGuestbook)).toBeChecked()

    // The same form, kept open, is handed a fresher album: past the book's ceiling, no message left.
    view.rerender(form(aNoBook({ photos: 412, messages: 0 })))
    expect(screen.getByRole('radio', { name: /Une sélection/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() => expect(requestAlbumBook).toHaveBeenCalled())
    expect(requestAlbumBook.mock.calls[0]?.[1]).toMatchObject({
      selection: { kind: 'best', target: 120 },
      includeGuestbook: false,
    })
  })

  it('says only the first messages go in the book when there are more than the book holds, in every language', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aNoBook(
            { photos: 42, messages: 80 },
            { maxPhotos: 300, maxMessages: 60, printVersion: true },
          ),
        ),
      }),
    )

    expect(await screen.findByText(fr.admin.bookGuestbookHint(80, 60))).toHaveTextContent(
      '60 premiers',
    )
    for (const text of [fr, en]) {
      expect(text.admin.bookGuestbookHint(80, 60)).not.toBe(text.admin.bookGuestbookHint(60, 60))
    }
  })

  it('sends every photograph, and no guest book when there is none to print', async () => {
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    render(fakeApi({ requestAlbumBook }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() => expect(requestAlbumBook).toHaveBeenCalled())
    expect(requestAlbumBook.mock.calls[0]).toMatchObject([
      SLUG,
      {
        selection: { kind: 'all' },
        includeGuestbook: false,
        printVersion: false,
        style: 'classique',
      },
    ])
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
})

describe('AlbumBookPanel, the states of a book', () => {
  it('shows a book being made as a status with its style and length, and no form to start a second one', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aBook('running', {
            options: {
              ...DONE.options,
              style: 'magazine',
              selection: { kind: 'best', target: 120 },
            },
          }),
        ),
      }),
    )

    expect(await screen.findByText(fr.admin.bookWorking)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Style Magazine, environ 120 photos')
    expect(screen.queryByRole('button', { name: fr.admin.bookCreate })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.bookRebuild })).toBeNull()
  })

  it('says every photograph for a book that takes them all', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => aBook('queued')) }))

    expect(await screen.findByText(/toutes les photos/)).toBeVisible()
  })

  it('asks again while the book is being made, and stops once it is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const albumBook = vi
      .fn<() => Promise<AlbumBookDto>>()
      .mockResolvedValueOnce(aBook('queued'))
      .mockResolvedValue(DONE)
    render(fakeApi({ albumBook }))
    await screen.findByText(fr.admin.bookWorking)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_POLL_MS + 100)
    })
    expect(
      await screen.findByRole('link', { name: new RegExp(fr.admin.bookDownload) }),
    ).toBeVisible()

    const calls = albumBook.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_POLL_MS * 3)
    })
    expect(albumBook).toHaveBeenCalledTimes(calls)
  })

  it('does not ask again while the tab is hidden, and asks on the next beat once it is visible (WEB-HOST-13)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const albumBook = vi.fn(async () => aBook('running'))
    render(fakeApi({ albumBook }))
    await screen.findByText(fr.admin.bookWorking)
    const calls = albumBook.mock.calls.length
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOOK_POLL_MS * 3)
      })
      expect(albumBook).toHaveBeenCalledTimes(calls)
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_POLL_MS + 100)
    })
    expect(albumBook.mock.calls.length).toBeGreaterThan(calls)
  })

  it('links the finished PDF, says what it holds and how big it is', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE) }))

    const link = await screen.findByRole('link', { name: new RegExp(fr.admin.bookDownload) })
    expect(link).toHaveAttribute('href', `/api/events/${SLUG}/book.pdf`)
    expect(link).toHaveTextContent('PDF')
    expect(screen.getByRole('status')).toHaveTextContent('44 pages')
    expect(screen.getByRole('status')).toHaveTextContent('42 photos')
    expect(screen.getByRole('status')).not.toHaveTextContent('sur')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: fr.admin.bookCreate })).toBeNull()
  })

  it('says how many photographs of the album a selection kept', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE_WITH_PRINT) }))

    expect(
      await screen.findByText(/118 photos [(]l’album en compte maintenant 412[)]/),
    ).toBeVisible()
  })

  it('links the three files of a book with a printer version, and tells how to have it printed', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE_WITH_PRINT) }))

    const book = await screen.findByRole('link', { name: new RegExp(fr.admin.bookDownload) })
    const interior = screen.getByRole('link', {
      name: new RegExp(fr.admin.bookDownloadPrintInterior),
    })
    const cover = screen.getByRole('link', { name: new RegExp(fr.admin.bookDownloadPrintCover) })
    expect([book, interior, cover].map((link) => link.getAttribute('href'))).toEqual([
      `/api/events/${SLUG}/book.pdf`,
      `/api/events/${SLUG}/book-print.pdf`,
      `/api/events/${SLUG}/book-cover.pdf`,
    ])
    expect(interior).toHaveTextContent(/Mo/)
    const help = screen.getByText(fr.admin.bookHelpLink)
    await userEvent.click(help)
    expect(screen.getByText(fr.admin.bookHelpStep1)).toBeVisible()
    expect(screen.getByText(fr.admin.bookHelpStep2)).toBeVisible()
    expect(screen.getByText(fr.admin.bookHelpStep3)).toBeVisible()
  })

  it('says a printer version was not produced, why, and still gives the book', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () => ({
          ...DONE_WITH_PRINT,
          pageCount: 236,
          printSkipped: 'tooManyPages' as const,
          files: { screen: { byteSize: 96_000_000 } },
        })),
      }),
    )

    expect(await screen.findByText(fr.admin.bookPrintSkippedTooManyPages(236, 200))).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(fr.admin.bookDownload) })).toBeVisible()
    expect(
      screen.queryByRole('link', { name: new RegExp(fr.admin.bookDownloadPrintInterior) }),
    ).toBeNull()
    expect(screen.queryByText(fr.admin.bookHelpLink)).toBeNull()
  })

  it('says too heavy a printer version in its own words', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () => ({
          ...DONE_WITH_PRINT,
          printSkipped: 'tooLarge' as const,
          files: { screen: { byteSize: 96_000_000 } },
        })),
      }),
    )

    expect(await screen.findByText(fr.admin.bookPrintSkippedTooLarge)).toBeVisible()
  })

  it('does not ask for a printer version the box no longer offers, whatever the last book asked', async () => {
    const requestAlbumBook = vi.fn(async (_slug: string, _body: object) => aBook('queued'))
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aBook('stale', {
            options: { ...DONE.options, printVersion: true },
            offer: { maxPhotos: 300, maxMessages: 60, printVersion: false },
          }),
        ),
        requestAlbumBook,
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookRecreate }))

    await waitFor(() => expect(requestAlbumBook).toHaveBeenCalled())
    expect(requestAlbumBook.mock.calls[0]?.[1]).toMatchObject({ printVersion: false })
  })

  it('opens the form on the last choices when the host makes the book again', async () => {
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    render(fakeApi({ albumBook: vi.fn(async () => DONE_WITH_PRINT), requestAlbumBook }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookRebuild }))

    expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Mariage')
    expect(screen.getByRole('radio', { name: /Moyenne/ })).toBeChecked()
    expect(screen.getByLabelText(fr.admin.bookPrintVersion)).toBeChecked()
    expect(screen.getAllByRole('button', { name: fr.admin.bookRebuild })).toHaveLength(2)
  })

  it('states the book in English for an English reader', async () => {
    render(fakeApi({ albumBook: vi.fn(async () => DONE) }), 'en')

    expect(
      await screen.findByRole('link', { name: new RegExp(en.admin.bookDownload) }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Book ready')
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

  it('keeps the book when the deletion is refused, and says so', async () => {
    const deleteAlbumBook = vi.fn(async () => {
      throw new ApiError(500, 'book.unavailable')
    })
    render(fakeApi({ albumBook: vi.fn(async () => DONE), deleteAlbumBook }))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.bookDelete }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: fr.admin.bookDelete }),
    )

    expect(await screen.findByText(fr.errors['book.unavailable'])).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(fr.admin.bookDownload) })).toBeVisible()
  })

  it('explains a stale book, keeps its choices, and offers to recreate it with no download', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () =>
          aBook('stale', {
            staleReason: 'messageRemoved',
            options: { ...DONE.options, title: 'Notre mariage', style: 'souvenir' },
          }),
        ),
      }),
    )

    expect(await screen.findByText(fr.admin.bookStale)).toBeVisible()
    expect(screen.queryByRole('link', { name: new RegExp(fr.admin.bookDownload) })).toBeNull()
    expect(screen.getByRole('button', { name: fr.admin.bookRecreate })).toBeVisible()
    expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Notre mariage')
    expect(styleRadio('Souvenir')).toBeChecked()
  })

  it('says a failure plainly, and a book that was too large in its own words', async () => {
    const view = render(fakeApi({ albumBook: vi.fn(async () => aBook('failed')) }))
    expect(await screen.findByText(fr.admin.bookFailed)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.bookCreate })).toBeVisible()
    view.unmount()

    render(
      fakeApi({
        albumBook: vi.fn(async () => aBook('failed', { failureCode: 'tooLarge' })),
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
