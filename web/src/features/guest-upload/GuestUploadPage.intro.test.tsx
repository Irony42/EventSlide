import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { fr } from '../../lib/i18n/fr'
import { formatDateTime, formatTime } from '../../lib/format'
import { aPrivacyNotice, aPrivacyNoticeState, fakeApi } from '../../testing/renderWithProviders'
import { aRevealBlock } from '../../testing/revealFixtures'
import { havingJoined, readAnswered, renderUpload } from './testing/guestUploadHarness'
import type { Api } from '../../lib/api/client'
import type { MyPhotosDto } from '../../lib/api/dto'

/**
 * The sentence under the event's name (spec 23b, point 1): "they will appear on the screen straight
 * away" is false while a disposable-camera evening is held, so the mode says its own, with the hour.
 * Nothing changes for an evening without the mode, or once it has been revealed.
 */

const publishing = aPrivacyNoticeState({ notice: aPrivacyNotice({ publication: 'immediate' }) })

const answering = (answer: MyPhotosDto, notice = aPrivacyNoticeState()): Api =>
  fakeApi({ myPhotos: vi.fn(async () => answer), privacyNotice: vi.fn(async () => notice) })

const HOUR = 3_600_000

describe('the guest’s line under the event name', () => {
  beforeEach(() => {
    havingJoined()
  })

  it('promises the development at the reveal, with its hour, while the evening is held', async () => {
    const now = Date.now()
    const atMs = now + HOUR
    renderUpload(answering({ items: [], reveal: aRevealBlock({ serverNowMs: now, atMs }) }))

    const line = await screen.findByTestId('guest-intro-held')
    const sameDay = new Date(atMs).toDateString() === new Date(now).toDateString()
    expect(line).toHaveTextContent(
      sameDay
        ? fr.reveal.guestIntroAt(formatTime(atMs, 'fr') ?? '')
        : fr.reveal.guestIntroOn(formatDateTime(new Date(atMs).toISOString(), 'fr') ?? ''),
    )
    // The false promise is gone, whichever of the two usual sentences it was.
    expect(screen.queryByText(fr.upload.intro)).toBeNull()
    expect(screen.queryByText(fr.upload.introImmediate)).toBeNull()
  })

  it('says it without an hour when the host reveals with the button', async () => {
    renderUpload(answering({ items: [], reveal: aRevealBlock({ atMs: null }) }))

    expect(await screen.findByTestId('guest-intro-held')).toHaveTextContent(fr.reveal.guestIntro)
  })

  it('replaces the sentence of an event that publishes on arrival too', async () => {
    havingJoined({}, publishing)
    renderUpload(answering({ items: [], reveal: aRevealBlock({ atMs: null }) }, publishing))

    expect(await screen.findByTestId('guest-intro-held')).toBeVisible()
    expect(screen.queryByText(fr.upload.introImmediate)).toBeNull()
  })

  it('gives the usual sentence back once the evening is revealed', async () => {
    const api = answering({ items: [], reveal: aRevealBlock({ revealed: true }) })
    renderUpload(api)
    await readAnswered(api)

    expect(screen.getByText(fr.upload.intro)).toBeVisible()
    expect(screen.queryByTestId('guest-intro-held')).toBeNull()
  })

  it('keeps the usual sentence, word for word, on an evening without the mode', async () => {
    const api = answering({ items: [], reveal: aRevealBlock({ enabled: false, revealed: true }) })
    renderUpload(api)
    await readAnswered(api)

    expect(screen.getByText(fr.upload.intro)).toBeVisible()
    expect(screen.queryByTestId('guest-intro-held')).toBeNull()
  })

  it('keeps the immediate sentence on an evening without the mode that publishes on arrival', async () => {
    havingJoined({}, publishing)
    const api = answering({ items: [] }, publishing)
    renderUpload(api)
    await readAnswered(api)

    expect(screen.getByText(fr.upload.introImmediate)).toBeVisible()
    expect(screen.queryByTestId('guest-intro-held')).toBeNull()
  })
})
