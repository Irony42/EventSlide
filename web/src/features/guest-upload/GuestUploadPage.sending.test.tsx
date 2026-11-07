import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { MemoryOutbox } from '../../lib/offline/memoryOutbox'
import { fr } from '../../lib/i18n/fr'
import { aGuestMission, fakeApi } from '../../testing/renderWithProviders'
import type { UploadResponse } from '../../lib/api/dto'
import {
  accepted,
  aPhotoFile,
  havingJoined,
  renderUpload,
  withPhotos,
  readAnswered,
  pickPhotos,
} from './testing/guestUploadHarness'

describe('leaving for the feed while photos are on their way (INV-1)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    havingJoined()
  })

  const holdUploads = () => {
    let finish: (response: UploadResponse) => void = () => {}
    const api = fakeApi({
      uploadPhotos: vi.fn(
        () =>
          new Promise<UploadResponse>((resolve) => {
            finish = resolve
          }),
      ),
    })
    return { api, finish: (response: UploadResponse) => finish(response) }
  }

  it('says how far the batch is in a status line while it is sent, and goes quiet after', async () => {
    const { api, finish } = holdUploads()
    renderUpload(api)
    await pickPhotos(aPhotoFile('un.jpg'), aPhotoFile('deux.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    // Announced: the status region exists before the text does, and the count moves with each arrival.
    const status = await screen.findByText(fr.upload.leaveWaitCount(0, 2))
    expect(status).toHaveAttribute('role', 'status')

    await act(async () => finish(accepted('photo-1')))
    await waitFor(() => expect(screen.getByText(fr.upload.leaveWaitCount(1, 2))).toBeVisible())
    await act(async () => finish(accepted('photo-2')))

    await waitFor(() => expect(screen.queryByText(fr.upload.leaveWaitCount(2, 2))).toBeNull())
    expect(screen.getByRole('link', { name: fr.feed.link })).not.toHaveAttribute('aria-disabled')
  })

  it('keeps the link focusable and inert while a batch is sent, so focus is not lost', async () => {
    const { api, finish } = holdUploads()
    renderUpload(api)
    const link = screen.getByRole('link', { name: fr.feed.link })
    await pickPhotos(aPhotoFile('un.jpg'))
    link.focus()
    // Not a user-event click, which would move focus to the button: the send starts with focus on the link.
    fireEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
    await screen.findByText(fr.upload.leaveWaitCount(0, 1))

    // The same element, still a link, still where focus is, and saying it cannot be followed yet.
    const waiting = screen.getByRole('link', { name: fr.feed.link })
    expect(waiting).toBe(link)
    expect(waiting).toHaveFocus()
    expect(waiting).toHaveAttribute('aria-disabled', 'true')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    waiting.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)

    await act(async () => finish(accepted('photo-1')))
    await waitFor(() => expect(waiting).not.toHaveAttribute('aria-disabled'))
    expect(waiting).toHaveFocus()
  })

  it('never holds the link nor says it is waiting when the page opens with nothing to send', async () => {
    // Opening the screen drains the outbox, and used to say so before it had looked: for a moment
    // on every visit the status line read "Patientez…" and the link and the way out were inert.
    // The store's reads after the opening count are held and let go one at a time, so the screen
    // is looked at in the middle of the drain and not after it.
    const original = MemoryOutbox.prototype.list
    const waiting: (() => void)[] = []
    let reads = 0
    vi.spyOn(MemoryOutbox.prototype, 'list').mockImplementation(async function (
      this: MemoryOutbox,
      slug,
    ) {
      reads += 1
      if (reads > 1) await new Promise<void>((resolve) => waiting.push(resolve))
      return original.call(this, slug)
    })
    const api = fakeApi(withPhotos())
    renderUpload(api)
    await readAnswered(api)

    for (let step = 0; step < 4; step += 1) {
      await act(async () => {})
      expect(screen.queryByText(fr.upload.leaveWait)).toBeNull()
      expect(screen.getByRole('link', { name: fr.feed.link })).not.toHaveAttribute('aria-disabled')
      waiting.shift()?.()
    }
    expect(reads).toBeGreaterThan(1)
  })

  it('is a link when nothing is being sent', () => {
    renderUpload(fakeApi())

    expect(screen.getByRole('link', { name: fr.feed.link })).toBeVisible()
    expect(screen.queryByText(fr.upload.leaveWait)).toBeNull()
  })
})

describe('the caption once a batch has been sent (INV-5)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const writeCaption = async (text: string): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: fr.upload.captionLabel }))
    await userEvent.type(screen.getByLabelText(/Légende/), text)
  }

  it('empties the caption after a batch that arrived, so it does not stick to the next photos', async () => {
    havingJoined()
    const api = fakeApi({ ...withPhotos(), uploadPhotos: vi.fn(async () => accepted('photo-1')) })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await writeCaption('Joyeux anniversaire Mamie')

    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )

    await waitFor(() => expect(screen.getByLabelText(/Légende/)).toHaveValue(''))

    // And the next photos go with no caption at all.
    await pickPhotos(aPhotoFile('suivante.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
    await waitFor(() => expect(api.uploadPhotos).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.uploadPhotos).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ caption: null }),
    )
  })

  it('keeps what the guest typed for the next photos while the batch was on its way', async () => {
    havingJoined()
    let finish: (response: UploadResponse) => void = () => {}
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(
        () =>
          new Promise<UploadResponse>((resolve) => {
            finish = resolve
          }),
      ),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await writeCaption('Joyeux anniversaire Mamie')
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
    await waitFor(() => expect(api.uploadPhotos).toHaveBeenCalledTimes(1))

    // The field stays editable during the send: this is already the caption of the next photos.
    await userEvent.clear(screen.getByLabelText(/Légende/))
    await userEvent.type(screen.getByLabelText(/Légende/), 'Le gâteau')
    await act(async () => finish(accepted('photo-1')))
    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )

    expect(screen.getByLabelText(/Légende/)).toHaveValue('Le gâteau')
  })

  it('keeps the caption when a photo failed, since the retry sends it again', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => {
        throw new ApiError(400, 'request.invalid')
      }),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await writeCaption('Joyeux anniversaire Mamie')

    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'failed'),
    )

    expect(screen.getByLabelText(/Légende/)).toHaveValue('Joyeux anniversaire Mamie')
  })

  it('keeps the chosen mission, which several photos may answer', async () => {
    havingJoined()
    const api = fakeApi({
      myMissions: vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1', prompt: 'un selfie' })],
      })),
      uploadPhotos: vi.fn(async () => accepted('photo-1')),
    })
    renderUpload(api)
    await userEvent.click(await screen.findByRole('button', { name: /un selfie/ }))
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))
    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )

    expect(screen.getByText(fr.upload.missionFor('un selfie'))).toBeVisible()
  })
})

describe('"you can close this page" (INV-8)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    havingJoined()
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  const offlineSend = async (): Promise<void> => {
    renderUpload(
      fakeApi({
        ...withPhotos(),
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))
    await screen.findByText(fr.upload.offlineTitle(1))
  }

  it('is said on a browser with Background Sync', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({ sync: { register: async () => undefined } }),
        ready: Promise.resolve({ sync: { register: async () => undefined } }),
      },
    })
    await offlineSend()

    expect(await screen.findByText(fr.upload.offlineHint)).toBeVisible()
    expect(screen.queryByText(fr.upload.offlineHintNoSync)).toBeNull()
  })

  it('is not said on a browser without it, which asks the guest to keep the page open', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({}),
        ready: Promise.resolve({}),
      },
    })
    await offlineSend()

    expect(screen.getByText(fr.upload.offlineHintNoSync)).toBeVisible()
    expect(screen.queryByText(fr.upload.offlineHint)).toBeNull()
  })
})
