import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { PrintKitPage } from './PrintKitPage'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
import { fr } from '../../lib/i18n/fr'
import { qrPatternOf } from '../../testing/qrPattern'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventDto } from '../../lib/api/dto'
import { flushPromises } from '../../testing/flushPromises'

const JOIN_URL = 'https://app.eventslide.fr/join/H7K2QM'

const renderPage = (api: Api) =>
  renderWithProviders(<PrintKitPage />, {
    api,
    route: '/admin/events/camille-et-sacha/print',
    path: '/admin/events/:slug/print',
  })

const apiFor = (overrides: Partial<EventDto> = {}) =>
  fakeApi({
    getEvent: vi.fn(async () =>
      anEventDto({
        slug: 'camille-et-sacha',
        name: 'Camille & Sacha',
        status: 'live',
        joinCode: 'H7K2QM',
        joinUrl: JOIN_URL,
        ...overrides,
      }),
    ),
  })

const sheet = () => document.querySelector<HTMLElement>('[data-format]')
const firstQr = (): HTMLElement => {
  const qr = within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })[0]
  if (qr === undefined) throw new Error('no QR on the sheet')
  return qr
}

const patternOfUrl = (url: string, level: 'M' | 'H' = 'M') => {
  const { container, unmount } = render(<QRCodeSVG value={url} level={level} marginSize={4} />)
  const pattern = qrPatternOf(container)
  unmount()
  return pattern
}

const KEY = 'eventslide.print.camille-et-sacha'

type User = ReturnType<typeof userEvent.setup>
const openPanel = (user: User, name: string) => user.click(screen.getByRole('tab', { name }))

/** A phone: the media query of the page's phone layout matches, nothing else does. */
const stubPhone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 47.99rem'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PrintKitPage', () => {
  it('draws the QR of the link the server gave, whatever the browser address is', async () => {
    renderPage(apiFor())

    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    // `window.location.origin` is not the join origin: a QR built from it would differ.
    expect(window.location.origin).not.toBe('https://app.eventslide.fr')
    expect(qrPatternOf(firstQr())).not.toBe(patternOfUrl(window.location.origin + '/join/H7K2QM'))
    expect(qrPatternOf(firstQr())).toBe(patternOfUrl(JOIN_URL))
  })

  it('leaves four modules of paper round the code (viewBox is N + 8)', async () => {
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    const { container, unmount } = render(<QRCodeSVG value={JOIN_URL} level="M" marginSize={0} />)
    const bare = Number(container.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2])
    unmount()

    const drawn = firstQr().querySelector('svg')?.getAttribute('viewBox')
    expect(drawn).toBe(`0 0 ${bare + 8} ${bare + 8}`)
  })

  it('prints in the language of the wall, not the one of the console', async () => {
    renderPage(apiFor({ settings: eventSettings({ wallLanguage: 'de' }) }))

    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    expect(sheet()).toHaveAttribute('lang', 'de')
    expect(screen.getAllByText(de.printKit.title).length).toBeGreaterThan(0)
    // The console itself stays French.
    expect(screen.getByRole('button', { name: fr.admin.printKitPrint })).toBeInTheDocument()
  })

  it('never translates the name of the event', async () => {
    renderPage(apiFor({ name: 'Camille & Sacha', settings: eventSettings({ wallLanguage: 'de' }) }))

    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    expect(within(sheet() as HTMLElement).getAllByText('Camille & Sacha').length).toBeGreaterThan(0)
  })

  it('lets the host pick another language and a format, and remembers both without the code', async () => {
    const user = userEvent.setup()
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    await user.selectOptions(screen.getByLabelText(fr.admin.printKitLanguage), 'en')
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatShortA4 }))

    expect(sheet()).toHaveAttribute('lang', 'en')
    expect(sheet()).toHaveAttribute('data-format', 'a4')
    const stored = window.localStorage.getItem('eventslide.print.camille-et-sacha') ?? ''
    expect(JSON.parse(stored)).toEqual({ format: 'a4', language: 'en' })
    expect(stored).not.toContain('H7K2QM')
  })

  it('inks the QR in the event colour on request, with the hue of the event, and remembers it', async () => {
    const user = userEvent.setup()
    renderPage(
      apiFor({
        settings: eventSettings({
          theme: { ...DEFAULT_EVENT_THEME, accentHue: 345 },
        }),
      }),
    )
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })
    await openPanel(user, fr.admin.printPanelColours)
    expect(screen.getByRole('radio', { name: fr.admin.printInkBlack })).toBeChecked()
    expect(sheet()).toHaveAttribute('data-ink', 'black')

    await user.click(screen.getByRole('radio', { name: fr.admin.printInkEvent }))

    expect(sheet()).toHaveAttribute('data-ink', 'event')
    expect(sheet()?.style.getPropertyValue('--accent-hue')).toBe('345')
    expect(window.localStorage.getItem('eventslide.print.camille-et-sacha')).toContain('"event"')
  })

  it('links the @page rule only while the page is mounted', async () => {
    const { unmount } = renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })
    expect(document.head.querySelectorAll('link[data-print-page]')).toHaveLength(1)

    unmount()

    expect(document.head.querySelectorAll('link[data-print-page]')).toHaveLength(0)
  })

  it('shows 4, 2 or 1 copies for the three formats', async () => {
    window.localStorage.setItem(KEY, '{"panel":"print"}')
    const user = userEvent.setup()
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    expect(within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(4)
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatShortA5 }))
    expect(within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatShortA4 }))
    expect(within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(1)
  })

  it('prints no sheet for an archived event', async () => {
    renderPage(apiFor({ status: 'archived' }))

    expect(await screen.findByText(fr.admin.printKitArchived)).toBeInTheDocument()
    expect(sheet()).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.printKitPrint })).toBeNull()
    expect(screen.getByRole('link', { name: fr.admin.printKitBack })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha',
    )
  })

  it('prints a closed event with a notice', async () => {
    renderPage(apiFor({ status: 'closed' }))

    expect(await screen.findByText(fr.admin.printKitClosed)).toBeInTheDocument()
    expect(sheet()).not.toBeNull()
  })

  it('prints a draft with a notice', async () => {
    renderPage(apiFor({ status: 'draft' }))

    expect(await screen.findByText(fr.admin.printKitDraft)).toBeInTheDocument()
    expect(sheet()).not.toBeNull()
  })

  it('warns when the link is too long for the card, and not on the poster', async () => {
    // The default design draws a 5 cm code on the card: this link needs 89 modules, 0.57 mm each.
    const long = `https://app.eventslide.fr/${'a'.repeat(400)}/join/H7K2QM`
    const user = userEvent.setup()
    renderPage(apiFor({ joinUrl: long }))

    expect(await screen.findByText(fr.admin.printKitLongLink)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatShortA4 }))
    expect(screen.queryByText(fr.admin.printKitLongLink)).toBeNull()
  })

  it('reloads the code before printing, and prints the new one', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    const getEvent = vi.fn(async () => anEventDto({ joinCode: 'H7K2QM', joinUrl: JOIN_URL }))
    renderPage(fakeApi({ getEvent }))
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })
    getEvent.mockResolvedValueOnce(
      anEventDto({ joinCode: 'ZZZZZZ', joinUrl: 'https://app.eventslide.fr/join/ZZZZZZ' }),
    )

    await user.click(screen.getByRole('button', { name: fr.admin.printKitPrint }))

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(screen.getByText(fr.admin.printKitCodeChanged)).toBeInTheDocument()
    expect(qrPatternOf(firstQr())).toBe(patternOfUrl('https://app.eventslide.fr/join/ZZZZZZ'))
  })

  it('does not print when the reload of the code failed', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    const getEvent = vi.fn(async () => anEventDto({ joinUrl: JOIN_URL }))
    renderPage(fakeApi({ getEvent }))
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })
    getEvent.mockRejectedValueOnce(ApiError.network())

    await user.click(screen.getByRole('button', { name: fr.admin.printKitPrint }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await flushPromises()
    expect(print).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeInTheDocument()
  })

  it('does not throw when the browser has no print()', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('print', undefined)
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    await user.click(screen.getByRole('button', { name: fr.admin.printKitPrint }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: fr.admin.printKitPrint })).toBeEnabled(),
    )
    vi.unstubAllGlobals()
  })

  it('still renders when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatShortA4 }))

    expect(sheet()).toHaveAttribute('data-format', 'a4')
  })

  it('names its controls: radios, a labelled select, a named QR', async () => {
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    // The open entry (Modèle) holds fifteen designs; the toolbar holds the three formats.
    expect(screen.getAllByRole('radio')).toHaveLength(18)
    expect(screen.getByRole('radio', { name: fr.admin.printFormatShortCard })).toBeChecked()
    expect(screen.getByRole('combobox', { name: fr.admin.printKitLanguage })).toBeInTheDocument()
    expect(firstQr()).toHaveAccessibleName(fr.admin.qrAlt('Camille & Sacha'))
  })

  it('names the failure of the first read and offers a retry', async () => {
    const getEvent = vi.fn(async () => anEventDto())
    getEvent.mockRejectedValueOnce(ApiError.network())
    renderPage(fakeApi({ getEvent }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeInTheDocument()
  })

  describe('the card itself (spec 28)', () => {
    it('opens on the plain design and prints the chosen one on every copy, remembered', async () => {
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      // The copy for the paper is the last sheet in the page: every copy of it wears the design.
      const paper = () => [...document.querySelectorAll('[data-format]')].at(-1) as HTMLElement
      const cards = () => [...paper().querySelectorAll('[data-print-card]')]
      expect(cards().map((card) => card.getAttribute('data-print-card'))).toEqual(
        Array(4).fill('essentiel'),
      )

      await user.click(screen.getByRole('radio', { name: fr.admin.printDesignNames.billet }))

      expect(cards().map((card) => card.getAttribute('data-print-card'))).toEqual(
        Array(4).fill('billet'),
      )
      expect(window.localStorage.getItem('eventslide.print.camille-et-sacha')).toContain(
        '"design":"billet"',
      )
    })

    it('prints the name of the event until the host types a title, and the title after', async () => {
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelTexts)
      const titles = () => within(sheet() as HTMLElement).getAllByRole('heading', { level: 2 })
      expect(titles()[0]).toHaveTextContent('Camille & Sacha')

      await user.type(screen.getByLabelText(fr.admin.printKitTitleField), 'Les 40 ans de Léa')

      expect(titles()[0]).toHaveTextContent('Les 40 ans de Léa')
      await user.clear(screen.getByLabelText(fr.admin.printKitTitleField))
      expect(titles()[0]).toHaveTextContent('Camille & Sacha')
    })

    it('prints the table and the usual line in the language of the evening, not the console', async () => {
      const user = userEvent.setup()
      renderPage(apiFor({ settings: eventSettings({ wallLanguage: 'de' }) }))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelTexts)

      await user.type(screen.getByLabelText(fr.admin.printKitTable), '7')

      expect(sheet()).toHaveTextContent(de.printKit.title)
      expect(sheet()).toHaveTextContent(de.printKit.table('7'))
    })

    it('draws the card in a swatch the host picks, its hue driving the shades, and back', async () => {
      const user = userEvent.setup()
      renderPage(
        apiFor({ settings: eventSettings({ theme: { ...DEFAULT_EVENT_THEME, accentHue: 345 } }) }),
      )
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelColours)
      expect(sheet()?.style.getPropertyValue('--pd-color')).toBe('oklch(58% 0.14 345)')

      await user.click(screen.getByRole('radio', { name: fr.admin.printSwatchNames.fir }))

      expect(sheet()?.style.getPropertyValue('--pd-color')).toBe('#2e6b4f')
      expect(sheet()?.style.getPropertyValue('--accent-hue')).toBe('161')
      await user.click(screen.getByRole('radio', { name: fr.admin.printKitColourEvent }))
      expect(sheet()?.style.getPropertyValue('--accent-hue')).toBe('345')
      expect(window.localStorage.getItem('eventslide.print.camille-et-sacha')).not.toContain(
        '"colour"',
      )
    })

    it('puts the photograph kept in this browser on the card, and never sends it', async () => {
      const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      window.localStorage.setItem('eventslide.printPhoto.camille-et-sacha', photo)
      const api = apiFor()
      const user = userEvent.setup()
      renderPage(api)
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await user.click(screen.getByRole('radio', { name: fr.admin.printDesignNames.classique }))

      expect(sheet()?.querySelector('img')).toHaveAttribute('src', photo)
      await openPanel(user, fr.admin.printKitPhoto)
      await user.click(screen.getByRole('button', { name: fr.admin.printKitPhotoRemove }))
      expect(sheet()?.querySelector('img')).toBeNull()
      expect(window.localStorage.getItem('eventslide.printPhoto.camille-et-sacha')).toBeNull()
    })

    it('starts from the other event’s own card when the host moves from one event to another', async () => {
      window.localStorage.setItem('eventslide.print.camille-et-sacha', '{"design":"billet"}')
      window.localStorage.setItem('eventslide.print.lea', '{"design":"nuit"}')
      const Elsewhere = () => {
        const navigate = useNavigate()
        return <button onClick={() => navigate('/admin/events/lea/print')}>Ailleurs</button>
      }
      const user = userEvent.setup()
      renderWithProviders(
        <>
          <PrintKitPage />
          <Elsewhere />
        </>,
        {
          api: fakeApi({
            getEvent: vi.fn(async (slug: string) =>
              anEventDto({
                slug,
                name: slug,
                status: 'live',
                joinCode: 'H7K2QM',
                joinUrl: JOIN_URL,
              }),
            ),
          }),
          route: '/admin/events/camille-et-sacha/print',
          path: '/admin/events/:slug/print',
        },
      )
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      expect(sheet()?.querySelector('[data-print-card]')).toHaveAttribute(
        'data-print-card',
        'billet',
      )

      await user.click(screen.getByRole('button', { name: 'Ailleurs' }))

      await waitFor(() =>
        expect(sheet()?.querySelector('[data-print-card]')).toHaveAttribute(
          'data-print-card',
          'nuit',
        ),
      )
    })

    it('says before printing that a full-background design takes a lot of ink', async () => {
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      expect(screen.queryByText(fr.admin.printKitInkHeavy)).toBeNull()

      await user.click(screen.getByRole('radio', { name: fr.admin.printDesignNames.nuit }))

      expect(screen.getByText(fr.admin.printKitInkHeavy)).toBeInTheDocument()
    })
  })

  describe('the event logo at the centre of the QR', () => {
    const LOGO = `/api/events/camille-et-sacha/logo/${'a'.repeat(64)}`
    const withLogo = (logoUrl: string | null) =>
      apiFor({ settings: eventSettings({ brand: { welcomeMessage: null, logoUrl } }) })

    /** jsdom loads no image: this one answers when the test says so. */
    const stubImages = () => {
      const pending: Array<() => void> = []
      class FakeImage {
        onload: (() => void) | null = null
        set src(_value: string) {
          pending.push(() => this.onload?.())
        }
      }
      vi.stubGlobal('Image', FakeImage)
      return () => pending.splice(0).forEach((arrive) => arrive())
    }
    afterEach(() => vi.unstubAllGlobals())

    it('offers the logo only when the event has one', async () => {
      const user = userEvent.setup()
      renderPage(withLogo(null))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelColours)
      expect(screen.queryByRole('checkbox', { name: fr.admin.printKitLogo })).toBeNull()
    })

    it('never draws a logo address the server did not mint', async () => {
      const user = userEvent.setup()
      renderPage(withLogo('https://evil.example/logo.png'))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelColours)
      expect(screen.queryByRole('checkbox', { name: fr.admin.printKitLogo })).toBeNull()
      expect(sheet()?.querySelector('image')).toBeNull()
    })

    it('draws it in the centre at level H, remembers the choice, and drops it when unticked', async () => {
      const arrive = stubImages()
      const user = userEvent.setup()
      renderPage(withLogo(LOGO))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelColours)
      expect(sheet()?.querySelector('image')).toBeNull()
      const plain = qrPatternOf(firstQr())

      await user.click(screen.getByRole('checkbox', { name: fr.admin.printKitLogo }))
      arrive()

      await waitFor(() => expect(sheet()?.querySelector('image')).not.toBeNull())
      expect(sheet()?.querySelector('image')?.getAttribute('href')).toBe(LOGO)
      // Level H, not M: the pattern differs from the plain code, and is the one H draws.
      expect(qrPatternOf(firstQr())).not.toBe(plain)
      expect(window.localStorage.getItem('eventslide.print.camille-et-sacha')).toContain(
        '"logo":true',
      )
      expect(window.localStorage.getItem('eventslide.print.camille-et-sacha')).not.toContain(LOGO)

      await user.click(screen.getByRole('checkbox', { name: fr.admin.printKitLogo }))
      expect(sheet()?.querySelector('image')).toBeNull()
      expect(qrPatternOf(firstQr())).toBe(plain)
    })

    it('keeps the logo within a fifth of the side', async () => {
      const arrive = stubImages()
      const user = userEvent.setup()
      renderPage(withLogo(LOGO))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      await openPanel(user, fr.admin.printPanelColours)
      await user.click(screen.getByRole('checkbox', { name: fr.admin.printKitLogo }))
      arrive()
      await waitFor(() => expect(sheet()?.querySelector('image')).not.toBeNull())
      const svg = sheet()?.querySelector('svg') as SVGElement
      const side = Number(svg.getAttribute('viewBox')?.split(' ')[2])
      const logo = sheet()?.querySelector('image') as SVGElement
      expect(Number(logo.getAttribute('width')) / side).toBeLessThanOrEqual(0.2)
    })

    it('waits for the logo to arrive before it prints', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => {})
      const arrive = stubImages()
      const user = userEvent.setup()
      window.localStorage.setItem('eventslide.print.camille-et-sacha', '{"logo":true}')
      renderPage(withLogo(LOGO))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      await user.click(screen.getByRole('button', { name: fr.admin.printKitPrint }))
      await flushPromises()
      expect(print).not.toHaveBeenCalled()

      arrive()
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
      expect(sheet()?.querySelector('image')).not.toBeNull()
    })

    it('falls back to the plain code when the logo cannot be loaded', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => {})
      class BrokenImage {
        onerror: (() => void) | null = null
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.())
        }
      }
      vi.stubGlobal('Image', BrokenImage)
      const user = userEvent.setup()
      window.localStorage.setItem('eventslide.print.camille-et-sacha', '{"logo":true}')
      renderPage(withLogo(LOGO))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      await user.click(screen.getByRole('button', { name: fr.admin.printKitPrint }))

      await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
      expect(sheet()?.querySelector('image')).toBeNull()
      expect(qrPatternOf(firstQr())).toBe(patternOfUrl(JOIN_URL))
    })
  })

  describe('the workshop: a rail, one panel, the canvas', () => {
    const ENTRIES = () => [
      fr.admin.printKitDesign,
      fr.admin.printPanelTexts,
      fr.admin.printKitPhoto,
      fr.admin.printPanelColours,
      fr.admin.printPanelPrint,
    ]
    const selectedTab = () => screen.getByRole('tab', { selected: true })

    it('offers five entries as a tablist and shows the panel the open one controls', async () => {
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      const tabs = within(screen.getByRole('tablist', { name: fr.admin.printWorkshopLabel }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
      expect(tabs).toEqual(ENTRIES())
      expect(selectedTab()).toHaveTextContent(fr.admin.printKitDesign)
      const panel = screen.getByRole('tabpanel')
      expect(selectedTab()).toHaveAttribute('aria-controls', panel.id)
      expect(panel).toHaveAttribute('aria-labelledby', selectedTab().id)
      // Only the open entry's controls are in the page.
      expect(screen.queryByLabelText(fr.admin.printKitTitleField)).toBeNull()
    })

    it('moves between entries with the arrows, Home and End, one tab in the tab order', async () => {
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      selectedTab().focus()

      await user.keyboard('{ArrowDown}')
      expect(selectedTab()).toHaveTextContent(fr.admin.printPanelTexts)
      expect(selectedTab()).toHaveFocus()
      expect(screen.getByLabelText(fr.admin.printKitTitleField)).toBeInTheDocument()
      await user.keyboard('{End}')
      expect(selectedTab()).toHaveTextContent(fr.admin.printPanelPrint)
      await user.keyboard('{ArrowDown}')
      expect(selectedTab()).toHaveTextContent(fr.admin.printKitDesign)
      await user.keyboard('{ArrowUp}')
      expect(selectedTab()).toHaveTextContent(fr.admin.printPanelPrint)
      await user.keyboard('{Home}')
      expect(selectedTab()).toHaveTextContent(fr.admin.printKitDesign)
      expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    })

    it('remembers the open entry for this event and reopens on it', async () => {
      const user = userEvent.setup()
      const { unmount } = renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      await openPanel(user, fr.admin.printPanelColours)
      expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ panel: 'colours' })
      unmount()

      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      expect(selectedTab()).toHaveTextContent(fr.admin.printPanelColours)
    })

    it('shows one card while designing and the whole sheet on the printing entry, the host free to switch', async () => {
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      const preview = () => screen.getByRole('region', { name: fr.admin.printKitPreview })
      const copies = () => within(preview()).getAllByRole('img', { name: /QR/ }).length
      expect(screen.getByRole('button', { name: fr.admin.printViewCard })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(copies()).toBe(1)

      await openPanel(user, fr.admin.printPanelPrint)
      expect(screen.getByRole('button', { name: fr.admin.printViewSheet })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(copies()).toBe(4)

      await user.click(screen.getByRole('button', { name: fr.admin.printViewCard }))
      expect(copies()).toBe(1)
      await openPanel(user, fr.admin.printPanelColours)
      expect(copies()).toBe(1)
    })

    it('keeps the full sheet in the page for the paper while the preview shows one card', async () => {
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      const sheets = [...document.querySelectorAll('[data-format]')]
      expect(sheets.map((element) => element.querySelectorAll('[data-print-card]').length)).toEqual(
        [1, 4],
      )
      // The copy for the paper is the one outside the visible preview.
      expect(sheets[1]?.closest('[data-print="sheet"]')).not.toBeNull()
      expect(sheets[0]?.closest('[data-print="off"]')).not.toBeNull()
    })

    it('judges the card colour and the QR ink side by side, with the logo', async () => {
      const user = userEvent.setup()
      const logoUrl = `/api/events/camille-et-sacha/logo/${'a'.repeat(64)}`
      renderPage(apiFor({ settings: eventSettings({ brand: { welcomeMessage: null, logoUrl } }) }))
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      await openPanel(user, fr.admin.printPanelColours)

      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getByRole('radio', { name: fr.admin.printSwatchNames.fir })).toBeInTheDocument()
      expect(panel.getByRole('radio', { name: fr.admin.printInkEvent })).toBeInTheDocument()
      expect(panel.getByRole('checkbox', { name: fr.admin.printKitLogo })).toBeInTheDocument()
    })

    it('puts the format and the language in the toolbar above the preview, with the Print button', async () => {
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })

      const toolbar = within(screen.getByRole('group', { name: fr.admin.printToolbarLabel }))
      expect(toolbar.getAllByRole('radio')).toHaveLength(3)
      expect(toolbar.getByLabelText(fr.admin.printKitLanguage)).toBeInTheDocument()
      expect(toolbar.getByRole('button', { name: fr.admin.printKitPrint })).toBeInTheDocument()
    })

    it('says what is wrong in a slim notice above the canvas, not among the controls', async () => {
      renderPage(apiFor({ status: 'closed' }))

      const notice = await screen.findByText(fr.admin.printKitClosed)

      expect(screen.getByRole('tabpanel')).not.toContainElement(notice)
    })

    it('offers no rail for an archived event', async () => {
      renderPage(apiFor({ status: 'archived' }))
      await screen.findByText(fr.admin.printKitArchived)

      expect(screen.queryByRole('tablist')).toBeNull()
    })

    it('says that a full-background design takes ink on the printing entry too', async () => {
      const user = userEvent.setup()
      window.localStorage.setItem(KEY, '{"design":"nuit","panel":"print"}')
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      expect(screen.getByText(fr.admin.printKitInkHeavy)).toBeInTheDocument()

      await openPanel(user, fr.admin.printKitDesign)
      expect(screen.getByText(fr.admin.printKitInkHeavy)).toBeInTheDocument()
    })

    it('on a phone, moves the format and the language into the printing entry and offers the big view', async () => {
      stubPhone()
      const user = userEvent.setup()
      renderPage(apiFor())
      await screen.findByRole('heading', { name: fr.admin.printKitTitle })
      const toolbar = within(screen.getByRole('group', { name: fr.admin.printToolbarLabel }))
      expect(toolbar.queryAllByRole('radio')).toHaveLength(0)
      expect(toolbar.getByRole('button', { name: fr.admin.printKitPrint })).toBeInTheDocument()

      await openPanel(user, fr.admin.printPanelPrint)
      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getAllByRole('radio')).toHaveLength(3)
      expect(panel.getByRole('combobox', { name: fr.admin.printKitLanguage })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: fr.admin.printSeeBig }))
      expect(screen.getByRole('dialog', { name: fr.admin.printKitPreview })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      // Focus goes back to the button that opened the big view.
      expect(screen.getByRole('button', { name: fr.admin.printSeeBig })).toHaveFocus()
    })
  })
})
