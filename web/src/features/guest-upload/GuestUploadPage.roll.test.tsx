import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aGuestPhoto, fakeApi } from '../../testing/renderWithProviders'
import { aRevealBlock } from '../../testing/revealFixtures'
import { aPhotoFile, havingJoined, readAnswered, renderUpload } from './testing/guestUploadHarness'
import type { Api } from '../../lib/api/client'
import type { UploadInput } from '../../lib/api/client/guest'
import type { MyPhotosDto } from '../../lib/api/dto'

/**
 * The roll of a disposable-camera evening on the guest's phone (spec 23), through the whole upload
 * screen: the poses counted in words, a pick cut to the poses left, the photographs the phone owes
 * counted with the server's, an empty roll that offers nothing to pick.
 *
 * The count is the phone's courtesy, and the server's refusal stays the rule (`photoLimitReached`);
 * what is pinned here is what the guest reads and can press.
 */

const answering = (answer: MyPhotosDto): Api => fakeApi({ myPhotos: vi.fn(async () => answer) })

const picker = (): HTMLElement => screen.getByTestId('photo-input')

const pick = async (...files: readonly File[]): Promise<void> => {
  await userEvent.upload(picker(), [...files])
}

const files = (count: number): readonly File[] =>
  Array.from({ length: count }, (_, i) => aPhotoFile(`pose-${i}.jpg`))

describe('the upload screen on a disposable-camera evening', () => {
  beforeEach(() => {
    havingJoined()
  })

  describe('the counter of poses', () => {
    it('says how many poses are left, in words', async () => {
      renderUpload(answering({ items: [], shots: { max: 27, taken: 15 }, reveal: aRevealBlock() }))

      expect(await screen.findByTestId('guest-poses')).toHaveTextContent(fr.reveal.poses(12))
    })

    it('says one pose left in the singular', async () => {
      renderUpload(answering({ items: [], shots: { max: 27, taken: 26 } }))

      expect(await screen.findByTestId('guest-poses')).toHaveTextContent(fr.reveal.poses(1))
    })

    it('says the roll is fresh before the first pose', async () => {
      renderUpload(answering({ items: [], shots: { max: 27, taken: 0 } }))

      expect(await screen.findByTestId('guest-poses')).toHaveTextContent(fr.reveal.freshRoll(27))
    })

    it('shows no counter at all with no cap, as before the mode existed', async () => {
      const api = answering({ items: [], shots: null })
      renderUpload(api)
      await readAnswered(api)

      expect(screen.queryByTestId('guest-poses')).toBeNull()
      expect(screen.queryByTestId('guest-roll')).toBeNull()
    })

    it('counts the photographs chosen and not yet sent, so a second pick cannot go past the roll', async () => {
      renderUpload(answering({ items: [], shots: { max: 5, taken: 1 } }))
      expect(await screen.findByTestId('guest-poses')).toHaveTextContent(fr.reveal.poses(4))

      await pick(...files(3))

      expect(screen.getByTestId('guest-poses')).toHaveTextContent(fr.reveal.poses(1))
    })
  })

  describe('the picker cut to the poses left', () => {
    it('keeps the first photographs, in the picker order, and says so, when the picker hands over too many', async () => {
      const api = fakeApi({
        myPhotos: vi.fn(async () => ({ items: [], shots: { max: 5, taken: 2 } })),
        uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => ({
          results: input.files.map((_file, index) => ({
            index,
            status: 'accepted' as const,
            photoId: `photo-${index}`,
          })),
        })),
      })
      renderUpload(api)
      await screen.findByTestId('guest-poses')

      await pick(...files(5))

      expect(screen.getAllByTestId(/^upload-item-/)).toHaveLength(3)
      expect(screen.getByText(fr.reveal.rollKept(3))).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(3) }))
      await waitFor(() => expect(api.uploadPhotos).toHaveBeenCalledTimes(3))
      const sent = vi
        .mocked(api.uploadPhotos)
        .mock.calls.flatMap(([, input]) => input.files.map((f) => f.name))
      expect(sent).toEqual(['pose-0.jpg', 'pose-1.jpg', 'pose-2.jpg'])
    })

    it('says nothing when everything fits, exactly at the limit too', async () => {
      renderUpload(answering({ items: [], shots: { max: 5, taken: 2 } }))
      await screen.findByTestId('guest-poses')

      await pick(...files(3))

      expect(screen.getAllByTestId(/^upload-item-/)).toHaveLength(3)
      expect(screen.queryByText(fr.reveal.rollKept(3))).toBeNull()
    })

    it('takes every photograph when there is no cap', async () => {
      const api = answering({ items: [], shots: null })
      renderUpload(api)
      await readAnswered(api)

      await pick(...files(40))

      expect(screen.getAllByTestId(/^upload-item-/)).toHaveLength(40)
    })
  })

  describe('a roll that is used up', () => {
    const emptyRoll = (): Api =>
      answering({
        items: [aGuestPhoto({ id: 'mine-1', status: 'published', awaitsReveal: true })],
        shots: { max: 1, taken: 1 },
        reveal: aRevealBlock(),
      })

    it('replaces the picker with the empty-camera sentence', async () => {
      renderUpload(emptyRoll())

      expect(await screen.findByText(fr.reveal.rollEmpty)).toBeVisible()
      expect(screen.queryByTestId('photo-input')).toBeNull()
      expect(screen.queryByLabelText(fr.upload.takePhoto)).toBeNull()
    })

    it('says the roll is empty once, in the sentence and not as a counter of zero', async () => {
      renderUpload(emptyRoll())
      await screen.findByText(fr.reveal.rollEmpty)

      expect(screen.queryByTestId('guest-poses')).toBeNull()
    })

    it('offers no video either: a clip is a pose too, and the roll has none left', async () => {
      havingJoined({ allowClips: true })
      renderUpload(emptyRoll())
      await screen.findByText(fr.reveal.rollEmpty)

      expect(screen.queryByRole('button', { name: fr.upload.clipSection })).toBeNull()
    })

    it('keeps the photographs already sent listed', async () => {
      renderUpload(emptyRoll())
      await screen.findByText(fr.reveal.rollEmpty)

      expect(screen.getByRole('heading', { name: fr.upload.mine })).toBeVisible()
      expect(screen.getAllByRole('img')).not.toHaveLength(0)
    })

    it('does not say the roll is empty while poses are left', async () => {
      renderUpload(answering({ items: [], shots: { max: 3, taken: 1 } }))
      await screen.findByTestId('guest-poses')

      expect(screen.queryByText(fr.reveal.rollEmpty)).toBeNull()
      expect(screen.getByTestId('photo-input')).toBeInTheDocument()
    })

    it('gives the picker back when a chosen photograph is taken out of the queue', async () => {
      renderUpload(answering({ items: [], shots: { max: 1, taken: 0 } }))
      await screen.findByTestId('guest-poses')
      await pick(...files(1))
      expect(await screen.findByText(fr.reveal.rollEmpty)).toBeVisible()

      await userEvent.click(screen.getByRole('button', { name: fr.upload.removeItem(1) }))

      expect(await screen.findByTestId('photo-input')).toBeInTheDocument()
      expect(screen.queryByText(fr.reveal.rollEmpty)).toBeNull()
    })
  })

  describe('the photographs the phone holds for the network', () => {
    it('count in the local counter, so thirty are not queued to see three refused at reconnection', async () => {
      const api = fakeApi({
        myPhotos: vi.fn(async () => ({ items: [], shots: { max: 2, taken: 0 } })),
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      })
      renderUpload(api)
      await screen.findByTestId('guest-poses')
      await pick(...files(2))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(2) }))

      // Both photographs are kept on the phone: the server has counted none of them, and the
      // roll is used up all the same.
      expect(await screen.findByText(fr.reveal.rollEmpty)).toBeVisible()
      expect(screen.queryByTestId('photo-input')).toBeNull()
    })
  })

  describe('the camera', () => {
    it('opens the camera directly on a disposable-camera evening, as a best effort', async () => {
      renderUpload(answering({ items: [], shots: { max: 27, taken: 0 }, reveal: aRevealBlock() }))
      await screen.findByTestId('guest-poses')

      expect(picker()).toHaveAttribute('capture', 'environment')
      // One button, not two that do the same thing.
      expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
      expect(screen.getByLabelText(fr.upload.takePhoto)).toBe(picker())
    })

    it('sets no capture attribute without the mode: the library stays the library', async () => {
      const api = answering({
        items: [],
        shots: { max: 27, taken: 0 },
        reveal: aRevealBlock({ enabled: false, revealed: true }),
      })
      renderUpload(api)
      await readAnswered(api)

      expect(screen.getByLabelText(fr.upload.addPhotos)).not.toHaveAttribute('capture')
    })
  })

  describe('the hour', () => {
    it('says when, and how long is left, on the server clock', async () => {
      const now = Date.now()
      renderUpload(
        answering({
          items: [],
          reveal: aRevealBlock({ serverNowMs: now, atMs: now + (3 * 60 + 10) * 60_000 }),
        }),
      )

      const line = await screen.findByTestId('guest-reveal')
      expect(line).toHaveTextContent(fr.reveal.guestLeft(3, 10))
      expect(line).toHaveTextContent('·')
      // A countdown read out every minute is noise: no live region.
      expect(line.closest('[aria-live]')).toBeNull()
      expect(line).not.toHaveAttribute('role', 'status')
    })

    it('says the organisers will reveal, for an evening with no hour', async () => {
      renderUpload(answering({ items: [], reveal: aRevealBlock({ atMs: null }) }))

      expect(await screen.findByTestId('guest-reveal')).toHaveTextContent(fr.reveal.guestManual)
    })

    it('says nothing once the evening is revealed', async () => {
      const api = answering({ items: [], reveal: aRevealBlock({ revealed: true }) })
      renderUpload(api)
      await readAnswered(api)

      expect(screen.queryByTestId('guest-reveal')).toBeNull()
    })
  })

  describe('the list of what was sent', () => {
    it('shows a photograph of a held evening with the developed-at-the-reveal label, not "on screen"', async () => {
      renderUpload(
        answering({
          items: [aGuestPhoto({ id: 'mine-1', status: 'published', awaitsReveal: true })],
          reveal: aRevealBlock(),
        }),
      )

      const list = await screen.findByRole('list')
      expect(within(list).getByText(fr.reveal.undeveloped)).toBeVisible()
      await waitFor(() => expect(within(list).queryByText(fr.upload.statusPublished)).toBeNull())
    })
  })
})
