import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { EventPage } from './EventPage'
import { ApiError } from '../../lib/http'
import { formatBytes, formatDateTime, formatDay } from '../../lib/format'
import { en } from '../../lib/i18n/en'
import { fr } from '../../lib/i18n/fr'
import type { Api } from '../../lib/api/client'
import type { AlbumExportDto, EventDto } from '../../lib/api/dto'
import { FakeEventSource } from '../../testing/fakeEventSource'
import {
  anAlbumExport,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'

/**
 * Spec 22, the host's side: the band that says when the album goes and what to do before, the
 * archive's states, and the early deletion that asks for more when no complete archive was sent.
 *
 * The page is counted on the **server's** clock. Every test sets this machine's clock to a day far
 * from the server's, so a count made on the wrong one is a count that is visibly wrong.
 */

const DAY = 86_400_000
const SLUG = 'camille-et-sacha'
/** What the server's clock said when it answered. */
const SERVER_NOW = Date.parse('2026-12-02T12:00:00.000Z')
/** This machine's clock: 28 days ahead of the server's. Counting on it makes 10 days "passed". */
const WRONG_LOCAL_NOW = SERVER_NOW + 28 * DAY

const spaced = (value: string) => value.replace(/\s/g, ' ')
const dayOf = (at: string) => spaced(formatDay(at, 'fr') ?? '')

const atInDays = (days: number): string => new Date(SERVER_NOW + days * DAY).toISOString()

const closedEvent = (at: string | null, overrides: Partial<EventDto> = {}): EventDto =>
  anEventDto({
    status: 'closed',
    closedAt: '2026-11-02T12:00:00.000Z',
    purge: { at, notice: null, serverNowMs: SERVER_NOW },
    ...overrides,
  })

const renderPage = (api: Api, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(
    <Routes>
      <Route path="/admin" element={<p>dashboard</p>} />
      <Route path="/admin/events/:slug" element={<EventPage />} />
    </Routes>,
    { api, route: `/admin/events/${SLUG}`, locale },
  )

const apiWith = (event: EventDto, archive: AlbumExportDto | null, extra: Partial<Api> = {}): Api =>
  fakeApi({
    getEvent: vi.fn(async () => event),
    ...(archive === null ? {} : { albumExport: vi.fn(async () => archive) }),
    ...extra,
  })

const band = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: fr.exportPurge.title })
  const section = heading.closest('section')
  if (section === null) throw new Error('the band is not a section')
  return section
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(WRONG_LOCAL_NOW)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the deletion band: when it is on the page', () => {
  it('is there at thirty days, and says how many', async () => {
    const at = atInDays(30)
    renderPage(apiWith(closedEvent(at), null))

    const section = await band()

    expect(spaced(section.textContent ?? '')).toContain(
      spaced(fr.exportPurge.deletesOn(dayOf(at), 30)),
    )
    expect(section.textContent).toContain(fr.exportPurge.downloadFirst)
  })

  it('is not there at thirty-one days', async () => {
    const api = apiWith(closedEvent(atInDays(31)), null)
    renderPage(api)

    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(screen.queryByRole('heading', { name: fr.exportPurge.title })).toBeNull()
    // Nothing was asked either: an album with no date in reach costs the server nothing.
    expect(api.albumExport).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('is not there for an album with no date, whatever its state', async () => {
    renderPage(apiWith(closedEvent(null), null))

    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(screen.queryByRole('heading', { name: fr.exportPurge.title })).toBeNull()
  })

  it('is not there for an event that has not closed: it has no date', async () => {
    renderPage(
      apiWith(anEventDto({ purge: { at: null, notice: null, serverNowMs: SERVER_NOW } }), null),
    )

    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(screen.queryByRole('heading', { name: fr.exportPurge.title })).toBeNull()
  })

  it('says "in 1 day" for the last day and "today" for the day itself', async () => {
    const tomorrow = atInDays(1)
    const { unmount } = renderPage(apiWith(closedEvent(tomorrow), null))
    expect(spaced((await band()).textContent ?? '')).toContain(
      spaced(fr.exportPurge.deletesOn(dayOf(tomorrow), 1)),
    )
    unmount()

    // Two hours before, on the same calendar day (this machine's reading of the server's now).
    vi.setSystemTime(new Date(2026, 11, 2, 12, 0, 0))
    const soon = new Date(2026, 11, 2, 14, 0, 0).toISOString()
    const base = new Date(2026, 11, 2, 12, 0, 0).getTime()
    renderPage(
      apiWith(
        anEventDto({
          status: 'closed',
          closedAt: '2026-11-02T12:00:00.000Z',
          purge: { at: soon, notice: null, serverNowMs: base },
        }),
        null,
      ),
    )
    expect(spaced((await band()).textContent ?? '')).toContain(
      spaced(fr.exportPurge.deletesToday(dayOf(soon))),
    )
  })

  it('says the date has passed and nothing more: not why, not "soon"', async () => {
    renderPage(apiWith(closedEvent(atInDays(-2)), null))

    const section = await band()

    expect(section.textContent).toContain(fr.exportPurge.passed)
    expect(section.textContent).not.toContain(fr.exportPurge.downloadFirst)
    expect(section.textContent).not.toMatch(/sous peu|bientôt|prochain/i)
  })
})

describe('the deletion band: the server’s clock, not the machine’s', () => {
  it('counts ten days on a machine that is 28 days ahead of the server', async () => {
    const at = atInDays(10)
    renderPage(apiWith(closedEvent(at), null))

    const section = await band()

    expect(spaced(section.textContent ?? '')).toContain(
      spaced(fr.exportPurge.deletesOn(dayOf(at), 10)),
    )
    expect(section.textContent).not.toContain(fr.exportPurge.passed)
  })

  it('moves on with the clock: a day later the count is one less', async () => {
    const at = atInDays(10)
    renderPage(apiWith(closedEvent(at), null))
    await band()

    // This machine's clock moves on a day; the next tick works the count out again.
    await act(async () => {
      vi.setSystemTime(WRONG_LOCAL_NOW + DAY)
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(spaced((await band()).textContent ?? '')).toContain(
      spaced(fr.exportPurge.deletesOn(dayOf(at), 9)),
    )
  })
})

describe('the deletion band: when the host closes the evening', () => {
  it('appears at once from the server’s answer, not a minute later', async () => {
    const live = anEventDto({ purge: { at: null, notice: null, serverNowMs: SERVER_NOW } })
    // Ten seconds later, on the server's clock, the host closes: the date is exactly thirty days on.
    const closedAtMs = SERVER_NOW + 10_000
    const closed = closedEvent(new Date(closedAtMs + 30 * DAY).toISOString(), {
      purge: {
        at: new Date(closedAtMs + 30 * DAY).toISOString(),
        notice: null,
        serverNowMs: closedAtMs,
      },
    })
    const api = apiWith(live, null, { setEventStatus: vi.fn(async () => closed) })
    renderPage(api)
    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await userEvent.click(screen.getByRole('button', { name: fr.admin.closeEvent }))

    expect(await screen.findByRole('heading', { name: fr.exportPurge.title })).toBeVisible()
  })
})

describe('the deletion band: it never speaks of a hold', () => {
  const STATES: readonly [string, AlbumExportDto | null, number][] = [
    ['no archive', null, 10],
    ['a date that has passed', null, -3],
    ['being prepared', anAlbumExport({ status: 'running' }), 10],
    ['sealed and sent', anAlbumExport({ servedAt: '2026-12-02T14:21:00.000Z' }), 10],
    ['sealed but incomplete', anAlbumExport({ skipped: 2 }), 10],
    ['withdrawn', anAlbumExport({ status: 'stale', staleReason: 'photoRemoved' }), 10],
    ['failed for want of room', anAlbumExport({ status: 'failed', failure: 'noRoom' }), 10],
  ]

  it.each(STATES)(
    'says nothing of a freeze, a hold or the operator in this state: %s',
    async (_name, archive, days) => {
      renderPage(apiWith(closedEvent(atInDays(days)), archive))

      const text = ((await band()).textContent ?? '') + (document.body.textContent ?? '')

      expect(text).not.toMatch(/\bgel\b|gelé|gèle|\bhold\b|freeze|frozen/i)
    },
  )

  it('has no such word anywhere in the copy of the section, in French or in English', () => {
    const everySentence = (table: object): string[] =>
      Object.values(table).flatMap((value): string[] =>
        typeof value === 'function'
          ? [String(value(3, '1', '2', null)), String(value('x'))]
          : typeof value === 'string'
            ? [value]
            : [],
      )

    for (const sentence of [...everySentence(fr.exportPurge), ...everySentence(en.exportPurge)]) {
      expect(sentence).not.toMatch(/\bgel\b|gelé|gèle|\bhold\b|freeze|frozen/i)
    }
  })
})

describe('the archive: what the band says of each state', () => {
  it('offers to prepare one when there is none, and the direct download beside it', async () => {
    const api = apiWith(closedEvent(atInDays(10)), null)
    renderPage(api)

    const section = await band()
    await within(section).findByRole('button', { name: fr.exportPurge.prepare })

    expect(
      within(section).getByRole('link', { name: fr.exportPurge.downloadAlbum }),
    ).toHaveAttribute('href', `/api/events/${SLUG}/album.zip`)
    // The direct download is not checked by the server, and the band says so.
    expect(section.textContent).toContain(fr.exportPurge.directNote)
    expect(within(section).queryByRole('link', { name: fr.exportPurge.downloadArchive })).toBeNull()
  })

  it('asks the server for the archive, and shows it being prepared without a second button', async () => {
    const api = apiWith(closedEvent(atInDays(10)), null)
    renderPage(api)
    const section = await band()

    await userEvent.click(
      await within(section).findByRole('button', { name: fr.exportPurge.prepare }),
    )

    expect(api.requestAlbumExport).toHaveBeenCalledWith(SLUG)
    expect(await within(section).findByText(fr.exportPurge.working)).toBeVisible()
    expect(within(section).queryByRole('button', { name: fr.exportPurge.prepare })).toBeNull()
    expect(within(section).queryByRole('button', { name: fr.exportPurge.rebuild })).toBeNull()
  })

  it('shows a refusal as the sentence for its code, and leaves the button there', async () => {
    const api = apiWith(closedEvent(atInDays(10)), null, {
      requestAlbumExport: vi.fn(() => Promise.reject(new ApiError(409, 'export.noRoom'))),
    })
    renderPage(api)
    const section = await band()

    await userEvent.click(
      await within(section).findByRole('button', { name: fr.exportPurge.prepare }),
    )

    expect(await screen.findByText(fr.errors['export.noRoom'])).toBeVisible()
    expect(within(section).getByRole('button', { name: fr.exportPurge.prepare })).toBeEnabled()
  })

  it('says a sealed archive is ready: files, size, when, until when, its fingerprint, and a link to it', async () => {
    const archive = anAlbumExport()
    renderPage(apiWith(closedEvent(atInDays(10)), archive))

    const section = await band()
    const ready = await within(section).findByText(/Archive prête :/)

    expect(spaced(ready.textContent ?? '')).toBe(
      spaced(
        fr.exportPurge.ready(
          4812,
          formatBytes(6_200_000_000, 'fr'),
          formatDateTime(archive.sealedAt ?? '', 'fr') ?? '',
          formatDateTime(archive.expiresAt ?? '', 'fr'),
        ),
      ),
    )
    expect(within(section).getByText(archive.sha256 ?? '')).toBeVisible()
    expect(
      within(section).getByRole('link', { name: fr.exportPurge.downloadArchive }),
    ).toHaveAttribute('href', `/api/events/${SLUG}/export.zip`)
    // One press from a new one.
    expect(within(section).getByRole('button', { name: fr.exportPurge.rebuild })).toBeVisible()
  })

  it('says "sent in full", never "received", and tells the host to check their file', async () => {
    const archive = anAlbumExport({ servedAt: '2026-12-02T14:21:00.000Z' })
    renderPage(apiWith(closedEvent(atInDays(10)), archive))

    const section = await band()
    const sent = await within(section).findByText(/envoyée en entier/)

    expect(spaced(sent.textContent ?? '')).toContain(
      spaced(fr.exportPurge.sent(formatDateTime('2026-12-02T14:21:00.000Z', 'fr') ?? '')),
    )
    expect(sent.textContent).toContain('Vérifiez votre fichier')
    expect(section.textContent).not.toMatch(/reçue?\b/i)
  })

  it('says how many files were missing from the server’s disk', async () => {
    renderPage(apiWith(closedEvent(atInDays(10)), anAlbumExport({ skipped: 2 })))

    const section = await band()

    expect(await within(section).findByText(fr.exportPurge.incomplete(2))).toBeVisible()
  })

  it.each(['photoRemoved', 'guestErased', 'guestbookChanged'])(
    'says the archive was withdrawn because something was removed (%s), and offers to redo it',
    async (reason) => {
      renderPage(
        apiWith(closedEvent(atInDays(10)), anAlbumExport({ status: 'stale', staleReason: reason })),
      )

      const section = await band()

      expect(await within(section).findByText(fr.exportPurge.retired)).toBeVisible()
      expect(within(section).getByRole('button', { name: fr.exportPurge.rebuild })).toBeVisible()
      expect(
        within(section).queryByRole('link', { name: fr.exportPurge.downloadArchive }),
      ).toBeNull()
    },
  )

  it('says the album changed when the event was reopened', async () => {
    renderPage(
      apiWith(
        closedEvent(atInDays(10)),
        anAlbumExport({ status: 'stale', staleReason: 'reopened' }),
      ),
    )

    expect(await within(await band()).findByText(fr.exportPurge.changed)).toBeVisible()
  })

  it.each([
    ['noRoom', fr.exportPurge.noRoom],
    ['tooLarge', fr.exportPurge.tooLarge],
    ['corrupt', fr.exportPurge.failed],
    ['unverified', fr.exportPurge.failed],
  ])(
    'says a failure for %s in its own words, and offers to try again',
    async (failure, sentence) => {
      renderPage(apiWith(closedEvent(atInDays(10)), anAlbumExport({ status: 'failed', failure })))

      const section = await band()

      expect(await within(section).findByText(sentence)).toBeVisible()
      expect(within(section).getByRole('button', { name: fr.exportPurge.rebuild })).toBeVisible()
    },
  )

  it('reads the archive again when the server says it moved, with no polling', async () => {
    const albumExport = vi
      .fn<() => Promise<AlbumExportDto>>()
      .mockResolvedValueOnce(anAlbumExport({ status: 'running' }))
      .mockResolvedValue(anAlbumExport())
    renderPage(apiWith(closedEvent(atInDays(10)), null, { albumExport }))
    const section = await band()
    expect(await within(section).findByText(fr.exportPurge.working)).toBeVisible()

    // Minutes go by: nothing is asked. Then the signal comes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(albumExport).toHaveBeenCalledTimes(1)

    act(() => FakeEventSource.latest('the band').emitSignal('export.changed'))

    expect(await within(section).findByText(/Archive prête :/)).toBeVisible()
    expect(albumExport).toHaveBeenCalledTimes(2)
  })

  it('reads the archive on the moderation stream, and on nothing else', async () => {
    renderPage(apiWith(closedEvent(atInDays(10)), null))
    await band()

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))

    // The page's other panels read the same authorised channel; the public one is never opened.
    expect(FakeEventSource.instances.map((stream) => stream.url)).toEqual(
      expect.arrayContaining([`/api/events/${SLUG}/moderation/stream`]),
    )
    expect(FakeEventSource.instances.map((stream) => stream.url)).not.toContain(
      `/api/events/${SLUG}/stream`,
    )
  })

  it('is worded in the language on screen', async () => {
    const at = atInDays(10)
    renderPage(apiWith(closedEvent(at), null), 'en')

    const heading = await screen.findByRole('heading', { name: en.exportPurge.title })

    expect(heading).toBeVisible()
    expect(screen.getByRole('button', { name: en.exportPurge.prepare })).toBeVisible()
  })
})

describe('the early deletion without a complete archive that was sent', () => {
  const blockedButton = async (): Promise<HTMLElement> =>
    screen.findByRole('button', { name: fr.exportPurge.deleteNow })

  it('is switched off with the reason beside it when there is no archive', async () => {
    renderPage(apiWith(closedEvent(atInDays(10)), null))
    const button = await blockedButton()

    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The button points at the sentence that says what is missing, and stays in the tab order.
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toBe(fr.exportPurge.needsArchive)
    expect(button).not.toBeDisabled()
  })

  it('does not open its confirmation when it is pressed', async () => {
    const api = apiWith(closedEvent(atInDays(10)), null)
    renderPage(api)

    await userEvent.click(await blockedButton())

    expect(screen.queryByText(fr.admin.purgeWarning)).toBeNull()
    expect(api.purgeEvent).not.toHaveBeenCalled()
  })

  it('says to download the archive when it is sealed and complete but was never sent', async () => {
    renderPage(apiWith(closedEvent(atInDays(10)), anAlbumExport()))
    const button = await blockedButton()

    expect(button).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() =>
      expect(
        document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe(fr.exportPurge.needsDownload),
    )
  })

  it('says the archive is incomplete when files were missing, even once it was sent', async () => {
    renderPage(
      apiWith(
        closedEvent(atInDays(10)),
        anAlbumExport({ skipped: 2, servedAt: '2026-12-02T14:21:00.000Z' }),
      ),
    )
    const button = await blockedButton()

    expect(button).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() =>
      expect(
        document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe(fr.exportPurge.needsComplete),
    )
  })

  it('is switched on once the server says a complete archive was sent', async () => {
    renderPage(
      apiWith(
        closedEvent(atInDays(10)),
        anAlbumExport({ servedAt: '2026-12-02T14:21:00.000Z', canDeleteWithoutConfirmation: true }),
      ),
    )

    const button = await blockedButton()

    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('button', { name: fr.exportPurge.deleteWithout })).toBeNull()
  })

  it('then asks for the album’s address, as it always did', async () => {
    const api = apiWith(
      closedEvent(atInDays(10)),
      anAlbumExport({ servedAt: '2026-12-02T14:21:00.000Z', canDeleteWithoutConfirmation: true }),
    )
    renderPage(api)
    const button = await blockedButton()
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))

    await userEvent.click(button)

    expect(screen.getByLabelText(fr.admin.purgeConfirmLabel)).toBeVisible()
    expect(screen.queryByLabelText(fr.exportPurge.wordLabel)).toBeNull()
  })

  it('stays switched off while the archive has not been read yet: the cautious answer', async () => {
    const api = apiWith(closedEvent(atInDays(10)), null, {
      albumExport: vi.fn(() => new Promise<AlbumExportDto>(() => {})),
    })
    renderPage(api)

    expect(await blockedButton()).toHaveAttribute('aria-disabled', 'true')
  })

  describe('"Supprimer sans archive…": the word', () => {
    const open = async (api: Api) => {
      renderPage(api)
      await userEvent.click(
        await screen.findByRole('button', { name: fr.exportPurge.deleteWithout }),
      )
    }
    /** The last button carrying a label is the one inside the dialog that just opened. */
    const confirm = (): HTMLElement => {
      const buttons = screen.getAllByRole('button', { name: fr.admin.purge })
      const last = buttons[buttons.length - 1]
      if (last === undefined) throw new Error('no confirm button')
      return last
    }

    it('asks for the word of the language on screen, not the address, and says why', async () => {
      await open(apiWith(closedEvent(atInDays(10)), null))

      expect(screen.getByLabelText(fr.exportPurge.wordLabel)).toBeVisible()
      expect(screen.getByText(fr.exportPurge.wordPrompt(fr.exportPurge.confirmWord))).toBeVisible()
      expect(screen.queryByLabelText(fr.admin.purgeConfirmLabel)).toBeNull()
    })

    it('deletes nothing until the word is typed', async () => {
      const api = apiWith(closedEvent(atInDays(10)), null)
      await open(api)

      expect(confirm()).toBeDisabled()
      await userEvent.type(screen.getByLabelText(fr.exportPurge.wordLabel), 'supprim')
      expect(confirm()).toBeDisabled()
      // The address, which used to be the key, is not the word.
      await userEvent.clear(screen.getByLabelText(fr.exportPurge.wordLabel))
      await userEvent.type(screen.getByLabelText(fr.exportPurge.wordLabel), SLUG)
      expect(confirm()).toBeDisabled()
      expect(api.purgeEvent).not.toHaveBeenCalled()
    })

    it('deletes once the word is typed, in any case and with stray spaces', async () => {
      const api = apiWith(closedEvent(atInDays(10)), null)
      await open(api)

      await userEvent.type(screen.getByLabelText(fr.exportPurge.wordLabel), '  supp rimer ')
      await userEvent.click(confirm())

      expect(api.purgeEvent).toHaveBeenCalledWith(SLUG)
    })

    it('does not keep the word typed for the next time the dialog opens', async () => {
      await open(apiWith(closedEvent(atInDays(10)), null))
      await userEvent.type(screen.getByLabelText(fr.exportPurge.wordLabel), 'SUPPRIMER')
      await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

      await userEvent.click(screen.getByRole('button', { name: fr.exportPurge.deleteWithout }))

      expect(screen.getByLabelText(fr.exportPurge.wordLabel)).toHaveValue('')
      expect(confirm()).toBeDisabled()
    })

    it('asks for the English word on an English screen', async () => {
      renderPage(apiWith(closedEvent(atInDays(10)), null), 'en')
      await userEvent.click(
        await screen.findByRole('button', { name: en.exportPurge.deleteWithout }),
      )

      await userEvent.type(screen.getByLabelText(en.exportPurge.wordLabel), 'delete')
      const buttons = screen.getAllByRole('button', { name: en.admin.purge })
      const last = buttons[buttons.length - 1]

      expect(last).toBeEnabled()
    })
  })

  it('leaves the plain deletion alone when no band is on the page: the address, as before', async () => {
    renderPage(apiWith(closedEvent(atInDays(90)), null))

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.purge }))

    expect(screen.getByLabelText(fr.admin.purgeConfirmLabel)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.exportPurge.deleteWithout })).toBeNull()
  })
})
