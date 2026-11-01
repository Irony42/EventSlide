import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import { PrintKitPage } from './PrintKitPage'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
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

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
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
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatA4 }))

    expect(sheet()).toHaveAttribute('lang', 'en')
    expect(sheet()).toHaveAttribute('data-format', 'a4')
    const stored = window.localStorage.getItem('eventslide.print.camille-et-sacha') ?? ''
    expect(JSON.parse(stored)).toEqual({ format: 'a4', language: 'en' })
    expect(stored).not.toContain('H7K2QM')
  })

  it('shows 4, 2 or 1 copies for the three formats', async () => {
    const user = userEvent.setup()
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    expect(within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(4)
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatA5 }))
    expect(within(sheet() as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatA4 }))
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

  it('warns when the link is too long for the 4 cm card, and not on the poster', async () => {
    const long = `https://app.eventslide.fr/${'a'.repeat(200)}/join/H7K2QM`
    const user = userEvent.setup()
    renderPage(apiFor({ joinUrl: long }))

    expect(await screen.findByText(fr.admin.printKitLongLink)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatA4 }))
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
    await new Promise((resolve) => setTimeout(resolve, 50))
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

    await user.click(screen.getByRole('radio', { name: fr.admin.printFormatA4 }))

    expect(sheet()).toHaveAttribute('data-format', 'a4')
  })

  it('names its controls: radios, a labelled select, a named QR', async () => {
    renderPage(apiFor())
    await screen.findByRole('heading', { name: fr.admin.printKitTitle })

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: fr.admin.printFormatCard })).toBeChecked()
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
})
