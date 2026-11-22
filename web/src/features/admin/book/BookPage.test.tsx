import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import type { BookPreviewDto } from '../../../lib/api/dto'
import {
  aBook,
  aBookPreview,
  aNoBook,
  aPreviewPage,
  aPreviewPhoto,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { BookPage } from './BookPage'

const SLUG = 'camille-et-sacha'

const render = (api: Api) =>
  renderWithProviders(<BookPage />, {
    api,
    route: `/admin/events/${SLUG}/book`,
    path: '/admin/events/:slug/book',
  })

/** A plan with a guest-book page: title, stats, a photograph, the messages, thanks, the end. */
const withGuestbook = (): BookPreviewDto =>
  aBookPreview({
    pages: [
      aPreviewPage('title', [], [{ x: 20, y: 36, w: 60, h: 22 }]),
      aPreviewPage(
        'stats',
        [],
        [
          { x: 15, y: 26, w: 32, h: 20 },
          { x: 53, y: 26, w: 32, h: 20 },
          { x: 15, y: 54, w: 32, h: 20 },
          { x: 53, y: 54, w: 32, h: 20 },
        ],
      ),
      aPreviewPage(
        'single',
        [aPreviewPhoto('p1')],
        [],
        [{ x: 12, y: 10, w: 76, h: 66, contain: true, hero: true }],
      ),
      aPreviewPage(
        'messages',
        [],
        [
          { x: 10, y: 16, w: 38, h: 34 },
          { x: 52, y: 16, w: 38, h: 34 },
        ],
        [],
        {
          messages: [{ text: 'Merci pour cette belle soirée', author: 'Zoé' }],
          firstMessages: true,
        },
      ),
      aPreviewPage(
        'thanks',
        [],
        [
          { x: 15, y: 12, w: 70, h: 8 },
          { x: 13, y: 30, w: 74, h: 50 },
        ],
      ),
      aPreviewPage(
        'end',
        [],
        [
          { x: 15, y: 40, w: 70, h: 10 },
          { x: 25, y: 86, w: 50, h: 4 },
        ],
      ),
    ],
  })

const lastPreviewCall = (api: Api) => {
  const calls = vi.mocked(api.albumBookPreview).mock.calls
  return calls[calls.length - 1]![1]
}

describe('BookPage, the preview', () => {
  it('draws the cover of the book the server planned, beside the settings, with the totals', async () => {
    render(fakeApi())

    expect(await screen.findByText('8 pages · 3 photos · style Classique')).toBeVisible()
    const cover = within(screen.getByRole('group', { name: fr.bookPage.previewLabel }))
    expect(cover.getByText('Mariage')).toBeVisible()
    expect(cover.getByText('14 juin 2026')).toBeVisible()
    expect(screen.getByText(fr.bookPage.previewNote, { normalizer: (text) => text })).toBeVisible()
    expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Camille & Sacha')
  })

  it('asks for the plan with the options the form holds, and opens on the cover alone', async () => {
    const api = fakeApi()
    render(api)

    await screen.findByText('8 pages · 3 photos · style Classique')

    expect(lastPreviewCall(api)).toMatchObject({
      title: 'Camille & Sacha',
      style: 'classique',
      selection: { kind: 'all' },
      showAuthors: true,
      showCaptions: true,
      includeGuestbook: false,
    })
    expect(screen.getByText(fr.bookPage.spreadPosition(1, 6))).toBeVisible()
  })

  it('changes the book at once when the host types a title, and never shows a read that was overtaken', async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      albumBookPreview: vi.fn(async (_slug: string, input) =>
        aBookPreview({ cover: { ...aBookPreview().cover, title: input.title } }),
      ),
    })
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')

    const title = screen.getByLabelText(fr.admin.bookTitle)
    await user.clear(title)
    await user.type(title, 'Notre été')

    expect(
      await within(screen.getByRole('group', { name: fr.bookPage.previewLabel })).findByText(
        'Notre été',
      ),
    ).toBeVisible()
    expect(lastPreviewCall(api)).toMatchObject({ title: 'Notre été' })
  })

  it('sends one read for a burst of keystrokes, not one per letter', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')
    const before = vi.mocked(api.albumBookPreview).mock.calls.length

    await user.type(screen.getByLabelText(new RegExp(fr.admin.bookSubtitle)), 'Un été')
    await waitFor(() =>
      expect(vi.mocked(api.albumBookPreview).mock.calls.length).toBeGreaterThan(before),
    )

    expect(vi.mocked(api.albumBookPreview).mock.calls.length - before).toBe(1)
    expect(lastPreviewCall(api)).toMatchObject({ subtitle: 'Un été' })
  })

  it('shows the guest book when the host turns it on, and goes to it', async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      albumBook: vi.fn(async () => aNoBook({ photos: 10, messages: 3 })),
      albumBookPreview: vi.fn(async (_slug: string, input) =>
        input.includeGuestbook ? withGuestbook() : aBookPreview(),
      ),
    })
    render(api)
    const box = await screen.findByRole('checkbox', { name: new RegExp(fr.admin.bookGuestbook) })
    await screen.findByText('8 pages · 3 photos · style Classique')

    // On by default for an album that has messages: turn it off, then on again.
    await user.click(box)
    await waitFor(() => expect(lastPreviewCall(api)).toMatchObject({ includeGuestbook: false }))
    await user.click(box)

    expect(
      await within(screen.getByRole('group', { name: fr.bookPage.previewLabel })).findByText(
        'Merci pour cette belle soirée',
      ),
    ).toBeVisible()
    expect(screen.getByText(fr.bookPage.pageNumbers(4, 5))).toBeVisible()
    expect(lastPreviewCall(api)).toMatchObject({ includeGuestbook: true })
  })

  it('asks for a selection of the chosen length, and says every photograph is not offered above the ceiling', async () => {
    const user = userEvent.setup()
    const api = fakeApi({ albumBook: vi.fn(async () => aNoBook({ photos: 412, messages: 0 })) })
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')

    expect(
      screen.getByRole('radio', { name: (name) => name.startsWith('Toutes les photos') }),
    ).toBeDisabled()
    expect(lastPreviewCall(api)).toMatchObject({ selection: { kind: 'best', target: 120 } })

    await user.click(screen.getByRole('radio', { name: /Longue/ }))
    await waitFor(() =>
      expect(lastPreviewCall(api)).toMatchObject({ selection: { kind: 'best', target: 200 } }),
    )
  })

  it('says what to do when nothing is published, and offers no book to make', async () => {
    const api = fakeApi({
      albumBookPreview: vi.fn(async () => {
        throw new ApiError(409, 'book.empty')
      }),
    })
    render(api)

    expect(await screen.findByText(fr.bookPage.empty)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.bookCreate })).toBeDisabled()
  })

  it('keeps the last book on screen when a read fails, and offers to try again', async () => {
    const user = userEvent.setup()
    let failing = false
    const api = fakeApi({
      albumBookPreview: vi.fn(async () => {
        if (failing) throw new ApiError(500, 'server.unexpected')
        return aBookPreview()
      }),
    })
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')

    failing = true
    await user.type(screen.getByLabelText(new RegExp(fr.admin.bookSubtitle)), 'x')

    const retry = await screen.findByRole('button', { name: fr.bookPage.retry })
    expect(screen.getByText('8 pages · 3 photos · style Classique')).toBeVisible()
    failing = false
    await user.click(retry)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: fr.bookPage.retry })).toBeNull(),
    )
  })

  it('names the style the preview shows, in the totals', async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      albumBookPreview: vi.fn(async (_slug: string, input) => aBookPreview({ style: input.style })),
    })
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')

    await user.click(screen.getByRole('radio', { name: /Souvenir/ }))

    expect(await screen.findByText('8 pages · 3 photos · style Souvenir')).toBeVisible()
  })
})

describe('BookPage, turning the pages', () => {
  const stage = () => screen.getByRole('group', { name: fr.bookPage.previewLabel })

  it('turns with the buttons: the cover alone, then two pages at a time, then the back cover alone', async () => {
    const user = userEvent.setup()
    render(fakeApi())
    await screen.findByText('8 pages · 3 photos · style Classique')
    const previous = screen.getByRole('button', { name: fr.bookPage.prev })
    const next = screen.getByRole('button', { name: fr.bookPage.next })

    expect(previous).toBeDisabled()
    expect(stage().querySelectorAll('[data-book-page]')).toHaveLength(1)

    await user.click(next)
    expect(screen.getByText(fr.bookPage.inside + ' · ' + fr.bookPage.pageNumber(1))).toBeVisible()
    expect(stage().querySelectorAll('[data-book-page]')).toHaveLength(2)

    await user.click(next)
    expect(screen.getByText(fr.bookPage.pageNumbers(2, 3))).toBeVisible()

    for (let i = 0; i < 3; i += 1) await user.click(next)
    expect(screen.getByText(fr.bookPage.backCover)).toBeVisible()
    expect(stage().querySelectorAll('[data-book-page]')).toHaveLength(1)
    expect(next).toBeDisabled()

    await user.click(previous)
    expect(next).toBeEnabled()
  })

  it('turns with the arrow keys, and goes to the ends with Home and End', async () => {
    const user = userEvent.setup()
    render(fakeApi())
    await screen.findByText('8 pages · 3 photos · style Classique')

    stage().focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByText(fr.bookPage.spreadPosition(3, 6))).toBeVisible()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText(fr.bookPage.spreadPosition(2, 6))).toBeVisible()
    await user.keyboard('{End}')
    expect(screen.getByText(fr.bookPage.backCover)).toBeVisible()
    await user.keyboard('{Home}')
    expect(screen.getByText(fr.bookPage.spreadPosition(1, 6))).toBeVisible()
  })

  it('goes to a spread from the strip, which marks the one that is open', async () => {
    const user = userEvent.setup()
    render(fakeApi())
    await screen.findByText('8 pages · 3 photos · style Classique')
    // The strip is for a laptop: under 44 rem of column the page hides it, and the test has the
    // stylesheet but no container query, hence the look through the label.
    const strip = within(screen.getByLabelText(fr.bookPage.stripLabel))
    const name = new RegExp(fr.bookPage.pageNumbers(4, 5))

    expect(strip.getAllByRole('button', { hidden: true })).toHaveLength(6)
    await user.click(strip.getByLabelText(name))

    expect(screen.getByText(fr.bookPage.pageNumbers(4, 5))).toBeVisible()
    expect(strip.getByLabelText(name)).toHaveAttribute('aria-current', 'true')
  })

  it('draws miniatures only around the open spread of a very large book, and numbers the rest', async () => {
    const user = userEvent.setup()
    const pages = Array.from({ length: 200 }, () => aPreviewPage('blank'))
    render(
      fakeApi({ albumBookPreview: vi.fn(async () => aBookPreview({ pages, pageCount: 202 })) }),
    )
    await screen.findByText(/202 pages/)
    const strip = screen.getByLabelText(fr.bookPage.stripLabel)

    // 103 spreads (the cover, 101 pairs, the back cover), 21 of them drawn around the open one.
    expect(strip.querySelectorAll('button')).toHaveLength(103)
    expect(strip.querySelectorAll('[data-book-page]').length).toBeLessThanOrEqual(2 * 21)
    const far = strip.querySelectorAll('button')[80]!
    expect(far.querySelector('[data-book-page]')).toBeNull()
    expect(far).toHaveTextContent('81')

    await user.click(far)
    expect(far.querySelector('[data-book-page]')).not.toBeNull()
  })

  it('opens the book large in a dialog that follows the same page', async () => {
    const user = userEvent.setup()
    render(fakeApi())
    await screen.findByText('8 pages · 3 photos · style Classique')
    await user.click(screen.getByRole('button', { name: fr.bookPage.next }))

    await user.click(screen.getByRole('button', { name: fr.bookPage.big }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(fr.bookPage.inside + ' · ' + fr.bookPage.pageNumber(1)),
    ).toBeVisible()
  })
})

describe('BookPage, making the book', () => {
  it('asks for the book with the same options as the preview, and reads the state again', async () => {
    const user = userEvent.setup()
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    const albumBook = vi.fn(async () => aNoBook({ photos: 10, messages: 0 }))
    const api = fakeApi({ requestAlbumBook, albumBook })
    render(api)
    await screen.findByText('8 pages · 3 photos · style Classique')

    await user.click(screen.getByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() => expect(requestAlbumBook).toHaveBeenCalledTimes(1))
    expect(requestAlbumBook).toHaveBeenCalledWith(
      SLUG,
      expect.objectContaining({
        title: 'Camille & Sacha',
        style: 'classique',
        selection: { kind: 'all' },
        includeGuestbook: false,
        printVersion: false,
      }),
    )
    await waitFor(() => expect(albumBook.mock.calls.length).toBeGreaterThan(1))
  })

  it('asks for the printer version only when the box offers it and the host chose it', async () => {
    const user = userEvent.setup()
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    render(fakeApi({ requestAlbumBook }))
    await screen.findByText('8 pages · 3 photos · style Classique')

    await user.click(screen.getByRole('checkbox', { name: new RegExp(fr.admin.bookPrintVersion) }))
    await user.click(screen.getByRole('button', { name: fr.admin.bookCreate }))

    await waitFor(() =>
      expect(requestAlbumBook).toHaveBeenCalledWith(
        SLUG,
        expect.objectContaining({ printVersion: true }),
      ),
    )
  })

  it('does not ask for a book without a title', async () => {
    const user = userEvent.setup()
    const requestAlbumBook = vi.fn(async () => aBook('queued'))
    render(fakeApi({ requestAlbumBook }))
    await screen.findByText('8 pages · 3 photos · style Classique')

    await user.clear(screen.getByLabelText(fr.admin.bookTitle))

    expect(screen.getByRole('button', { name: fr.admin.bookCreate })).toBeDisabled()
    expect(requestAlbumBook).not.toHaveBeenCalled()
  })

  it('says a queued book is waiting and a running one is being laid out, without a percentage', async () => {
    const queued = render(fakeApi({ albumBook: vi.fn(async () => aBook('queued')) }))

    expect(await screen.findByText(fr.bookPage.queued)).toBeVisible()
    expect(screen.getByText(fr.bookPage.workingNote)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.bookCreate })).toBeDisabled()
    expect(screen.queryByRole('progressbar')).toBeNull()
    queued.unmount()

    render(fakeApi({ albumBook: vi.fn(async () => aBook('running')) }))
    expect(await screen.findByText(fr.bookPage.running)).toBeVisible()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('offers the downloads of a finished book, to rebuild it or to delete it', async () => {
    const user = userEvent.setup()
    const deleteAlbumBook = vi.fn(async () => undefined)
    const done = aBook('done', {
      photoCount: 3,
      pageCount: 8,
      byteSize: 1_000_000,
      files: { screen: { byteSize: 1_000_000 } },
      expiresAt: '2026-06-21T20:00:00.000Z',
    })
    render(fakeApi({ albumBook: vi.fn(async () => done), deleteAlbumBook }))

    expect(
      await screen.findByRole('link', { name: new RegExp(fr.admin.bookDownload) }),
    ).toHaveAttribute('href', `/api/events/${SLUG}/book.pdf`)
    expect(screen.getByRole('button', { name: fr.admin.bookRebuild })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: fr.admin.bookDelete }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: fr.admin.bookDelete }),
    )

    await waitFor(() => expect(deleteAlbumBook).toHaveBeenCalledWith(SLUG))
  })

  it.each([
    ['stale', fr.admin.bookStale, fr.admin.bookRecreate],
    ['failed', fr.admin.bookFailed, fr.admin.bookCreate],
  ] as const)(
    'tells a %s book and offers to make it again with the same choices',
    async (status, sentence, label) => {
      render(
        fakeApi({
          albumBook: vi.fn(async () =>
            aBook(status, { options: { ...aBook(status).options, title: 'Titre gardé' } }),
          ),
        }),
      )

      expect(await screen.findByText(sentence)).toBeVisible()
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
      expect(screen.getByLabelText(fr.admin.bookTitle)).toHaveValue('Titre gardé')
    },
  )

  it('says so when the server does not know the book', async () => {
    render(
      fakeApi({
        albumBook: vi.fn(async () => {
          throw new ApiError(404, 'route.notFound')
        }),
      }),
    )

    expect(await screen.findByText(fr.bookPage.unsupported)).toBeVisible()
  })
})
