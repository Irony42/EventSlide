import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFakeDevice, type FakeDevice } from '../../../../testing/fakeDevice'
import {
  aGuestInviteHost,
  anEventDto,
  renderWithProviders,
} from '../../../../testing/renderWithProviders'
import { fr } from '../../../../lib/i18n/fr'
import type { GuestInviteDto } from '../../../../lib/api/dto'
import type { RenderPng } from './imageRender'
import { EmailTab } from './EmailTab'

const text = fr.guestInvite.email
const URL_OF_INVITE = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'
const NB = String.fromCodePoint(0x00a0)
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

let device: FakeDevice
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  device = useFakeDevice({ kind: 'desktop' })
  writeText = vi.fn(async () => undefined)
})

afterEach(() => {
  device.restore()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

/** `userEvent.setup()` installs a clipboard stub of its own: the test's is put in after it. */
const tapper = () => {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return user
}

const png = (): Blob => new Blob(['x'.repeat(2048)], { type: 'image/png' })
const ready = () => vi.fn<RenderPng>(async () => png())

const renderTab = (
  render: RenderPng,
  overrides: Partial<GuestInviteDto> = {},
  locale: 'fr' | 'en' = 'fr',
) => {
  const invite = aGuestInviteHost({ enabled: true, ...overrides })
  return renderWithProviders(
    <EmailTab
      event={anEventDto({ slug: 'camille-et-sacha', name: 'Camille & Sacha' })}
      invite={{ ...invite, url: invite.url ?? URL_OF_INVITE, startsAt: invite.startsAt ?? '' }}
      renderPng={render}
    />,
    { locale },
  )
}

const subject = () => screen.getByRole('textbox', { name: text.subjectLabel }) as HTMLInputElement
const message = () =>
  screen.getByRole('textbox', { name: new RegExp(text.bodyLabel) }) as HTMLTextAreaElement
const open = () => screen.getByRole('link', { name: text.open })

/** The subject and the body a mailto link carries. */
const carried = () => {
  const href = open().getAttribute('href') ?? ''
  const [head = '', body = ''] = href.slice('mailto:?'.length).split('&body=')
  return {
    href,
    subject: decodeURIComponent(head.replace('subject=', '')),
    body: decodeURIComponent(body),
  }
}

describe('EmailTab', () => {
  it('has the subject and the message ready: the moment, the place with its address, the whole word, the link', () => {
    renderTab(ready())

    expect(subject().value).toBe(`Invitation${NB}: Léa fête ses 40 ans, samedi 11 décembre`)
    expect(message().value).toContain('Léa fête ses 40 ans, et vous êtes invité·e.')
    expect(message().value).toContain('Samedi 11 décembre 2027, 19 h – 2 h')
    expect(message().value).toContain('La Guinguette du Port, 12 quai de la Loire, 44000 Nantes')
    expect(message().value).toContain('Apéro à 19 h.')
    expect(message().value.endsWith(URL_OF_INVITE)).toBe(true)
  })

  it('writes in the language of the invitation, not the console’s', () => {
    renderTab(ready(), { language: 'en' }, 'fr')

    expect(subject().value).toBe('Invitation: Léa fête ses 40 ans, Saturday, December 11')
    expect(message().value.startsWith('Hello,')).toBe(true)
  })

  it('opens the mail program on exactly what is in the fields, to nobody', () => {
    renderTab(ready())

    expect(carried().href.startsWith('mailto:?subject=')).toBe(true)
    expect(carried().subject).toBe(subject().value)
    expect(carried().body).toBe(message().value)
  })

  it('follows what the host rewrites, for this time', () => {
    renderTab(ready())

    fireEvent.change(subject(), { target: { value: 'Rendez-vous samedi' } })
    fireEvent.change(message(), { target: { value: 'À samedi !\n\n' + URL_OF_INVITE } })

    expect(carried().subject).toBe('Rendez-vous samedi')
    expect(carried().body).toBe('À samedi !\n\n' + URL_OF_INVITE)
  })

  it('counts the encoded length of the link, out of 1 800', () => {
    renderTab(ready())

    const length = carried().href.length
    expect(screen.getByText((c) => c === plain(text.counter(length, 1800)))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(text.counterCut))).not.toBeInTheDocument()
  })

  it('cuts a long word to stay under 1 800, says so, and keeps the link', () => {
    renderTab(ready())

    fireEvent.change(message(), {
      target: { value: `Bonjour\n\n${'é'.repeat(600)}\n\n${URL_OF_INVITE}` },
    })

    expect(carried().href.length).toBeLessThanOrEqual(1800)
    expect(carried().body.endsWith(URL_OF_INVITE)).toBe(true)
    expect(carried().body).toContain('suite sur la page de l’invitation')
    expect(screen.getByText(new RegExp(text.counterCut))).toBeInTheDocument()
    // The field itself still holds all of what the host wrote.
    expect(message().value).toContain('é'.repeat(600))
  })

  it('copies the subject and the message, and says so', async () => {
    const user = tapper()
    renderTab(ready())

    await user.click(screen.getByRole('button', { name: text.copy }))

    expect(writeText).toHaveBeenCalledWith(`${subject().value}\n\n${message().value}`)
    expect(await screen.findByText(text.copied)).toBeInTheDocument()
  })

  it('says when the text could not be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = tapper()
    renderTab(ready())

    await user.click(screen.getByRole('button', { name: text.copy }))

    expect(await screen.findByText((c) => c === plain(text.copyFailed))).toBeInTheDocument()
  })

  it('advises blind copy, and says nothing is sent or kept', () => {
    renderTab(ready())

    expect(screen.getByText(text.bccAdvice)).toBeInTheDocument()
  })

  it('previews the message the way a mail program shows it, with the attachment', async () => {
    renderTab(ready())

    const preview = screen.getByRole('region', { name: text.previewLabel })
    expect(preview).toHaveTextContent(text.previewHeader)
    expect(preview).toHaveTextContent(text.previewBccValue)
    expect(preview).toHaveTextContent(plain(subject().value))
    expect(preview).toHaveTextContent('Léa fête ses 40 ans, et vous êtes invité·e.')
    await waitFor(() => expect(preview).toHaveTextContent('invitation.png · 2 Ko'))
    expect(preview).toHaveTextContent(text.attachmentNote)
  })

  it('makes the square picture of the card with the image tab’s renderer, the address left off it', async () => {
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const [node, size] = render.mock.calls[0] ?? []
    expect(size).toEqual({ width: 1080, height: 1080 })
    expect((node as HTMLElement).dataset['inviteShot']).toBe('square')
    expect(node).toHaveTextContent('La Guinguette du Port')
    expect(node).not.toHaveTextContent('quai de la Loire')
  })

  it('draws the picture with the address when the host turned it on in the image tab', async () => {
    window.localStorage.setItem(
      'eventslide.invite.camille-et-sacha',
      JSON.stringify({ showAddress: true }),
    )
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    expect(render.mock.calls[0]?.[0]).toHaveTextContent('12 quai de la Loire')
  })

  it('downloads the picture to attach once it is made, not before', async () => {
    const user = tapper()
    renderTab(ready())
    expect(screen.getByRole('button', { name: text.rendering })).toBeDisabled()

    const button = await screen.findByRole('button', { name: text.download })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(device.downloads).toEqual([
      { href: expect.stringContaining('blob:'), name: 'invitation.png', connected: true },
    ])
  })

  it('says so when the picture cannot be made, and offers to try again', async () => {
    const user = tapper()
    const render = vi
      .fn<RenderPng>()
      .mockRejectedValueOnce(new Error('no canvas'))
      .mockResolvedValue(png())
    renderTab(render)

    await user.click(await screen.findByRole('button', { name: text.retry }))

    await waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: text.download })).toBeEnabled()
    expect(screen.queryByText(text.renderFailed)).not.toBeInTheDocument()
  })

  it('has the draft of a card without a place or a word', () => {
    renderTab(ready(), { venueName: null, address: null, message: null })

    expect(message().value).not.toContain('Où')
    expect(message().value).toContain('Quand')
  })
})
