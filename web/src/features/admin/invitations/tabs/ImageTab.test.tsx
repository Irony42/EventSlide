import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deferred } from '../../../../testing/deferred'
import { domError, useFakeDevice, type FakeDevice } from '../../../../testing/fakeDevice'
import {
  aGuestInviteHost,
  anEventDto,
  renderWithProviders,
} from '../../../../testing/renderWithProviders'
import { fr } from '../../../../lib/i18n/fr'
import type { GuestInviteDto } from '../../../../lib/api/dto'
import type { RenderPng } from './imageRender'
import { ImageTab } from './ImageTab'

const text = fr.guestInvite.image
const KEY = 'eventslide.invite.camille-et-sacha'
const URL_OF_INVITE = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

let device: FakeDevice
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  device = useFakeDevice({ kind: 'android' })
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

afterEach(() => {
  device.restore()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

/** A user whose clipboard is the test's own: `userEvent.setup()` installs a stub of its own over it. */
const tapper = () => {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return user
}

const png = (): Blob => new Blob(['png'], { type: 'image/png' })

const renderTab = (render: RenderPng, overrides: Partial<GuestInviteDto> = {}) => {
  const invite = aGuestInviteHost({ enabled: true, ...overrides })
  return renderWithProviders(
    <ImageTab
      event={anEventDto({ slug: 'camille-et-sacha', name: 'Camille & Sacha' })}
      invite={{ ...invite, url: invite.url ?? URL_OF_INVITE, startsAt: invite.startsAt ?? '' }}
      renderPng={render}
    />,
  )
}

const ready = () => vi.fn<RenderPng>(async () => png())
const words = () => screen.getByRole('textbox', { name: new RegExp(text.textLabel) })

describe('ImageTab', () => {
  it('makes the image at the size of a square post, from the card on screen', async () => {
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const [node, size] = render.mock.calls[0] ?? []
    expect(size).toEqual({ width: 1080, height: 1080 })
    expect((node as HTMLElement).dataset['inviteShot']).toBe('square')
    expect(node).toHaveTextContent('Léa fête ses 40 ans')
    expect(node).toHaveTextContent('La Guinguette du Port')
  })

  it('switches to a story, 1080 by 1920, adds what a story is read for, and keeps the choice', async () => {
    const user = tapper()
    const render = ready()
    renderTab(render)
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('radio', { name: text.formatStory }))

    await waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    const [node, size] = render.mock.calls[1] ?? []
    expect(size).toEqual({ width: 1080, height: 1920 })
    expect((node as HTMLElement).dataset['inviteShot']).toBe('story')
    expect(node).toHaveTextContent(fr.guestInvite.card.storyTop)
    expect(node).toHaveTextContent('samedi 11 décembre')
    expect(node).toHaveTextContent(fr.guestInvite.card.infos)
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toMatchObject({ shot: 'story' })
  })

  it('leaves the address off the image, and out of the words, until the host asks for it', async () => {
    const user = tapper()
    renderTab(ready())
    const card = () => document.querySelector('[data-invite-shot]') as HTMLElement

    expect(card()).not.toHaveTextContent('quai de la Loire')
    expect((words() as HTMLTextAreaElement).value).not.toContain('quai de la Loire')
    expect(screen.getByRole('checkbox', { name: text.addressLabel })).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: text.addressLabel }))

    expect(card()).toHaveTextContent('12 quai de la Loire')
    expect((words() as HTMLTextAreaElement).value).toContain('12 quai de la Loire, 44000 Nantes')
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      showAddress: true,
    })
  })

  it('has nothing to show with no address to show', () => {
    renderTab(ready(), { address: null })

    expect(screen.getByRole('checkbox', { name: text.addressLabel })).toBeDisabled()
  })

  it('writes the words in the language of the invitation, link last, and lets the host rewrite them', async () => {
    renderTab(ready(), { language: 'en' })
    const field = words() as HTMLTextAreaElement

    expect(field.value.split('\n')[0]).toBe('Léa fête ses 40 ans: you’re invited.')
    expect(field.value.endsWith(URL_OF_INVITE)).toBe(true)

    fireEvent.change(field, { target: { value: 'Mon texte à moi' } })

    expect(field.value).toBe('Mon texte à moi')
  })

  it('keeps the host’s own words when the address is shown or hidden afterwards', async () => {
    const user = tapper()
    renderTab(ready())
    fireEvent.change(words(), { target: { value: 'Mon texte à moi' } })

    await user.click(screen.getByRole('checkbox', { name: text.addressLabel }))

    expect((words() as HTMLTextAreaElement).value).toBe('Mon texte à moi')
  })

  it('shows the image is being prepared, and offers the download once it is made', async () => {
    const pending = deferred<Blob>()
    renderTab(vi.fn<RenderPng>(() => pending.promise))

    expect(screen.getByRole('button', { name: text.rendering })).toBeDisabled()
    expect(screen.queryByRole('button', { name: text.share })).not.toBeInTheDocument()

    await waitFor(() => expect(document.querySelector('[data-invite-shot]')).not.toBeNull())
    pending.resolve(png())

    expect(await screen.findByRole('button', { name: text.download })).toBeEnabled()
  })

  it('says so when the image cannot be made on this device', async () => {
    renderTab(vi.fn<RenderPng>(async () => Promise.reject(new Error('no canvas'))))

    expect(await screen.findByText(text.renderFailed)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.download })).toBeDisabled()
    expect(screen.queryByRole('button', { name: text.share })).not.toBeInTheDocument()
  })

  it('never shows an image made for what the host has changed since', async () => {
    const user = tapper()
    const first = deferred<Blob>()
    const second = deferred<Blob>()
    const render = vi
      .fn<RenderPng>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderTab(render)
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('radio', { name: text.formatStory }))
    first.resolve(png())
    await waitFor(() => expect(render).toHaveBeenCalledTimes(2))

    // The square's image arrived, but the story is what is on screen: no download yet.
    expect(screen.getByRole('button', { name: text.rendering })).toBeDisabled()
    second.resolve(png())
    expect(await screen.findByRole('button', { name: text.download })).toBeEnabled()
  })

  it('downloads the image under a name that says its shape', async () => {
    const user = tapper()
    renderTab(ready())

    await user.click(await screen.findByRole('button', { name: text.download }))

    expect(device.downloads).toEqual([
      { href: expect.stringContaining('blob:'), name: 'invitation-square.png' },
    ])
    expect(screen.getByText(text.downloaded)).toBeInTheDocument()
  })

  it('shares the image and the words from the tap, and copies the words first', async () => {
    const user = tapper()
    renderTab(ready())

    await user.click(await screen.findByRole('button', { name: text.share }))

    await waitFor(() => expect(device.shared).toHaveLength(1))
    const [data] = device.shared
    expect(data?.files?.[0]?.type).toBe('image/png')
    expect(data?.files?.[0]?.name).toBe('invitation-square.png')
    expect(data?.text).toBe((words() as HTMLTextAreaElement).value)
    expect(writeText).toHaveBeenCalledWith((words() as HTMLTextAreaElement).value)
    expect(await screen.findByText((c) => c === plain(text.copiedBeforeShare))).toBeInTheDocument()
  })

  it('starts the copy and the share in the same tap, before anything is awaited', async () => {
    const order: string[] = []
    writeText.mockImplementation(async () => {
      order.push('copy')
    })
    device.restore()
    device = useFakeDevice({
      kind: 'iphone',
      share: async () => {
        order.push('share')
      },
    })
    const user = tapper()
    renderTab(ready())

    await user.click(await screen.findByRole('button', { name: text.share }))

    await waitFor(() => expect(order).toEqual(['copy', 'share']))
  })

  it('has no share button on a device that cannot share files, but still downloads and copies', async () => {
    device.restore()
    device = useFakeDevice({ kind: 'desktop', canShareFiles: false })
    const user = tapper()
    renderTab(ready())

    expect(await screen.findByRole('button', { name: text.download })).toBeEnabled()
    expect(screen.queryByRole('button', { name: text.share })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: text.copy }))
    expect(await screen.findByText(text.copied)).toBeInTheDocument()
  })

  it('takes a closed share sheet for a decision, not a failure', async () => {
    device.restore()
    device = useFakeDevice({
      kind: 'android',
      share: async () => Promise.reject(domError('AbortError')),
    })
    const user = tapper()
    renderTab(ready())

    await user.click(await screen.findByRole('button', { name: text.share }))

    await waitFor(() => expect(device.shared).toHaveLength(1))
    await waitFor(() => expect(screen.getByText(text.copied)).toBeInTheDocument())
    expect(screen.queryByText((c) => c === plain(text.shareFailed))).not.toBeInTheDocument()
  })

  it('points to the download when the share sheet refuses', async () => {
    device.restore()
    device = useFakeDevice({
      kind: 'iphone',
      share: async () => Promise.reject(domError('NotAllowedError')),
    })
    const user = tapper()
    renderTab(ready())

    await user.click(await screen.findByRole('button', { name: text.share }))

    expect(await screen.findByText((c) => c === plain(text.shareFailed))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.download })).toBeEnabled()
  })

  it('says when the words could not be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = tapper()
    renderTab(ready())

    await user.click(screen.getByRole('button', { name: text.copy }))

    expect(await screen.findByText((c) => c === plain(text.copyFailed))).toBeInTheDocument()
  })

  it('draws the card the host chose on the print tab: same design, colour and short word', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ design: 'billet', colour: '#2a9d8f', short: 'Venez nombreux' }),
    )
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalled())
    const node = render.mock.calls[0]?.[0] as HTMLElement
    expect(node.querySelector('[data-print-card]')).toHaveAttribute('data-print-card', 'billet')
    expect(node).toHaveTextContent('Venez nombreux')
    expect(node.style.getPropertyValue('--pd-color')).toBe('#2a9d8f')
  })

  it('draws the photograph of the card, and waits for the blurred ground before it makes the image', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ design: 'billet' }))
    window.localStorage.setItem(
      'eventslide.printPhoto.camille-et-sacha',
      'data:image/jpeg;base64,AAAA',
    )
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalled())
    const node = render.mock.calls[0]?.[0] as HTMLElement
    expect(node.querySelector('img[src^="data:image/jpeg"]')).not.toBeNull()
  })

  it('has no photograph on a card that has none, and a ground of the card’s own colour', async () => {
    const render = ready()
    renderTab(render)

    await waitFor(() => expect(render).toHaveBeenCalled())
    const node = render.mock.calls[0]?.[0] as HTMLElement
    expect(node.querySelector('img')).toBeNull()
    expect(node.style.getPropertyValue('--pd-color')).toMatch(/^oklch\(/)
  })
})
