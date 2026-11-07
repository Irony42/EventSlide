import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readGuestSession, readRememberedGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aClipJob, aGuestMission, aGuestPhoto, fakeApi } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestMissionDto } from '../../lib/api/dto'
import {
  SLUG,
  accepted,
  aPhotoFile,
  havingJoined,
  renderUpload,
  withPhotos,
  readAnswered,
  pickPhotos,
} from './testing/guestUploadHarness'

describe('sending a video', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const aClipFile = (name = 'premiere-danse.mp4', size = 12_000_000): File => {
    const file = new File([new Uint8Array([0, 0, 0, 0x18])], name, { type: 'video/mp4' })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }

  it('offers no video control when the host has not allowed it', () => {
    // The persistence fallback reads false for every gallery created before clips
    // shipped. Offering the control there means a 403 after eighty megabytes of a
    // guest's evening, which is exactly the failure this surface is arranged to avoid.
    havingJoined({ allowClips: false })
    renderUpload(fakeApi())

    expect(screen.queryByLabelText(fr.upload.addClip)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.clipSection })).toBeNull()
  })

  it('offers video as a button that unfolds the pickers, not as two pickers always on screen', async () => {
    havingJoined({ allowClips: true })
    renderUpload(fakeApi())

    expect(screen.getByRole('button', { name: fr.upload.clipSection })).toBeVisible()
    // The input is transparent over its label, so what is on screen is the label's words.
    expect(screen.getByText(fr.upload.addClip)).not.toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSection }))

    expect(screen.getByText(fr.upload.addClip)).toBeVisible()
  })

  it('lets the guest watch back the video they sent, and says how long it is', async () => {
    // "Did it arrive, and was it the right one?" is what this list is for, and a poster
    // frame answers only the first half.
    havingJoined({ allowClips: true })
    renderUpload(
      fakeApi(
        withPhotos(
          aGuestPhoto({
            id: 'clip-1',
            kind: 'clip',
            videoUrl: '/api/events/camille-et-sacha/photos/clip-1/video',
            durationMs: 8_000,
          }),
        ),
      ),
    )

    const player = await screen.findByLabelText(fr.upload.mineClipAlt)
    expect(player).toHaveAttribute('src', '/api/events/camille-et-sacha/photos/clip-1/video')
    expect(screen.getByText(fr.moderation.videoLength(8))).toBeVisible()
  })

  it('says what the limits are before the picker is opened', async () => {
    havingJoined({ allowClips: true, maxClipBytes: 80_000_000, maxClipSeconds: 15 })
    renderUpload(fakeApi())

    // Unfolding the section is what brings the numbers on screen, and the guest does that
    // before the picker, so they are read before anything is chosen.
    // The numbers come from the event, not from this bundle: a guest who reads them
    // films a shorter sequence instead of losing four minutes to a refusal.
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSection }))
    expect(screen.getByText(fr.upload.clipHint(15, 80))).toBeVisible()
  })

  it('sends the trimmed caption the guest wrote along with the video', async () => {
    // A guest who wrote one and then sent a video must not lose it.
    havingJoined({ allowClips: true, allowCaptions: true })
    const api = fakeApi({ uploadClip: vi.fn(async () => aClipJob({ status: 'done' })) })
    renderUpload(api)

    await userEvent.click(screen.getByRole('button', { name: fr.upload.captionLabel }))
    await userEvent.type(screen.getByLabelText(/Légende/), '  La première danse  ')
    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    await waitFor(() =>
      expect(api.uploadClip).toHaveBeenCalledWith(
        SLUG,
        expect.objectContaining({ caption: 'La première danse' }),
      ),
    )
  })

  it('refuses a recording heavier than the limit without contacting the server', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi()
    renderUpload(api)

    await userEvent.upload(
      screen.getByLabelText(fr.upload.addClip),
      aClipFile('longue.mp4', 90_000_000),
    )

    expect(await screen.findByText(fr.upload.clipTooLarge(80))).toBeVisible()
    expect(api.uploadClip).not.toHaveBeenCalled()
    // And no greyed-out "Réessayer" beside it: a control that exists to be refused reads,
    // in a dark room, as the app being broken rather than as the recording being wrong.
    expect(screen.queryByRole('button', { name: fr.app.retry })).toBeNull()
    // Named after what it does. It and the picker above it were both "Choisir une autre
    // vidéo", so a screen-reader user activating one watched the composer empty and no
    // picker open.
    expect(screen.getByRole('button', { name: fr.upload.clipDiscard })).toBeEnabled()
  })

  it('waits out a full queue instead of offering the same eighty megabytes again', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(() =>
        Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
      ),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // Backpressure is a wait, not an error the guest caused — and it carries the server's
    // own estimate, so they stop pressing the button.
    expect(await screen.findByText(fr.upload.clipQueueFullRetry(30))).toBeVisible()
    // No send while the box asked for a delay: the upload is written to disk before the
    // queue depth is decided, so an instant retry spends the bytes for nothing.
    expect(screen.queryByRole('button', { name: fr.upload.clipSend })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.app.retry })).toBeNull()
  })

  it('announces a refused recording as an alert, which is the only thing that interrupts', async () => {
    havingJoined({ allowClips: true })
    renderUpload(fakeApi())

    await userEvent.upload(
      screen.getByLabelText(fr.upload.addClip),
      aClipFile('longue.mp4', 90_000_000),
    )

    const refusal = await screen.findByText(fr.upload.clipTooLarge(80))
    expect(refusal.closest('[role="alert"]')).not.toBeNull()
  })

  it('announces a wait in turn, as a status, and not as an alert over what the guest is doing', async () => {
    havingJoined({ allowClips: true })
    renderUpload(
      fakeApi({
        uploadClip: vi.fn(() =>
          Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
        ),
      }),
    )

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    const wait = await screen.findByText(fr.upload.clipQueueFullRetry(30))
    expect(wait.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the transcode as its own state rather than stopping at 100%', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ status: 'queued' })),
      clipJob: vi.fn(async () => aClipJob({ status: 'running' })),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // The window between the upload and the photo is real, and a guest who cannot tell
    // whether it worked sends the same file again.
    expect(await screen.findByText(fr.upload.clipRunning)).toBeVisible()
  })

  it('stops offering to cancel once the bytes are on the box', async () => {
    // "Annuler l'envoi" is true while the request is in flight and a lie afterwards: the
    // queue deduplicates per event, so a cancellation could delete a clip a *different*
    // guest also sent, `queued` may only become `running`, and no route lets a guest
    // touch a job. So the screen says what happens next instead of promising a
    // withdrawal this surface cannot perform.
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ status: 'queued' })),
      clipJob: vi.fn(async () => aClipJob({ status: 'running' })),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    expect(await screen.findByText(fr.upload.clipAlreadySent)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.clipCancel })).toBeNull()
  })

  it('offers to cancel while the bytes are still going up, because then it is true', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({ uploadClip: vi.fn(() => new Promise<never>(() => {})) })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // The `XMLHttpRequest` is aborted and the box never sees the file.
    expect(await screen.findByRole('button', { name: fr.upload.clipCancel })).toBeVisible()
  })

  it('tells the guest a video is not kept for later when the network drops', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({ uploadClip: vi.fn(() => Promise.reject(ApiError.network())) })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // A phone holding eighty megabytes it can never drain is a phone that never sends
    // anything else either, so the outbox refuses it — and this is the sentence that
    // makes the refusal honest rather than silent.
    expect(await screen.findByText(fr.upload.clipNotQueued)).toBeVisible()
  })

  /* ---- Per-event theming (roadmap 2.2). ---- */

  it('wears the event’s colour on the very first frame', async () => {
    // The guest surface has no loading state to hide a repaint behind: the event comes
    // out of the session the join wrote, and `sessionStorage` is synchronous. So the
    // colour is on the element the first time it renders, not one round trip later
    // under the guest's thumb.
    havingJoined({
      theme: {
        accentHue: 345,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'guinguette',
      },
    })
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    expect(page).toHaveStyle({ '--accent-hue': '345' })
    // And the marker `tokens.css` re-derives the accent on: without it the hue moves and
    // the palette does not, because a custom property that references another is resolved
    // on the element it is declared on.
    expect(page).toHaveAttribute('data-event-accent', '345')
  })

  it('takes the colour and leaves the typography on the projector', async () => {
    // A display face is a projector decision: this screen's largest type is `--text-lg`,
    // and had the pairings been bundled rather than built from system faces, this is the
    // surface that would have paid for them.
    havingJoined({
      theme: {
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        ambiance: 'guinguette',
      },
    })
    renderUpload(fakeApi())

    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(document.querySelector('[data-event-fonts]')).toBeNull()
    expect(document.querySelector('[data-event-frame]')).toBeNull()
  })

  it('renders an unthemed event exactly as it did before theming existed', async () => {
    havingJoined()
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    // Scoped to the page rather than to the document: a `Progress` bar legitimately sets
    // `--progress-value` inline, and a document-wide assertion would fail on that and
    // read as a theming regression.
    expect(page?.getAttribute('style')).toBeNull()
    expect(page).not.toHaveAttribute('data-event-accent')
    expect(page).not.toHaveAttribute('data-event-fonts')
    expect(page).not.toHaveAttribute('data-event-frame')
  })

  /* ---- A host who changes the look after a guest has joined. ---- */

  describe('a theme the host changed after the guest joined', () => {
    const VIOLET = {
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      ambiance: 'guinguette',
    } as const
    const ROSE = {
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      ambiance: 'guinguette',
    } as const

    const answeringWith = (theme: unknown): Partial<Api> => ({
      // Cast through unknown because a malformed or absent theme is the case under test.
      myPhotos: vi.fn(async () => ({ items: [], theme }) as unknown as { items: never[] }),
    })

    const pageOf = async () =>
      (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    it('paints the new colour once the page’s own read has answered, and the stored one until then', async () => {
      // The join wrote violet; the host has since chosen rose. The screen cannot refetch the
      // event, so what it can learn is on the read it makes anyway: the guest's own photos.
      havingJoined({ theme: VIOLET })
      let answer: (value: { items: never[]; theme: typeof ROSE }) => void = () => {}
      renderUpload(
        fakeApi({
          myPhotos: vi.fn(
            () =>
              new Promise<{ items: never[]; theme: typeof ROSE }>((resolve) => {
                answer = resolve
              }),
          ),
        }),
      )

      // First frame: the join's copy, with no request waited on.
      const page = await pageOf()
      expect(page).not.toHaveAttribute('data-event-accent')

      await act(async () => answer({ items: [], theme: ROSE }))

      expect(page).toHaveAttribute('data-event-accent', '345')
      expect(page).toHaveStyle({ '--accent-hue': '345' })
    })

    it('writes the new theme back, so the tab and the device hold the same one', async () => {
      havingJoined({ theme: VIOLET })
      renderUpload(fakeApi(answeringWith(ROSE)))

      await waitFor(() => expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE))
      expect(readRememberedGuestSession()?.event.theme).toEqual(ROSE)
      // Everything else the join wrote is still there.
      expect(readGuestSession(SLUG)?.displayName).toBe('Léa')
    })

    it('paints the new colour on the very first frame of the next visit', async () => {
      havingJoined({ theme: VIOLET })
      const first = renderUpload(fakeApi(answeringWith(ROSE)))
      await waitFor(() => expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE))
      first.unmount()

      // A second visit whose read never answers: all it has is what was written back.
      renderUpload(fakeApi({ myPhotos: vi.fn(() => new Promise<never>(() => {})) }))

      expect(await pageOf()).toHaveAttribute('data-event-accent', '345')
    })

    it('keeps the stored theme when the read fails, and does not rewrite the session', async () => {
      havingJoined({ theme: ROSE })
      renderUpload(
        fakeApi({
          myPhotos: vi.fn(async () => {
            throw ApiError.network()
          }),
        }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.upload.mineFailed)
      expect(await pageOf()).toHaveAttribute('data-event-accent', '345')
      expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE)
    })

    it('keeps the stored theme when a server that predates the field answers without one', async () => {
      havingJoined({ theme: ROSE })
      const api = fakeApi(withPhotos())
      renderUpload(api)

      await readAnswered(api)
      expect(await pageOf()).toHaveAttribute('data-event-accent', '345')
      expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE)
    })

    it.each([
      { name: 'a hue that is not a number', theme: { ...ROSE, accentHue: 'rose' } },
      { name: 'a hue past the circle', theme: { ...ROSE, accentHue: 4000 } },
      { name: 'a font pairing this build has never heard of', theme: { ...ROSE, fonts: 'comic' } },
      { name: 'something that is not a theme at all', theme: 'rose' },
    ])('ignores $name, untrusted input that must not reach the stylesheet', async ({ theme }) => {
      havingJoined({ theme: VIOLET })
      const api = fakeApi(answeringWith(theme))
      renderUpload(api)

      await readAnswered(api)
      const page = await pageOf()
      expect(page).not.toHaveAttribute('data-event-accent')
      expect(page?.getAttribute('style')).toBeNull()
      expect(readGuestSession(SLUG)?.event.theme).toEqual(VIOLET)
      expect(readRememberedGuestSession()?.event.theme).toEqual(VIOLET)
    })

    it('keeps the colour it learned when a later read answers without one', async () => {
      // The screen's own copy of the session is read once, at mount, and is the old theme. A
      // later answer carrying no usable theme (a server rolled back) must not drop the page back
      // to it: what the guest has been looking at is what stands.
      havingJoined({ theme: VIOLET })
      let reads = 0
      const api = fakeApi({
        myPhotos: vi.fn(async () => {
          reads += 1
          const items = [aGuestPhoto({ id: 'photo-1', canDelete: true })]
          return reads === 1 ? { items, theme: ROSE } : { items: [] }
        }),
      })
      renderUpload(api)
      await userEvent.click(
        await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) }),
      )
      const dialog = await screen.findByRole('dialog', { name: fr.upload.deleteOwnConfirm })
      await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.deleteOwn }))

      await waitFor(() => expect(reads).toBe(2))
      await readAnswered(api)
      expect(await pageOf()).toHaveAttribute('data-event-accent', '345')
    })

    it('takes the colour back to the product’s own when the host chose that again', async () => {
      havingJoined({ theme: ROSE })
      renderUpload(fakeApi(answeringWith(VIOLET)))

      await waitFor(() => expect(readGuestSession(SLUG)?.event.theme).toEqual(VIOLET))
      expect(await pageOf()).not.toHaveAttribute('data-event-accent')
    })
  })

  describe('the mission checklist', () => {
    const withMissions = (...missions: readonly GuestMissionDto[]): Partial<Api> => ({
      myMissions: vi.fn(async () => ({ items: missions })),
    })

    it('shows nothing at all for an event whose host set no prompts', async () => {
      // Which is most events, and is what keeps this screen the screen it was.
      havingJoined()
      renderUpload(fakeApi())

      await screen.findByTestId('upload-composer')

      expect(
        screen.queryByRole('heading', { name: fr.upload.missionsTitle }),
      ).not.toBeInTheDocument()
    })

    it('offers the prompts the host set', async () => {
      havingJoined()
      renderUpload(
        fakeApi(withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie avec les mariés' }))),
      )

      expect(
        await screen.findByRole('button', {
          name: /un selfie avec les mariés/,
        }),
      ).toBeVisible()
    })

    const challengeReading = (missionId: string | null) => ({
      items: [],
      serverNowMs: Date.now(),
      challenge: {
        id: 'c1',
        missionId,
        prompt: 'un selfie avec votre voisin',
        endsAt: new Date(Date.now() + 102_000).toISOString(),
        state: 'running' as const,
      },
    })

    const joinedWithChallenge = (overrides: Partial<Api> = {}): Api => {
      const api = fakeApi({
        myMissions: vi.fn(async () => challengeReading(null)),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
        ...overrides,
      })
      havingJoined()
      renderUpload(api)
      return api
    }

    it('shows the host challenge even when the host set no mission at all (spec 18)', async () => {
      joinedWithChallenge()

      expect(await screen.findByText('un selfie avec votre voisin')).toBeVisible()
    })

    it('shows the box checked once a photo is chosen, and sends the challenge with it', async () => {
      const api = joinedWithChallenge()
      await screen.findByText('un selfie avec votre voisin')
      expect(screen.queryByRole('checkbox', { name: fr.challenge.participate })).toBeNull()

      await pickPhotos(aPhotoFile('confettis.jpg'))
      expect(screen.getByRole('checkbox', { name: fr.challenge.participate })).toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ challengeId: 'c1' }),
        ),
      )
    })

    it('sends a plain photograph when the guest unchecks the box', async () => {
      const api = joinedWithChallenge()
      await screen.findByText('un selfie avec votre voisin')

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('checkbox', { name: fr.challenge.participate }))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ challengeId: null }),
        ),
      )
    })

    it('shows no box and sends no challenge when none runs', async () => {
      const api = fakeApi({ uploadPhotos: vi.fn(async () => accepted('photo-1')) })
      havingJoined()
      renderUpload(api)
      await screen.findByTestId('upload-composer')

      await pickPhotos(aPhotoFile('confettis.jpg'))

      expect(screen.queryByRole('checkbox', { name: fr.challenge.participate })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))
      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ challengeId: null }),
        ),
      )
    })

    it('sends the challenge and no mission when the guest chose none, the server files the rest', async () => {
      const api = joinedWithChallenge({
        myMissions: vi.fn(async () => ({
          ...challengeReading('m1'),
          items: [aGuestMission({ id: 'm1', prompt: 'un selfie' })],
        })),
      })
      await screen.findByText('un selfie avec votre voisin')

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ challengeId: 'c1', missionId: null }),
        ),
      )
    })

    it('shows no challenge band when none runs', async () => {
      havingJoined()
      renderUpload(fakeApi(withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' }))))

      await screen.findByRole('button', { name: /un selfie/ })

      expect(screen.queryByText(fr.challenge.ended)).not.toBeInTheDocument()
    })

    it('files the photographs under the prompt the guest tapped', async () => {
      const api = fakeApi({
        ...withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' })),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })

      await userEvent.click(screen.getByRole('button', { name: /un selfie/ }))
      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ missionId: 'm1' }),
        ),
      )
    })

    it('sends no mission when the guest tapped none', async () => {
      const api = fakeApi({
        ...withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' })),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ missionId: null }),
        ),
      )
    })

    it('confirms which prompt the next send counts for', async () => {
      havingJoined()
      renderUpload(fakeApi(withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' }))))
      await screen.findByRole('button', { name: /un selfie/ })

      await userEvent.click(screen.getByRole('button', { name: /un selfie/ }))

      expect(await screen.findByText(fr.upload.missionFor('un selfie'))).toBeVisible()
    })

    it('re-reads the checklist once a batch has settled, rather than ticking it itself', async () => {
      // An upload lands `pending` on a moderated event. A client that ticked the row on
      // send would tell a guest their mission was answered before anybody approved it —
      // the one thing this feature must not do.
      const myMissions = vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1', prompt: 'un selfie' })],
      }))
      const api = fakeApi({ myMissions, uploadPhotos: vi.fn(async () => accepted('photo-1')) })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })
      expect(myMissions).toHaveBeenCalledTimes(1)

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() => expect(myMissions).toHaveBeenCalledTimes(2))
    })

    it('still lets a guest send when the checklist could not be read', async () => {
      // The checklist is an invitation, not a gate.
      const api = fakeApi({
        myMissions: vi.fn(async () => Promise.reject(new Error('offline'))),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByTestId('upload-composer')

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() => expect(api.uploadPhotos).toHaveBeenCalled())
    })
  })
})
