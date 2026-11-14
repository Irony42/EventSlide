import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { de } from '../../lib/i18n/de'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { it as itLocale } from '../../lib/i18n/it'
import { anEventDto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { BestOfPanel } from './BestOfPanel'
import { EventDestinationTile } from './components/EventDestinationTile'

const SLUG = 'camille-et-sacha'
const ZIP = `/api/events/${SLUG}/best-of.zip`

afterEach(() => vi.unstubAllGlobals())

/** What the browser gets before any byte of an archive: a status, some headers, a body never read. */
const answers = (status: number, headers: Record<string, string> = {}) => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(status === 200 ? 'PK' : '{"error":{"code":"rate.limited"}}', {
        status,
        headers,
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const renderPanel = (locale: 'fr' | 'de' | 'en' | 'es' | 'it' = 'fr') =>
  renderWithProviders(<BestOfPanel slug={SLUG} canStar />, {
    api: fakeApi({ highlights: vi.fn(async () => ({ count: 12 })) }),
    locale,
  })

describe('the host export links, when the server refuses the archive', () => {
  it('says in French that an export is already running on 429, with the wait', async () => {
    const fetchMock = answers(429, { 'Retry-After': '30' })
    renderPanel()

    await userEvent.click(await screen.findByRole('link', { name: fr.admin.bestOfDownload }))

    expect(await screen.findByText(fr.admin.exportBusy(30))).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith(ZIP, expect.objectContaining({ method: 'GET' }))
  })

  it('says the server is busy on 503, in the host language, with the wait', async () => {
    answers(503, { 'Retry-After': '30' })
    renderPanel('de')

    await userEvent.click(await screen.findByRole('link', { name: de.admin.bestOfDownload }))

    expect(await screen.findByText(de.admin.exportNotReady(30))).toBeVisible()
  })

  it('gives another refusal (the favourites were emptied) a sentence too', async () => {
    answers(409)
    renderPanel()

    await userEvent.click(await screen.findByRole('link', { name: fr.admin.bestOfDownload }))

    expect(await screen.findByText(fr.admin.exportFailed)).toBeVisible()
  })

  it('refuses the same way from the album tile of the event page', async () => {
    answers(429, { 'Retry-After': '30' })
    renderWithProviders(
      <EventDestinationTile
        destination="download"
        size="small"
        event={anEventDto()}
        albumUrl={`/api/events/${SLUG}/album.zip`}
        onOpenPanel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('link', { name: new RegExp(fr.admin.download) }))

    expect(await screen.findByText(fr.admin.exportBusy(30))).toBeVisible()
  })

  it('lets the browser download when the server agrees, without reading the archive', async () => {
    const fetchMock = answers(200)
    const clicked = vi.fn()
    // The programmatic click that starts the browser's own download.
    const original = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked(this.getAttribute('href'), this.hasAttribute('download'))
    }
    try {
      renderPanel()
      await userEvent.click(await screen.findByRole('link', { name: fr.admin.bestOfDownload }))

      await waitFor(() => expect(clicked).toHaveBeenCalledWith(ZIP, true))
      const init = fetchMock.mock.calls[0]?.[1]
      expect(init?.signal?.aborted).toBe(true)
      expect(screen.queryByText(fr.admin.exportFailed)).toBeNull()
    } finally {
      HTMLAnchorElement.prototype.click = original
    }
  })

  it('takes over a plain click, never a click with a modifier (new tab, save link as)', async () => {
    const fetchMock = answers(429, { 'Retry-After': '30' })
    renderPanel()
    const link = await screen.findByRole('link', { name: fr.admin.bestOfDownload })

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(link, { button: 1 })).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    // The browser must not also follow the link: it would save the JSON refusal as a file.
    expect(fireEvent.click(link)).toBe(false)
    await screen.findByText(fr.admin.exportBusy(30))
  })

  it('has its sentence in the five languages, with the wait in it', () => {
    for (const t of [fr, en, es, itLocale, de]) {
      expect(t.admin.exportBusy(30)).toContain('30')
      expect(t.admin.exportNotReady(30)).toContain('30')
      expect(t.admin.exportBusy(null)).not.toContain('null')
      expect(t.admin.exportNotReady(null)).not.toContain('null')
      expect(t.admin.exportFailed.length).toBeGreaterThan(10)
    }
  })
})
