import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import { fr } from '../../../../lib/i18n/fr'
import { en } from '../../../../lib/i18n/en'
import { qrPatternOf } from '../../../../testing/qrPattern'
import {
  aGuestInviteHost,
  aHousehold,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../../../testing/renderWithProviders'
import type { GuestInviteDto, HouseholdDto } from '../../../../lib/api/dto'
import { SHORT_MESSAGE_MAX } from '../../../../lib/invite/cardTexts'
import type * as PrintPhoto from '../../print/printPhoto'
import { PrintTab } from './PrintTab'
import { OutputHarness } from './outputHarness'

const prepare = vi.hoisted(() => vi.fn<(file: Blob) => Promise<string | null>>())
vi.mock('../../print/printPhoto', async (original) => ({
  ...(await original<typeof PrintPhoto>()),
  preparePrintPhoto: prepare,
}))

const JPEG = 'data:image/jpeg;base64,AAAA'
const PHOTO_KEY = 'eventslide.printPhoto.camille-et-sacha'

const text = fr.guestInvite.host
const URL_OF_INVITE = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'

const readyInvite = (overrides: Partial<GuestInviteDto> = {}) => {
  const invite = aGuestInviteHost({ enabled: true, ...overrides })
  return { ...invite, url: invite.url ?? URL_OF_INVITE, startsAt: invite.startsAt ?? '' }
}

const renderTab = (overrides: Partial<GuestInviteDto> = {}, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(
    <OutputHarness
      Output={PrintTab}
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

  it('offers the six designs that have an invitation layout, Essentiel first and chosen', () => {
    renderTab()

    const designs = screen.getAllByRole('radio', {
      name: /^(Essentiel|Ticket de caisse|Souvenir|Billet|Carte d’embarquement|Guirlande)$/,
    })
    expect(designs.map((d) => d.getAttribute('value'))).toEqual([
      'essentiel',
      'ticket',
      'souvenir',
      'billet',
      'embarquement',
      'guirlande',
    ])
    expect(designs[0]).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Classique' })).not.toBeInTheDocument()
    expect(sheet().querySelector('[data-print-card]')).toHaveAttribute(
      'data-print-card',
      'essentiel',
    )
  })

  it('draws the chosen design on the sheet, keeps it, and the QR still leads to the invitation', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: 'Billet' }))

    expect(sheet().querySelector('[data-print-card]')).toHaveAttribute('data-print-card', 'billet')
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ design: 'billet' })
    const { container, unmount } = render(
      <QRCodeSVG value={URL_OF_INVITE} level="M" marginSize={4} />,
    )
    const expected = qrPatternOf(container)
    unmount()
    expect(qrPatternOf(within(sheet()).getAllByRole('img', { name: /QR/ })[0] as HTMLElement)).toBe(
      expected,
    )
  })

  it('has the day, the hours, the place, the address and the link on every design', async () => {
    const user = userEvent.setup()
    renderTab()

    for (const name of [
      'Ticket de caisse',
      'Souvenir',
      'Billet',
      'Carte d’embarquement',
      'Guirlande',
      'Essentiel',
    ]) {
      await user.click(screen.getByRole('radio', { name }))
      const card = sheet().querySelector('[data-print-card]') as HTMLElement
      expect(card, name).toHaveTextContent('19 h')
      expect(card, name).toHaveTextContent('La Guinguette du Port')
      expect(card, name).toHaveTextContent('12 quai de la Loire')
      expect(card, name).toHaveTextContent('photos.example.test/i/7QX0M4TZ2KD9WB3H')
    }
  })

  it('asks for a photograph only for a design that prints one', async () => {
    const user = userEvent.setup()
    renderTab()
    expect(screen.queryByTestId('print-photo-input')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Guirlande' }))

    expect(screen.getByTestId('print-photo-input')).toBeInTheDocument()
    expect(screen.getByText((content) => content === plain(text.photoHint))).toBeInTheDocument()
  })

  it('puts the kept photograph on the card, and takes it off on demand', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(KEY, JSON.stringify({ design: 'billet' }))
    window.localStorage.setItem(PHOTO_KEY, JPEG)
    renderTab()
    expect(sheet().querySelector('img[src^="data:image/jpeg"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: fr.admin.printKitPhotoRemove }))

    expect(sheet().querySelector('img[src^="data:image/jpeg"]')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ design: 'billet' })
    expect(window.localStorage.getItem(PHOTO_KEY)).toBeNull()
  })

  it('shares the photograph with the table cards: the kit’s key holds it, the invitation’s does not', async () => {
    const user = userEvent.setup()
    prepare.mockResolvedValue(JPEG)
    renderTab()
    await user.click(screen.getByRole('radio', { name: 'Billet' }))

    fireEvent.change(screen.getByTestId('print-photo-input'), {
      target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
    })

    await vi.waitFor(() => expect(window.localStorage.getItem(PHOTO_KEY)).toBe(JPEG))
    expect(window.localStorage.getItem(KEY)).not.toContain('data:image')
    expect(screen.queryByText(fr.guestInvite.host.photoNotKept)).not.toBeInTheDocument()
  })

  it('tells the host when the photograph could not be kept on the device, and still shows it', async () => {
    const user = userEvent.setup()
    prepare.mockResolvedValue(JPEG)
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === PHOTO_KEY) throw new Error('quota')
      real.call(this, key, value)
    })
    renderTab()
    await user.click(screen.getByRole('radio', { name: 'Billet' }))

    fireEvent.change(screen.getByTestId('print-photo-input'), {
      target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
    })

    expect(await screen.findByText((c) => c === plain(text.photoNotKept))).toBeInTheDocument()
    expect(sheet().querySelector('img[src^="data:image/jpeg"]')).not.toBeNull()
  })

  it('writes the framing of the photograph once the slider rests, not at every step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      window.localStorage.setItem(PHOTO_KEY, JPEG)
      window.localStorage.setItem(KEY, JSON.stringify({ design: 'billet' }))
      renderTab()
      const slider = screen.getAllByRole('slider')[0] as HTMLInputElement
      const write = vi.spyOn(Storage.prototype, 'setItem')

      fireEvent.change(slider, { target: { value: '10' } })
      fireEvent.change(slider, { target: { value: '20' } })
      fireEvent.change(slider, { target: { value: '30' } })

      expect(write).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(400)
      expect(write).toHaveBeenCalledTimes(1)
      expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toMatchObject({ focusX: 30 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not lose the framing when the page is left before the slider rests', () => {
    window.localStorage.setItem(PHOTO_KEY, JPEG)
    window.localStorage.setItem(KEY, JSON.stringify({ design: 'billet' }))
    const { unmount } = renderTab()
    fireEvent.change(screen.getAllByRole('slider')[0] as HTMLInputElement, {
      target: { value: '42' },
    })

    unmount()

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toMatchObject({ focusX: 42 })
  })

  it('tells a design that is heavy on ink', async () => {
    const user = userEvent.setup()
    renderTab()
    expect(screen.queryByText(fr.admin.printKitInkHeavy)).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Souvenir' }))

    expect(screen.getByText(fr.admin.printKitInkHeavy)).toBeInTheDocument()
  })
})

describe('PrintTab: one card per household (spec 30, lot 3)', () => {
  const martin = aHousehold({ id: 'h-1', name: 'Famille Martin', token: 'AAAAAAAAAAAAAAAA' })
  const durand = aHousehold({ id: 'h-2', name: 'Les Durand', token: 'BBBBBBBBBBBBBBBB' })
  const roux = aHousehold({ id: 'h-3', name: 'Roux', token: 'CCCCCCCCCCCCCCCC' })

  const renderWith = (households: readonly HouseholdDto[]) =>
    renderWithProviders(
      <OutputHarness
        Output={PrintTab}
        event={anEventDto({ slug: 'camille-et-sacha', name: 'Camille & Sacha' })}
        invite={readyInvite()}
      />,
      { api: fakeApi({ households: vi.fn(async () => ({ households })) }) },
    )

  const qrOf = (value: string): string => {
    const { container, unmount } = render(<QRCodeSVG value={value} level="M" marginSize={4} />)
    const pattern = qrPatternOf(container)
    unmount()
    return pattern
  }

  it('offers nothing while the host listed no household, and keeps four identical cards', async () => {
    renderWith([])

    expect(within(sheet()).getAllByRole('img', { name: /QR/ })).toHaveLength(4)
    expect(screen.queryByLabelText(text.printPerHousehold)).not.toBeInTheDocument()
  })

  it('prints a card for each household with its name and its own link in the QR, the secret only in the code', async () => {
    const user = userEvent.setup()
    renderWith([martin, durand, roux])
    await user.click(await screen.findByLabelText(text.printPerHousehold))

    const sheets = document.querySelectorAll<HTMLElement>('[data-household-sheet]')
    expect(sheets).toHaveLength(1)
    const codes = within(sheets[0] as HTMLElement).getAllByRole('img', { name: /QR/ })
    expect(codes).toHaveLength(3)
    expect(qrPatternOf(codes[0] as HTMLElement)).toBe(qrOf(`${URL_OF_INVITE}#f=AAAAAAAAAAAAAAAA`))
    expect(qrPatternOf(codes[1] as HTMLElement)).toBe(qrOf(`${URL_OF_INVITE}#f=BBBBBBBBBBBBBBBB`))
    expect(qrPatternOf(codes[2] as HTMLElement)).toBe(qrOf(`${URL_OF_INVITE}#f=CCCCCCCCCCCCCCCC`))
    for (const name of ['Famille Martin', 'Les Durand', 'Roux']) {
      expect(within(sheets[0] as HTMLElement).getByText(name)).toBeInTheDocument()
    }
    // The secret is not printed as text anywhere on the sheet.
    expect(sheets[0]?.textContent).not.toContain('AAAAAAAAAAAAAAAA')
    expect(sheets[0]?.textContent).not.toContain('#f=')
  })

  it('lays the cards on as many sheets as it takes, four to a sheet, and says so', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, i) =>
      aHousehold({ id: `h-${i}`, name: `Foyer ${i}`, token: `T${String(i).padStart(15, '0')}` }),
    )
    renderWith(many)
    await user.click(await screen.findByLabelText(text.printPerHousehold))

    const sheets = document.querySelectorAll<HTMLElement>('[data-household-sheet]')
    expect(
      Array.from(sheets).map(
        (page) => within(page).getAllByRole('img', { name: /QR/, hidden: true }).length,
      ),
    ).toEqual([4, 4, 1])
    expect(screen.getByText(text.printPerHouseholdHint(9, 3))).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: text.printFormatA5 }))
    expect(document.querySelectorAll('[data-household-sheet]')).toHaveLength(5)
    expect(screen.getByText(text.printPerHouseholdHint(9, 5))).toBeInTheDocument()
  })

  it('warns that each card holds a link to give to that household only, and says the preview shows the first sheet', async () => {
    const user = userEvent.setup()
    renderWith([martin])
    await user.click(await screen.findByLabelText(text.printPerHousehold))

    expect(screen.getByText(plain(text.printPerHouseholdPrivacy))).toBeInTheDocument()
    expect(screen.getByText(plain(text.printPerHouseholdPreview))).toBeInTheDocument()
  })

  it('goes back to the same card repeated when the option is unticked', async () => {
    const user = userEvent.setup()
    renderWith([martin, durand])
    const box = await screen.findByLabelText(text.printPerHousehold)
    await user.click(box)
    expect(document.querySelectorAll('[data-household-sheet]')).toHaveLength(1)

    await user.click(box)

    expect(document.querySelectorAll('[data-household-sheet]')).toHaveLength(0)
    expect(within(sheet()).getAllByRole('img', { name: /QR/ })).toHaveLength(4)
  })

  it('cuts a very long household name for the card, never squeezing it', async () => {
    const user = userEvent.setup()
    renderWith([
      aHousehold({ id: 'h-long', name: 'Famille '.repeat(12).trim(), token: 'DDDDDDDDDDDDDDDD' }),
    ])
    await user.click(await screen.findByLabelText(text.printPerHousehold))

    const card = document.querySelector<HTMLElement>('[data-household-sheet]') as HTMLElement
    expect(card.textContent).toContain('…')
  })
})
