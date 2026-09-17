import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { useLocale } from '../../../lib/i18n/useTranslations'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { aGuestPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { useMyPhotos } from './useMyPhotos'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { GuestPhotoDto } from '../../../lib/api/dto'

/**
 * A guest's own photos, as state.
 *
 * `GuestUploadPage.test.tsx` covers what the guest reads. What is left here is the
 * ordering on a connection that drops and comes back: this list is the only thing that
 * tells a guest their photo arrived, so an answer from an abandoned request putting the
 * old list — or an error — back on screen is what makes them send it again.
 */

const SLUG = 'camille-et-sacha'

type Mine = { readonly items: readonly GuestPhotoDto[] }

/** A promise the test settles by hand, to hold two reads open at once. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle: (value: T) => settle(value), fail: (cause: unknown) => fail(cause) }
}

const mount = (api: Api) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )
  return renderHook(() => useMyPhotos(SLUG), { wrapper })
}

describe('useMyPhotos', () => {
  it('does not let a superseded read replace the current list', async () => {
    const stale = deferred<Mine>()
    const fresh = deferred<Mine>()
    const answers = [() => stale.promise, () => fresh.promise]
    const api = fakeApi({
      myPhotos: vi.fn(() => (answers.shift() ?? (() => Promise.resolve({ items: [] })))()),
    })
    const { result } = mount(api)

    act(() => result.current.refresh())
    await act(async () => {
      fresh.settle({ items: [aGuestPhoto({ id: 'photo-2' })] })
      await fresh.promise
    })
    await act(async () => {
      stale.settle({ items: [] })
      await stale.promise
    })

    expect(result.current.photos.map((photo) => photo.id)).toEqual(['photo-2'])
  })

  it('does not report a failure from a read nobody is waiting for', async () => {
    // The list is replaced by an empty one when a read fails, so a stale failure would
    // wipe the photos a guest can see straight after a successful refresh.
    const stale = deferred<Mine>()
    const fresh = deferred<Mine>()
    const answers = [() => stale.promise, () => fresh.promise]
    const api = fakeApi({
      myPhotos: vi.fn(() => (answers.shift() ?? (() => Promise.resolve({ items: [] })))()),
    })
    const { result } = mount(api)

    act(() => result.current.refresh())
    await act(async () => {
      fresh.settle({ items: [aGuestPhoto({ id: 'photo-2' })] })
      await fresh.promise
    })
    await act(async () => {
      stale.fail(new Error('network'))
      await stale.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.photos).toHaveLength(1)
  })

  it('does not call an aborted read a failure', async () => {
    const aborted = deferred<Mine>()
    const api = fakeApi({ myPhotos: vi.fn(() => aborted.promise) })
    const { result } = mount(api)

    await act(async () => {
      aborted.fail(new DOMException('The user aborted a request.', 'AbortError'))
      await aborted.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('says something in French when a deletion fails for a reason with no error code', async () => {
    // Anything that is not an `ApiError` is a bug in this build, and its message is an
    // internal English string. A guest must never be shown one.
    const api = fakeApi({
      myPhotos: vi.fn(async () => ({ items: [aGuestPhoto()] })),
      deleteMyPhoto: vi.fn(async () => {
        throw new TypeError('e.json is not a function')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.photos).toHaveLength(1))

    await act(async () => {
      await result.current.remove('photo-1')
    })

    expect(result.current.error).toBe(fr.errors.unknown)
    // The list is kept: a refused deletion is not a reason to blank the one screen
    // that tells the guest their photos arrived.
    expect(result.current.photos).toHaveLength(1)
  })
})

/**
 * Changing language is a copy change, not a reason to go back to the server.
 *
 * "Vos envois" is the one screen that tells a guest their photos arrived, and the guest
 * is on venue Wi-Fi. Re-reading it because they tapped the language picker costs a round
 * trip for nothing — and when that round trip fails, the error branch replaces the list
 * with an empty one, so the thumbnails that were the whole point of the screen disappear
 * and the guest is told their uploads could not be shown. They uploaded nothing and lost
 * nothing; only the language changed.
 */
describe('useMyPhotos when the guest changes language', () => {
  const mountWithLocale = (api: Api) => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <LocaleProvider initialLocale="fr">
        <ApiProvider api={api}>{children}</ApiProvider>
      </LocaleProvider>
    )
    return renderHook(() => ({ mine: useMyPhotos(SLUG), locale: useLocale() }), { wrapper })
  }

  it('does not read the list again', async () => {
    const api = fakeApi({
      myPhotos: vi.fn(async () => ({ items: [aGuestPhoto({ id: 'photo-1' })] })),
    })
    const { result } = mountWithLocale(api)
    await waitFor(() => expect(result.current.mine.photos).toHaveLength(1))

    act(() => result.current.locale.setLocale('de'))

    await waitFor(() => expect(result.current.locale.locale).toBe('de'))
    expect(api.myPhotos).toHaveBeenCalledTimes(1)
  })

  it('keeps the photos on screen', async () => {
    // The consequence, stated as the guest sees it: whatever the re-read would have
    // done, the thumbnails that say "your photos arrived" are still there.
    const answers = [
      async () => ({ items: [aGuestPhoto({ id: 'photo-1' })] }),
      async () => {
        throw new Error('the venue Wi-Fi went away')
      },
    ]
    const api = fakeApi({
      myPhotos: vi.fn(() => (answers.shift() ?? (async () => ({ items: [] })))()),
    })
    const { result } = mountWithLocale(api)
    await waitFor(() => expect(result.current.mine.photos).toHaveLength(1))

    act(() => result.current.locale.setLocale('de'))
    await waitFor(() => expect(result.current.locale.locale).toBe('de'))

    expect(result.current.mine.photos).toHaveLength(1)
    expect(result.current.mine.error).toBeNull()
  })

  it('words a failure in the language the guest is reading now', async () => {
    // The other half: the message must not be frozen at the moment the read failed, or
    // a guest who switches language keeps reading the old one.
    const api = fakeApi({
      myPhotos: vi.fn(async () => {
        throw new Error('the venue Wi-Fi went away')
      }),
    })
    const { result } = mountWithLocale(api)
    await waitFor(() => expect(result.current.mine.error).toBe(fr.upload.mineFailed))

    act(() => result.current.locale.setLocale('de'))

    await waitFor(() => expect(result.current.mine.error).toBe(de.upload.mineFailed))
  })
})
