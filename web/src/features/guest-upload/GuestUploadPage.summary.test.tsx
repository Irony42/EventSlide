import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aGuestPhoto,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestPhotoDto } from '../../lib/api/dto'

/**
 * The upload screen once a batch has arrived: the queue folds into one line, and "Voir mes envois"
 * takes the guest to their list. The pieces (the rule, the line) are tested beside their code;
 * this is the two ends joined, on the page that holds both.
 */

const SLUG = 'camille-et-sacha'

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

/**
 * An upload that gives each photo the id `sent-<n>` in the order they go up, and makes the next
 * `myPhotos` read return them, newest first, ahead of one photo from an earlier visit.
 */
const anEventThatKeepsWhatIsSent = (duplicates: readonly number[] = []): Api => {
  const sent: GuestPhotoDto[] = []
  return fakeApi({
    uploadPhotos: vi.fn(async () => {
      const n = sent.length + 1
      const photoId = `sent-${n}`
      sent.unshift(aGuestPhoto({ id: photoId }))
      return {
        results: [{ index: 0, status: duplicates.includes(n) ? 'duplicate' : 'accepted', photoId }],
      } as const
    }),
    myPhotos: vi.fn(async () => ({ items: [...sent, aGuestPhoto({ id: 'earlier' })] })),
  })
}

const render = (api: Api) => {
  rememberGuestSession({
    event: aPublicEvent(),
    displayName: 'Léa',
    privacyNotice: aPrivacyNoticeState(),
  })
  return renderWithProviders(<GuestUploadPage />, {
    api,
    route: `/e/${SLUG}/upload`,
    path: '/e/:slug/upload',
  })
}

const sendPhotos = async (count: number): Promise<void> => {
  const files = Array.from({ length: count }, (_unused, index) => aPhotoFile(`p${index}.jpg`))
  await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), files)
  await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
}

const viewMine = () => screen.findByRole('button', { name: fr.upload.queueViewMine })
const mineHeading = () => screen.getByRole('heading', { level: 2, name: fr.upload.mine })
const flashed = () => document.querySelectorAll('[data-highlight]')

/** Reduced motion on or off, as the browser reports it. */
const askForReducedMotion = (reduce: boolean) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

describe('GuestUploadPage: after a batch has arrived', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // jsdom has no layout and no `scrollIntoView`: a fake that records what it was asked, and for.
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  })

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    vi.restoreAllMocks()
  })

  it('scrolls to "Vos envois" smoothly, and moves focus to its heading', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(3)

    await userEvent.click(await viewMine())

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(mineHeading())
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(mineHeading()).toHaveFocus()
    // A heading a script can focus, and not one more stop for the Tab key.
    expect(mineHeading()).toHaveAttribute('tabindex', '-1')
  })

  it('jumps instead of gliding for a guest who asked for less motion', async () => {
    askForReducedMotion(true)
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)

    await userEvent.click(await viewMine())

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(mineHeading()).toHaveFocus()
  })

  it('flashes the photos of this batch in the list, and not the ones from before', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(3)
    await waitFor(() => expect(document.querySelectorAll('ul img').length).toBeGreaterThan(3))
    expect(flashed()).toHaveLength(0)

    await userEvent.click(await viewMine())

    // Three of the four photos in the list: the ones the server gave ids to during this batch.
    expect(flashed()).toHaveLength(3)
    expect(mineHeading().closest('section')?.querySelectorAll('li')).toHaveLength(4)
  })

  it('counts a duplicate among the photos to flash, for it is in the list too', async () => {
    render(anEventThatKeepsWhatIsSent([2]))
    await sendPhotos(2)

    await userEvent.click(await viewMine())

    expect(screen.getByText(fr.upload.queueDone(2, 1), { exact: false })).toBeVisible()
    expect(flashed()).toHaveLength(2)
  })

  it('stops flashing when the flash is over, and flashes again on the next press', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)
    await userEvent.click(await viewMine())
    expect(flashed()).toHaveLength(2)

    // Bubbling, as a browser's `animationend` does. jsdom has no `AnimationEvent`, so React listens
    // there for the old prefixed name: both are sent, and only the one it listens for is heard.
    const flash = document.querySelector('[data-highlight]') as Element
    fireEvent(flash, new Event('animationend', { bubbles: true }))
    fireEvent(flash, new Event('webkitAnimationEnd', { bubbles: true }))
    expect(flashed()).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: fr.upload.queueViewMine }))
    expect(flashed()).toHaveLength(2)
  })

  it('flashes nothing for a guest who asked for less motion', async () => {
    askForReducedMotion(true)
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)

    await userEvent.click(await viewMine())

    expect(flashed()).toHaveLength(0)
  })

  it('does not take focus when the rows fold, nor scroll anywhere on its own', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)
    await viewMine()

    expect(mineHeading()).not.toHaveFocus()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('brings the rows back for a new batch, and folds them again when it has arrived', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)
    await viewMine()
    expect(screen.getByTestId('upload-item-0')).not.toBeVisible()

    await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), aPhotoFile('suite.jpg'))

    // The last batch's line is gone, the new photo is a row to be sent.
    expect(screen.queryByText(fr.upload.queueDone(2, 0))).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.queueViewMine })).toBeNull()
    expect(screen.getAllByTestId(/^upload-item-/)).toHaveLength(1)
    expect(screen.getByTestId('upload-item-0')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    expect(await screen.findByText(fr.upload.queueDone(1, 0))).toBeVisible()
    expect(screen.getByTestId('upload-item-0')).not.toBeVisible()
  })

  it('dismisses the line, and the rows with it', async () => {
    render(anEventThatKeepsWhatIsSent())
    await sendPhotos(2)
    await viewMine()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.queueDismiss }))

    expect(screen.queryByTestId('upload-item-0')).toBeNull()
    expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
    // What the guest sent is still in their list.
    expect(screen.getByRole('heading', { level: 2, name: fr.upload.mine })).toBeVisible()
  })

  it('keeps a batch with a failure open, however many arrived, and folds it once the retry works', async () => {
    let call = 0
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        call += 1
        if (call === 2) return { results: [] }
        return { results: [{ index: 0, status: 'accepted', photoId: `sent-${call}` }] } as const
      }),
      myPhotos: vi.fn(async () => ({ items: [] })),
    })
    render(api)

    await sendPhotos(2)
    await waitFor(() =>
      expect(screen.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'failed'),
    )
    expect(screen.getByTestId('upload-item-0')).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.queueViewMine })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.retryItem(2) }))

    expect(await screen.findByText(fr.upload.queueDone(2, 0))).toBeVisible()
    expect(screen.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('upload-item-1')).not.toBeVisible()
  })
})
