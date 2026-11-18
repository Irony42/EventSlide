import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { deferred } from '../../../testing/deferred'
import { useFakeDevice, type FakeDevice } from '../../../testing/fakeDevice'
import { fakeApi } from '../../../testing/renderWithProviders'
import { usePhotoSave } from './usePhotoSave'
import type { Api } from '../../../lib/api/client'

/**
 * What the button cannot show: two presses that reach the handler before the page has drawn
 * the disabled state. A real finger cannot do it (React flushes a click before the next one is
 * dispatched); a double-tap that lands in one frame, or a script, can, and one tap is one
 * request to a server that counts them.
 */

let device: FakeDevice

beforeEach(() => {
  device = useFakeDevice({ kind: 'android' })
})

afterEach(() => {
  device.restore()
})

const mount = (api: Api) =>
  renderHook(
    () =>
      usePhotoSave({
        slug: 'camille-et-sacha',
        photoId: 'photo-1',
        onRefused: () => undefined,
        claimHelp: () => false,
      }),
    {
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <LocaleProvider initialLocale="fr">
          <ApiProvider api={api}>{children}</ApiProvider>
        </LocaleProvider>
      ),
    },
  )

describe('usePhotoSave', () => {
  it('sends one request for two presses that land before the screen has changed', async () => {
    const pending = deferred<{ blob: Blob; fileName: string | null }>()
    const savePhoto = vi.fn(() => pending.promise)
    const { result } = mount(fakeApi({ savePhoto }))

    act(() => {
      result.current.press()
      result.current.press()
    })

    expect(savePhoto).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ blob: new Blob(['x'], { type: 'image/jpeg' }), fileName: null })
    })
    // Named by the page's own rule when the server named nothing usable.
    expect(device.downloads.map((entry) => entry.name)).toEqual(['camille-et-sacha-photo-1.jpg'])
  })

  it('is idle, with nothing to say, until it is pressed', () => {
    const { result } = mount(fakeApi())

    expect(result.current).toMatchObject({
      phase: 'idle',
      disabled: false,
      error: null,
      downloaded: false,
      help: null,
    })
  })
})
