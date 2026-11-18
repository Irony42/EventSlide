import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { en } from '../../../lib/i18n/en'
import { fr } from '../../../lib/i18n/fr'
import { photoAlt } from '../../../lib/photoAlt'
import { deferred } from '../../../testing/deferred'
import { domError, useFakeDevice, type FakeDevice } from '../../../testing/fakeDevice'
import { aWallItem, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { SaveButton } from './SaveButton'
import type { Api } from '../../../lib/api/client'
import type { SaveRefusal } from '../hooks/usePhotoSave'
// The token file, so the cascade behind `--touch-min` resolves as in the app.
import '../../../design-system/tokens.css'

const SLUG = 'camille-et-sacha'
const ITEM = aWallItem({ id: 'photo-1', caption: 'Les confettis', authorName: 'Léa' })
const FILE_NAME = 'camille-et-sacha-0123456789ab.jpg'

interface Rendered {
  readonly api: Api
  readonly refused: SaveRefusal[]
  readonly claimHelp: ReturnType<typeof vi.fn<() => boolean>>
  readonly container: HTMLElement
}

const renderButton = (
  overrides: Partial<Api> = {},
  options: { readonly claim?: boolean; readonly locale?: 'fr' | 'en' } = {},
): Rendered & { readonly unmount: () => void } => {
  const api = fakeApi(overrides)
  const refused: SaveRefusal[] = []
  const claimHelp = vi.fn(() => options.claim ?? true)
  const view = renderWithProviders(
    <SaveButton
      slug={SLUG}
      item={ITEM}
      onRefused={(reason) => refused.push(reason)}
      claimHelp={claimHelp}
    />,
    { api, ...(options.locale === undefined ? {} : { locale: options.locale }) },
  )
  return { api, refused, claimHelp, container: view.container, unmount: view.unmount }
}

/** The button, found by the word it says whatever the photograph it is under. */
const button = (name: string | RegExp = fr.app.save): HTMLElement =>
  screen.getByRole('button', {
    name: new RegExp(`^${typeof name === 'string' ? name : name.source}`),
  })

const refusing = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): Partial<Api> => ({
  savePhoto: vi.fn(async () => {
    throw new ApiError(status, code, details)
  }),
})

let device: FakeDevice

afterEach(() => {
  device.restore()
})

describe('SaveButton on an iPhone, which can share a file', () => {
  beforeEach(() => {
    device = useFakeDevice({ kind: 'iphone' })
  })

  it('is named with the photograph it is under, so twelve of them are not one stop', () => {
    renderButton()

    expect(
      screen.getByRole('button', { name: fr.feed.saveNamed(fr.app.save, photoAlt(ITEM, fr)) }),
    ).toBeVisible()
  })

  it('opens the share sheet with the photograph, named as the server named it', async () => {
    const { api } = renderButton()

    await userEvent.click(button())

    await waitFor(() => expect(device.share).toHaveBeenCalledTimes(1))
    expect(api.savePhoto).toHaveBeenCalledWith(SLUG, 'photo-1', expect.any(AbortSignal))
    const files = device.shared[0]?.files ?? []
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe(FILE_NAME)
    expect(files[0]?.type).toBe('image/jpeg')
    // A sheet, not a download.
    expect(device.downloads).toEqual([])
  })

  it('never says the photograph was saved once the sheet has closed', async () => {
    const { unmount } = renderButton()

    await userEvent.click(button())
    await waitFor(() => expect(device.share).toHaveBeenCalled())

    // The browser does not say what the guest chose: the word comes back, and nothing is announced.
    await waitFor(() => expect(button().textContent).toBe(fr.app.save))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/enregistrée\b/)
    unmount()
  })

  it('shows nothing when the guest closes the sheet: a decision is not a fault', async () => {
    device.restore()
    device = useFakeDevice({
      kind: 'iphone',
      share: async () => {
        throw domError('AbortError')
      },
    })
    renderButton()

    await userEvent.click(button())

    await waitFor(() => expect(device.share).toHaveBeenCalled())
    await waitFor(() => expect(button().textContent).toBe(fr.app.save))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(fr.feed.saveNetworkFailed)).toBeNull()
    expect(button()).toBeEnabled()
  })

  it('keeps the photograph when the system refuses a stale gesture, and opens the sheet on the next tap without asking again', async () => {
    let attempts = 0
    device.restore()
    device = useFakeDevice({
      kind: 'iphone',
      share: async () => {
        attempts += 1
        if (attempts === 1) throw domError('NotAllowedError')
      },
    })
    const { api } = renderButton()

    await userEvent.click(button())

    // The second tap's state: "Appuyez pour l'enregistrer".
    const ready = await screen.findByRole('button', { name: new RegExp(`^${fr.feed.saveReady}`) })
    expect(ready).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(ready)

    await waitFor(() => expect(device.share).toHaveBeenCalledTimes(2))
    expect(api.savePhoto).toHaveBeenCalledTimes(1)
    expect(device.shared[1]?.files?.[0]?.name).toBe(FILE_NAME)
    await waitFor(() => expect(button().textContent).toBe(fr.app.save))
  })

  it('falls back to a download when the sheet cannot take the file after all', async () => {
    device.restore()
    device = useFakeDevice({
      kind: 'iphone',
      share: async () => {
        throw new TypeError('not a shareable file')
      },
    })
    renderButton()

    await userEvent.click(button())

    expect(await screen.findByText(fr.feed.saveDownloaded)).toBeVisible()
    expect(device.downloads.map((entry) => entry.name)).toEqual([FILE_NAME])
  })

  it('says what to choose in the sheet, once, before it opens', async () => {
    const { claimHelp } = renderButton({}, { claim: true })

    await userEvent.click(button())

    expect(await screen.findByText(fr.feed.saveHelpSheet)).toBeVisible()
    expect(claimHelp).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(fr.feed.saveHelpFiles)).toBeNull()
  })

  it('says nothing when this device has been told already', async () => {
    renderButton({}, { claim: false })

    await userEvent.click(button())

    await waitFor(() => expect(device.share).toHaveBeenCalled())
    expect(screen.queryByText(fr.feed.saveHelpSheet)).toBeNull()
  })

  it('is working, and says so, while the photograph is on its way', async () => {
    const pending = deferred<{ blob: Blob; fileName: string | null }>()
    renderButton({ savePhoto: vi.fn(() => pending.promise) })

    await userEvent.click(button())

    const working = await screen.findByRole('button', { name: new RegExp(`^${fr.feed.saving}`) })
    expect(working).toHaveAttribute('aria-busy', 'true')
    expect(working).toBeDisabled()

    await act(async () => {
      pending.resolve({ blob: new Blob(['x'], { type: 'image/jpeg' }), fileName: FILE_NAME })
    })
    await waitFor(() => expect(button().textContent).toBe(fr.app.save))
  })
})

describe('SaveButton on a phone that cannot share a file (a messaging app’s own browser)', () => {
  beforeEach(() => {
    device = useFakeDevice({ kind: 'iphone', canShareFiles: false })
  })

  it('downloads the file, and says where it went and how to do better', async () => {
    renderButton({}, { claim: true })

    await userEvent.click(button())

    expect(await screen.findByText(fr.feed.saveDownloaded)).toBeVisible()
    expect(screen.getByText(fr.feed.saveHelpFiles)).toBeVisible()
    expect(device.share).not.toHaveBeenCalled()
    expect(device.downloads.map((entry) => entry.name)).toEqual([FILE_NAME])
  })
})

describe.each([
  ['an Android phone', 'android'],
  ['a computer', 'desktop'],
] as const)('SaveButton on %s', (_label, kind) => {
  beforeEach(() => {
    device = useFakeDevice({ kind })
  })

  it('downloads the file by an anchor, and says "Photo téléchargée" because the browser did write it', async () => {
    renderButton()

    await userEvent.click(button())

    expect(await screen.findByText(fr.feed.saveDownloaded)).toBeVisible()
    expect(device.downloads).toHaveLength(1)
    expect(device.downloads[0]?.name).toBe(FILE_NAME)
    expect(device.downloads[0]?.href).toMatch(/^blob:/)
    // The sheet is the iPhone's way into Photos; here it would only be a longer way.
    expect(device.share).not.toHaveBeenCalled()
    // The anchor was only there to be clicked.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('has nothing to teach: no help line, and the device is not asked about one it will not show', async () => {
    const { claimHelp } = renderButton()

    await userEvent.click(button())

    await screen.findByText(fr.feed.saveDownloaded)
    expect(claimHelp).not.toHaveBeenCalled()
    expect(screen.queryByText(fr.feed.saveHelpSheet)).toBeNull()
    expect(screen.queryByText(fr.feed.saveHelpFiles)).toBeNull()
  })
})

describe('SaveButton, when the answer is a refusal', () => {
  beforeEach(() => {
    device = useFakeDevice({ kind: 'android' })
  })

  it('says the photograph could not be retrieved, and leaves the button to press again, when the network drops', async () => {
    renderButton({
      savePhoto: vi.fn(async () => {
        throw ApiError.network()
      }),
    })

    await userEvent.click(button())

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.feed.saveNetworkFailed)
    expect(button()).toBeEnabled()
    expect(device.downloads).toEqual([])
  })

  it.each([
    [429, 'rate.limited'],
    [503, 'service.notReady'],
  ])('asks for a moment on %s, and does not press for the guest', async (status, code) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { api } = renderButton(refusing(status, code, { retryAfterSeconds: 30 }))

      await userEvent.click(button())

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.feed.saveBusy)
      expect(button()).toBeDisabled()

      // Nothing retries on its own, however long the room waits...
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000)
      })
      expect(button()).toBeDisabled()
      expect(api.savePhoto).toHaveBeenCalledTimes(1)

      // ...and the button is the guest's again once the server's wait is over.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500)
      })
      expect(button()).toBeEnabled()
      expect(api.savePhoto).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits the thirty seconds the server names when it did not say how long', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderButton(refusing(429, 'rate.limited'))

      await userEvent.click(button())
      await screen.findByRole('alert')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000)
      })
      expect(button()).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500)
      })
      expect(button()).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says the photograph is gone, without "réessayez", disables the button, and tells the page', async () => {
    const { refused } = renderButton(refusing(404, 'photo.notFound'))

    await userEvent.click(button())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.feed.saveGone)
    expect(alert.textContent).not.toMatch(/réessay/i)
    expect(button()).toBeDisabled()
    expect(refused).toEqual(['gone'])
  })

  it('leaves the word to the page when the evening is not served any more', async () => {
    const { refused } = renderButton(refusing(404, 'event.notFound'))

    await userEvent.click(button())

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.feed.unavailable)
    expect(button()).toBeDisabled()
    expect(refused).toEqual(['unavailable'])
  })

  it('says the bytes are missing without blaming the network, and lets the guest press again', async () => {
    renderButton(refusing(404, 'photo.mediaMissing'))

    await userEvent.click(button())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.feed.saveMediaMissing)
    expect(alert.textContent).not.toMatch(/réseau/i)
    expect(button()).toBeEnabled()
  })

  it.each([
    ['save.disabled', 403, 'disabled'],
    ['guest.revoked', 403, 'revoked'],
    ['auth.required', 401, 'expired'],
    ['guestToken.malformed', 401, 'expired'],
  ] as const)('reports %s to the page, which owns every button', async (code, status, reason) => {
    const { refused } = renderButton(refusing(status, code))

    await userEvent.click(button())

    await waitFor(() => expect(refused).toEqual([reason]))
  })

  it('speaks a code it was not told about in the generic words, never the code', async () => {
    renderButton(refusing(500, 'something.odd'))

    await userEvent.click(button())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.errors.unknown)
    expect(alert.textContent).not.toContain('something.odd')
  })

  it('ignores a second press while the first is still in the air', async () => {
    const pending = deferred<{ blob: Blob; fileName: string | null }>()
    const { api } = renderButton({ savePhoto: vi.fn(() => pending.promise) })

    await userEvent.click(button())
    await screen.findByRole('button', { name: new RegExp(`^${fr.feed.saving}`) })
    await userEvent.click(screen.getByRole('button'))

    expect(api.savePhoto).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(ApiError.network())
    })
  })

  it('cancels the request when the photograph leaves the screen', async () => {
    const pending = deferred<{ blob: Blob; fileName: string | null }>()
    const signals: AbortSignal[] = []
    const { unmount } = renderButton({
      savePhoto: vi.fn((_slug: string, _id: string, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal)
        return pending.promise
      }),
    })

    await userEvent.click(button())
    await waitFor(() => expect(signals).toHaveLength(1))
    expect(signals[0]?.aborted).toBe(false)

    unmount()

    expect(signals[0]?.aborted).toBe(true)
  })

  it('does not download a photograph that arrives after the guest has gone', async () => {
    const pending = deferred<{ blob: Blob; fileName: string | null }>()
    const { unmount } = renderButton({ savePhoto: vi.fn(() => pending.promise) })

    await userEvent.click(button())
    unmount()
    await act(async () => {
      pending.resolve({ blob: new Blob(['x'], { type: 'image/jpeg' }), fileName: FILE_NAME })
    })

    expect(device.downloads).toEqual([])
  })
})

describe('SaveButton, announcing', () => {
  beforeEach(() => {
    device = useFakeDevice({ kind: 'android' })
  })

  it('announces nothing at rest: no live region, no status, no alert', () => {
    const { unmount } = renderButton()

    expect(button().parentElement?.querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
  })

  it('announces one polite line after a download, and nothing more', async () => {
    renderButton()

    await userEvent.click(button())

    expect(await screen.findByRole('status')).toHaveTextContent(fr.feed.saveDownloaded)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button().parentElement?.querySelector('[aria-live]')).toBeNull()
  })
})

describe('SaveButton in another language', () => {
  beforeEach(() => {
    device = useFakeDevice({ kind: 'android' })
  })

  it('reads its word, its name and its sentences from the table of the language on screen', async () => {
    renderButton(
      {
        savePhoto: vi.fn(async () => {
          throw ApiError.network()
        }),
      },
      { locale: 'en' },
    )

    const named = screen.getByRole('button', {
      name: en.feed.saveNamed(en.app.save, photoAlt(ITEM, en)),
    })
    expect(named.textContent).toBe(en.app.save)

    await userEvent.click(named)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.feed.saveNetworkFailed)
  })
})
