import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import { fr } from '../../../../lib/i18n/fr'
import { en } from '../../../../lib/i18n/en'
import { qrPatternOf } from '../../../../testing/qrPattern'
import {
  aGuestInviteHost,
  anEventDto,
  renderWithProviders,
} from '../../../../testing/renderWithProviders'
import type { GuestInviteDto } from '../../../../lib/api/dto'
import { SHORT_MESSAGE_MAX } from '../../../../lib/invite/cardTexts'
import { PrintTab } from './PrintTab'

const text = fr.guestInvite.host
const URL_OF_INVITE = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'

const readyInvite = (overrides: Partial<GuestInviteDto> = {}) => {
  const invite = aGuestInviteHost({ enabled: true, ...overrides })
  return { ...invite, url: invite.url ?? URL_OF_INVITE, startsAt: invite.startsAt ?? '' }
}

const renderTab = (overrides: Partial<GuestInviteDto> = {}, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(
    <PrintTab
      event={anEventDto({ slug: 'camille-et-sacha', name: 'Camille & Sacha' })}
      invite={readyInvite(overrides)}
    />,
    { locale },
  )

const sheet = () => document.querySelector<HTMLElement>('[data-format]') as HTMLElement
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')
const KEY = 'eventslide.invite.camille-et-sacha'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PrintTab', () => {
  it('prints the QR of the invitation link, four to a sheet by default', () => {
    renderTab()

    expect(sheet()).toHaveAttribute('data-format', 'card')
    const qr = within(sheet()).getAllByRole('img', { name: /QR/ })
    expect(qr).toHaveLength(4)
    const { container, unmount } = render(
      <QRCodeSVG value={URL_OF_INVITE} level="M" marginSize={4} />,
    )
    const expected = qrPatternOf(container)
    unmount()
    expect(qrPatternOf(qr[0] as HTMLElement)).toBe(expected)
  })

  it('writes the day, the hours, the place and the address on the card, in the invitation’s zone', () => {
    renderTab()

    const card = sheet()
    expect(card).toHaveTextContent('Léa fête ses 40 ans')
    expect(card).toHaveTextContent('samedi 11 décembre 2027')
    expect(card).toHaveTextContent('19 h – 2 h')
    expect(card).toHaveTextContent('La Guinguette du Port')
    expect(card).toHaveTextContent('12 quai de la Loire')
    expect(card).toHaveTextContent('44000 Nantes')
    expect(card).toHaveTextContent('photos.example.test/i/7QX0M4TZ2KD9WB3H')
  })

  it('reads the card in the language of the invitation, not the console’s', () => {
    renderTab({ language: 'en' }, 'fr')

    expect(sheet()).toHaveTextContent('Invitation')
    expect(sheet()).toHaveTextContent(
      en.guestInvite.card.link('photos.example.test/i/7QX0M4TZ2KD9WB3H'),
    )
    expect(sheet()).toHaveTextContent('Saturday')
  })

  it('falls back to the event’s name when the invitation has no title of its own', () => {
    renderTab({ title: null })

    expect(sheet()).toHaveTextContent('Camille & Sacha')
  })

  it('prints a word that fits as it is, with no line sending to the page', () => {
    renderTab({ message: 'Apéro à 19 h.' })

    expect(sheet()).toHaveTextContent('Apéro à 19 h.')
    expect(sheet()).not.toHaveTextContent(fr.guestInvite.card.more)
    expect(screen.getByText(text.shortAuto)).toBeInTheDocument()
  })

  it('cuts a long word at the card’s limit and says the rest is on the page', () => {
    const long = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    renderTab({ message: long })

    const field = screen.getByRole('textbox', { name: text.shortLabel })
    expect([...(field as HTMLTextAreaElement).value].length).toBeLessThanOrEqual(SHORT_MESSAGE_MAX)
    expect(sheet()).toHaveTextContent('…')
    expect(sheet()).toHaveTextContent(fr.guestInvite.card.more)
  })

  it('prints the host’s own short word once they write one, and keeps it on this device', async () => {
    const user = userEvent.setup()
    renderTab({ message: 'Un très long message. '.repeat(20) })

    const field = screen.getByRole('textbox', { name: text.shortLabel })
    await user.clear(field)
    await user.type(field, 'Venez nombreux')

    expect(sheet()).toHaveTextContent('Venez nombreux')
    expect(screen.queryByText(text.shortAuto)).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({
      short: 'Venez nombreux',
    })
  })

  it('prints no word at all when the host empties the field, instead of the automatic cut coming back', async () => {
    const user = userEvent.setup()
    renderTab({ message: 'Apéro à 19 h.' })

    await user.clear(screen.getByRole('textbox', { name: text.shortLabel }))

    expect(sheet()).not.toHaveTextContent('Apéro')
    expect(screen.getByRole('textbox', { name: text.shortLabel })).toHaveValue('')
  })

  it('offers the way back to the automatic word once the host has written their own, and only then', async () => {
    const user = userEvent.setup()
    renderTab({ message: 'Apéro à 19 h.' })
    expect(screen.queryByRole('button', { name: text.shortReset })).not.toBeInTheDocument()

    const field = screen.getByRole('textbox', { name: text.shortLabel })
    await user.clear(field)
    await user.type(field, 'Autre mot')
    await user.click(screen.getByRole('button', { name: text.shortReset }))

    expect(field).toHaveValue('Apéro à 19 h.')
    expect(screen.getByText(text.shortAuto)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: text.shortReset })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({})
  })

  it('brings the word back after it was emptied', async () => {
    const user = userEvent.setup()
    renderTab({ message: 'Apéro à 19 h.' })
    await user.clear(screen.getByRole('textbox', { name: text.shortLabel }))

    await user.click(screen.getByRole('button', { name: text.shortReset }))

    expect(sheet()).toHaveTextContent('Apéro à 19 h.')
  })

  it('tells A5 is to be printed from a browser that turns the sheet', () => {
    renderTab()

    expect(screen.getByText((content) => content === plain(text.printA5Help))).toBeInTheDocument()
  })

  it('warns when the link is so long that the QR would print too small', () => {
    renderTab({ url: `${URL_OF_INVITE}/${'a'.repeat(900)}` })

    expect(screen.getByText(fr.admin.printKitLongLink)).toBeInTheDocument()
  })

  it('has no such warning for a link of the usual length', () => {
    renderTab()

    expect(screen.queryByText(fr.admin.printKitLongLink)).not.toBeInTheDocument()
  })

  it('counts the characters of the word out of 140', () => {
    renderTab({ message: 'Apéro à 19 h.' })

    expect(screen.getByText(text.shortCount(13, SHORT_MESSAGE_MAX))).toBeInTheDocument()
  })

  it('switches to A5, two to a sheet, and remembers it', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: text.printFormatA5 }))

    expect(sheet()).toHaveAttribute('data-format', 'a5')
    expect(within(sheet()).getAllByRole('img', { name: /QR/ })).toHaveLength(2)
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ format: 'a5' })
  })

  it('starts from the format and the colour kept for this event', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ format: 'a5', colour: '#2a9d8f' }))
    renderTab()

    expect(sheet()).toHaveAttribute('data-format', 'a5')
    expect(screen.getByRole('radio', { name: text.printFormatA5 })).toBeChecked()
  })

  it('picks a colour among the swatches and goes back to the event’s', async () => {
    const user = userEvent.setup()
    renderTab()
    const event = screen.getByRole('radio', { name: fr.admin.printKitColourEvent })
    expect(event).toBeChecked()

    await user.click(
      screen.getAllByRole('radio', { name: fr.admin.printSwatchNames.coral })[0] as HTMLElement,
    )
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}').colour).toMatch(/^#[0-9a-f]{6}$/)

    await user.click(event)
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({})
  })

  it('warns that the address is printed, and prints on demand', async () => {
    const user = userEvent.setup()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderTab()

    expect(screen.getByText((content) => content === plain(text.printHelp))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.printButton }))

    expect(print).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('has no line for a place or an address the host did not give', () => {
    renderTab({ venueName: null, address: null, message: null })

    expect(sheet()).not.toHaveTextContent('Guinguette')
    expect(sheet()).not.toHaveTextContent('quai de la Loire')
  })
})
