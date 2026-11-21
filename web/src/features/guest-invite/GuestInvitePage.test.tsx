import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { fr } from '../../lib/i18n/fr'
import { DeferredLocale } from '../../lib/i18n/LocaleProvider'
import { useLocale } from '../../lib/i18n/useTranslations'
import { aGuestInvitePage, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestInvitePageDto } from '../../lib/api/dto'
import { GuestInvitePage } from './GuestInvitePage'

const TOKEN = '7QX0M4TZ2KD9WB3H'

/** Before the party of `aGuestInvitePage` (12 December 2026), whatever day the suite runs on. */
const BEFORE = Date.parse('2026-11-21T10:00:00Z')
const AFTER = Date.parse('2026-12-12T20:00:00Z')

const answering = (page: Partial<GuestInvitePageDto> = {}): Partial<Api> => ({
  guestInvitePage: vi.fn(async () => aGuestInvitePage(page)),
})

/** What `InvitationLayout` does: the reader’s own language until the invitation says its own. */
function Surface() {
  const { locale } = useLocale()
  return (
    <DeferredLocale fallback={locale}>
      <GuestInvitePage />
    </DeferredLocale>
  )
}

const render = (api: Api, locale: 'fr' | 'de' = 'fr') =>
  renderWithProviders(<Surface />, { api, route: `/i/${TOKEN}`, path: '/i/:token', locale })

/** The reader is in Montreal, which is not where the party is. */
const readerIn = (timeZone: string) =>
  vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GuestInvitePage', () => {
  it('says the invitation is on its way while the first answer is', () => {
    render(fakeApi({ guestInvitePage: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.guestInvite.page.loading)
  })

  it('asks for the invitation of the link it was opened with', async () => {
    const api = fakeApi(answering())
    render(api)

    await screen.findByRole('heading', { level: 1 })

    expect(api.guestInvitePage).toHaveBeenCalledWith(TOKEN, expect.anything())
  })

  describe('before the party', () => {
    it('shows the title, when and where, the host’s word and the way to the calendar', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(BEFORE)
      readerIn('Europe/Paris')
      render(fakeApi(answering()))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' }),
      ).toBeVisible()
      expect(screen.getByText(fr.guestInvite.page.eyebrow)).toBeVisible()
      expect(screen.getByText('samedi 12 décembre 2026')).toBeVisible()
      expect(screen.getByText('19 h – 2 h')).toBeVisible()
      expect(screen.getByText('La Guinguette du Port')).toBeVisible()
      expect(screen.getByText(/12 quai de la Loire/)).toBeVisible()
      expect(screen.getByText('Apéro à 19 h, dîner à 20 h 30.')).toBeVisible()
      expect(screen.getByRole('button', { name: fr.guestInvite.page.agenda })).toBeVisible()
      expect(screen.getByText(fr.guestInvite.page.tonight)).toBeVisible()
    })

    it('offers no way into the wall: the evening has not begun', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(BEFORE)
      render(fakeApi(answering()))
      await screen.findByRole('heading', { level: 1 })

      expect(screen.queryByRole('link', { name: fr.guestInvite.page.join })).toBeNull()
      expect(screen.queryByText(fr.guestInvite.page.live)).toBeNull()
    })

    it('says the wall is not open yet when the hour has come and the host has not opened it', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(AFTER)
      render(fakeApi(answering()))

      expect(await screen.findByText(fr.guestInvite.page.notOpen)).toBeVisible()
      expect(screen.queryByText(fr.guestInvite.page.tonight)).toBeNull()
    })

    it('links the directions to a search built from the address, in a new tab', async () => {
      render(fakeApi(answering()))

      const link = await screen.findByRole('link', {
        name: new RegExp(fr.guestInvite.page.itinerary),
      })

      expect(link).toHaveAttribute(
        'href',
        'https://www.openstreetmap.org/search?query=La%20Guinguette%20du%20Port%2C%2012%20quai%20de%20la%20Loire%2C%2044000%20Nantes',
      )
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('leaves the place out when the host gave none, and the directions with it', async () => {
      render(fakeApi(answering({ venueName: null, address: null })))
      await screen.findByRole('heading', { level: 1 })

      expect(screen.queryByText(fr.guestInvite.page.where)).toBeNull()
      expect(
        screen.queryByRole('link', { name: new RegExp(fr.guestInvite.page.itinerary) }),
      ).toBeNull()
    })

    it('leaves the word out when there is none', async () => {
      render(fakeApi(answering({ message: null })))
      await screen.findByRole('heading', { level: 1 })

      expect(screen.queryByText('Apéro à 19 h, dîner à 20 h 30.')).toBeNull()
    })

    it('shows what the hour is where the reader is, when that reads differently', async () => {
      readerIn('America/Montreal')
      render(fakeApi(answering()))

      expect(await screen.findByText('Soit samedi 13 h à Montreal')).toBeVisible()
      // The hour of the place is still the first thing said.
      expect(screen.getByText('19 h – 2 h')).toBeVisible()
    })

    it('says nothing more to a reader in the party’s own zone', async () => {
      readerIn('Europe/Paris')
      render(fakeApi(answering()))
      await screen.findByRole('heading', { level: 1 })

      expect(screen.queryByText(/^Soit /)).toBeNull()
    })

    it('shows the host’s word as text: a link in it is not one', async () => {
      render(fakeApi(answering({ message: 'Tout est sur https://exemple.test/ici <b>merci</b>' })))

      expect(await screen.findByText(/Tout est sur https:\/\/exemple.test\/ici/)).toBeVisible()
      expect(screen.queryByRole('link', { name: /exemple.test/ })).toBeNull()
      expect(document.querySelector('b')).toBeNull()
    })
  })

  describe('the party is on', () => {
    const live = answering({ state: 'joinable', joinUrl: '/join/H7K2QM' })

    it('leads with a button into the wall, which goes to the join page of the moment', async () => {
      render(fakeApi(live))

      const join = await screen.findByRole('link', { name: fr.guestInvite.page.join })
      expect(join).toHaveAttribute('href', '/join/H7K2QM')
      expect(screen.getByText(fr.guestInvite.page.live)).toBeVisible()
    })

    it('still shows when and where', async () => {
      render(fakeApi(live))

      expect(await screen.findByText('La Guinguette du Port')).toBeVisible()
      expect(screen.getByText('samedi 12 décembre 2026')).toBeVisible()
    })

    it('does not offer the calendar any more: the evening is here', async () => {
      render(fakeApi(live))
      await screen.findByRole('heading', { level: 1 })

      expect(screen.queryByRole('button', { name: fr.guestInvite.page.agenda })).toBeNull()
    })
  })

  describe('after the party', () => {
    const overDto = (): GuestInvitePageDto => {
      const { address: _a, message: _m, ...rest } = aGuestInvitePage({ state: 'over' })
      return rest
    }

    it('says it is over and shows the date: no address, no word, no directions, no way into the wall', async () => {
      render(fakeApi({ guestInvitePage: vi.fn(async () => overDto()) }))

      expect(await screen.findByText(fr.guestInvite.page.over)).toBeVisible()
      expect(screen.getByText('samedi 12 décembre 2026')).toBeVisible()
      expect(screen.getByText('La Guinguette du Port')).toBeVisible()
      expect(screen.queryByText(/quai de la Loire/)).toBeNull()
      expect(screen.queryByText(/Apéro/)).toBeNull()
      expect(
        screen.queryByRole('link', { name: new RegExp(fr.guestInvite.page.itinerary) }),
      ).toBeNull()
      expect(screen.queryByRole('link', { name: fr.guestInvite.page.join })).toBeNull()
      expect(screen.queryByRole('button', { name: fr.guestInvite.page.agenda })).toBeNull()
    })
  })

  describe('a link that no longer opens anything', () => {
    const refusing = (): Partial<Api> => ({
      guestInvitePage: vi.fn(async () => {
        throw new ApiError(404, 'guestInvite.notAvailable')
      }),
    })

    it('is one sentence, whatever killed the link', async () => {
      render(fakeApi(refusing()))

      expect(
        await screen.findByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
      ).toBeVisible()
      expect(screen.getByText(fr.guestInvite.page.goneSub)).toBeVisible()
      expect(screen.getByText(fr.guestInvite.page.madeWith)).toBeVisible()
      expect(screen.queryByRole('button')).toBeNull()
    })

    it('is in the reader’s own language: it has no language of its own', async () => {
      render(fakeApi(refusing()), 'de')

      expect(
        await screen.findByRole('heading', { level: 1, name: de.guestInvite.page.gone }),
      ).toBeVisible()
    })
  })

  describe('a failure that is not the link’s', () => {
    it('says so, and tries again on request', async () => {
      const read = vi
        .fn<Api['guestInvitePage']>()
        .mockRejectedValueOnce(ApiError.network())
        .mockResolvedValue(aGuestInvitePage())
      render(fakeApi({ guestInvitePage: read }))

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.guestInvite.page.failed)
      await userEvent.click(screen.getByRole('button', { name: fr.guestInvite.page.retry }))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' }),
      ).toBeVisible()
      expect(read).toHaveBeenCalledTimes(2)
    })
  })

  describe('the invitation’s language, not the reader’s', () => {
    it('reads in the language the host chose, for a reader who browses in another', async () => {
      render(fakeApi(answering({ language: 'de' })), 'fr')

      expect(await screen.findByText(de.guestInvite.page.eyebrow)).toBeVisible()
      expect(screen.getByText(de.guestInvite.page.when)).toBeVisible()
      expect(
        screen.getByText('Samstag, 12. Dezember 2026'.toLowerCase(), { exact: false }),
      ).toBeVisible()
      expect(screen.queryByText(fr.guestInvite.page.when)).toBeNull()
    })

    it('leaves the host’s own words as written, whatever the language', async () => {
      render(fakeApi(answering({ language: 'de' })))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' }),
      ).toBeVisible()
      expect(screen.getByText('Apéro à 19 h, dîner à 20 h 30.')).toBeVisible()
    })
  })

  describe('the event’s colour', () => {
    const article = (): HTMLElement => {
      const found = document.querySelector('article')
      if (found === null) throw new Error('no invitation on screen')
      return found
    }

    it('wears the event’s accent, as the other guest pages do', async () => {
      render(fakeApi(answering({ accentHue: 345 })))
      await screen.findByRole('heading', { level: 1 })

      expect(article()).toHaveAttribute('data-event-accent', '345')
      expect(article().style.getPropertyValue('--accent-hue')).toBe('345')
    })

    it('says nothing when the event kept the product’s own hue', async () => {
      render(fakeApi(answering({ accentHue: 305 })))
      await screen.findByRole('heading', { level: 1 })

      expect(article()).not.toHaveAttribute('data-event-accent')
    })
  })

  describe('the logo', () => {
    it('shows the event’s own logo when it has one', async () => {
      render(fakeApi(answering({ logoUrl: `/api/i/${TOKEN}/logo` })))

      const logo = await screen.findByRole('img', {
        name: fr.guestInvite.page.logoAlt('Léa fête ses 40 ans'),
      })
      expect(logo).toHaveAttribute('src', `/api/i/${TOKEN}/logo`)
    })

    it('draws the initials of the title in a disc when it has none', async () => {
      render(fakeApi(answering()))

      expect(await screen.findByText('LF')).toBeVisible()
      expect(screen.queryByRole('img')).toBeNull()
    })
  })

  describe('the way to report', () => {
    it('leads to the operator’s contact on the About page, and says who made the invitation', async () => {
      render(fakeApi(answering()))

      const report = await screen.findByRole('link', { name: fr.guestInvite.page.report })
      expect(report).toHaveAttribute('href', '/about#about-operator-title')
      expect(screen.getByText(fr.guestInvite.page.madeWith)).toBeVisible()
    })
  })

  describe('the page asks nobody not to index it', () => {
    it('carries noindex on every screen', async () => {
      render(fakeApi(answering()))
      await screen.findByRole('heading', { level: 1 })

      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex,nofollow',
      )
    })
  })

  describe('reading again when the page comes back to the front', () => {
    it('shows the way into the wall once the host has opened the evening, with no reload', async () => {
      const read = vi
        .fn<Api['guestInvitePage']>()
        .mockResolvedValueOnce(aGuestInvitePage())
        .mockResolvedValue(aGuestInvitePage({ state: 'joinable', joinUrl: '/join/H7K2QM' }))
      render(fakeApi({ guestInvitePage: read }))
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByRole('link', { name: fr.guestInvite.page.join })).toBeNull()

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expect(await screen.findByRole('link', { name: fr.guestInvite.page.join })).toHaveAttribute(
        'href',
        '/join/H7K2QM',
      )
    })

    it('follows a new join code: the old button would lead nowhere', async () => {
      const read = vi
        .fn<Api['guestInvitePage']>()
        .mockResolvedValueOnce(aGuestInvitePage({ state: 'joinable', joinUrl: '/join/H7K2QM' }))
        .mockResolvedValue(aGuestInvitePage({ state: 'joinable', joinUrl: '/join/Z9Z9Z9' }))
      render(fakeApi({ guestInvitePage: read }))
      expect(await screen.findByRole('link', { name: fr.guestInvite.page.join })).toHaveAttribute(
        'href',
        '/join/H7K2QM',
      )

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await waitFor(() =>
        expect(screen.getByRole('link', { name: fr.guestInvite.page.join })).toHaveAttribute(
          'href',
          '/join/Z9Z9Z9',
        ),
      )
    })

    it('replaces the invitation by the one sentence when the host has since switched it off', async () => {
      const read = vi
        .fn<Api['guestInvitePage']>()
        .mockResolvedValueOnce(aGuestInvitePage())
        .mockRejectedValue(new ApiError(404, 'guestInvite.notAvailable'))
      render(fakeApi({ guestInvitePage: read }))
      await screen.findByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' })

      fireEvent(window, new Event('focus'))

      expect(
        await screen.findByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
      ).toBeVisible()
    })

    it('keeps the invitation on screen when the second read fails for the network', async () => {
      const read = vi
        .fn<Api['guestInvitePage']>()
        .mockResolvedValueOnce(aGuestInvitePage())
        .mockRejectedValue(ApiError.network())
      render(fakeApi({ guestInvitePage: read }))
      await screen.findByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' })

      fireEvent(window, new Event('focus'))
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2))

      expect(screen.getByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' })).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('asks one thing at a time: a focus while a read is running asks nothing more', async () => {
      let resolve: (page: GuestInvitePageDto) => void = () => undefined
      const read = vi.fn<Api['guestInvitePage']>(
        () => new Promise<GuestInvitePageDto>((r) => (resolve = r)),
      )
      render(fakeApi({ guestInvitePage: read }))

      fireEvent(window, new Event('focus'))
      fireEvent(window, new Event('focus'))
      expect(read).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolve(aGuestInvitePage())
      })
      expect(await screen.findByRole('heading', { level: 1 })).toBeVisible()
    })

    it('does not read when the page is hidden', async () => {
      const read = vi.fn<Api['guestInvitePage']>(async () => aGuestInvitePage())
      render(fakeApi({ guestInvitePage: read }))
      await screen.findByRole('heading', { level: 1 })
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

      document.dispatchEvent(new Event('visibilitychange'))

      expect(read).toHaveBeenCalledTimes(1)
    })
  })

  describe('adding to the calendar', () => {
    it('makes the .ics in the browser, with the title and the link, and sends nothing', async () => {
      const blobs: Blob[] = []
      Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          blobs.push(blob)
          return 'blob:invitation'
        }),
        revokeObjectURL: vi.fn(),
      })
      const clicked = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined)
      render(fakeApi(answering()))

      await userEvent.click(await screen.findByRole('button', { name: fr.guestInvite.page.agenda }))

      expect(clicked).toHaveBeenCalledTimes(1)
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blobs[0] as Blob)
      })
      expect(text).toContain('BEGIN:VEVENT')
      expect(text).toContain('SUMMARY:Léa fête ses 40 ans')
      expect(text).toContain('DTSTART:20261212T180000Z')
      expect(text).toContain('DTEND:20261213T010000Z')
      expect(text).not.toContain(TOKEN)
    })
  })
})
