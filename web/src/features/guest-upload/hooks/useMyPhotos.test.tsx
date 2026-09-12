import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
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
