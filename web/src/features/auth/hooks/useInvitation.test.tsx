import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { useLocale } from '../../../lib/i18n/useTranslations'
import { ApiError } from '../../../lib/http'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { anInvitationPreview, fakeApi } from '../../../testing/renderWithProviders'
import { useInvitationPreview } from './useInvitation'
import type { ReactNode } from 'react'
import type { Api, InvitationPreviewDto } from '../../../lib/api/client'

/**
 * What a link's preview comes to, as state.
 *
 * `AcceptInvitationPage.test.tsx` covers what the reader sees. What is left here is what the
 * page cannot tell apart from the outside: which link an answer is for, which request wins on
 * a connection that drops and returns, and that asking again is a wait and not the old answer.
 */

/** A promise the test settles by hand, to hold two reads open at once. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle: (value: T) => settle(value) }
}

const wrap = (api: Api) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <LocaleProvider initialLocale="fr">
        <ApiProvider api={api}>{children}</ApiProvider>
      </LocaleProvider>
    )
  }

const mount = (api: Api, token = 'lien-1') =>
  renderHook(
    (props: { readonly token: string }) => ({
      preview: useInvitationPreview(props.token),
      locale: useLocale(),
    }),
    { wrapper: wrap(api), initialProps: { token } },
  )

describe('useInvitationPreview', () => {
  it('waits, then says what the link offers', async () => {
    const preview = anInvitationPreview()
    const api = fakeApi({ invitation: vi.fn(async () => preview) })

    const { result } = mount(api)

    expect(result.current.preview.view).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current.preview.view).toEqual({ kind: 'ready', preview }))
    expect(api.invitation).toHaveBeenCalledWith('lien-1', expect.any(AbortSignal))
  })

  it.each([
    ['an unknown, spent or expired link', new ApiError(404, 'invitation.notFound')],
    ['a link to an archived event', new ApiError(409, 'event.immutable')],
  ])('calls %s dead', async (_name, error) => {
    const api = fakeApi({ invitation: vi.fn(() => Promise.reject(error)) })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.preview.view).toEqual({ kind: 'dead' }))
  })

  it('does not call a dropped connection a dead link, and says so in the reader’s words', async () => {
    const api = fakeApi({ invitation: vi.fn(() => Promise.reject(ApiError.network())) })

    const { result } = mount(api)

    await waitFor(() =>
      expect(result.current.preview.view).toEqual({ kind: 'failed', message: fr.errors.network }),
    )
  })

  it('words the failure in the language the reader is using now, without asking again', async () => {
    const api = fakeApi({ invitation: vi.fn(() => Promise.reject(ApiError.network())) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.preview.view.kind).toBe('failed'))

    act(() => result.current.locale.setLocale('de'))

    await waitFor(() =>
      expect(result.current.preview.view).toEqual({ kind: 'failed', message: de.errors.network }),
    )
    expect(api.invitation).toHaveBeenCalledTimes(1)
  })

  it('shows the wait from the press of the retry, and then the answer', async () => {
    // A retry that kept the sentence up until the answer arrived would look like a button
    // that did nothing, on the one connection where the reader is already unsure.
    const preview = anInvitationPreview()
    const retry = deferred<InvitationPreviewDto>()
    const api = fakeApi({
      invitation: vi
        .fn<Api['invitation']>()
        .mockRejectedValueOnce(ApiError.network())
        .mockReturnValueOnce(retry.promise),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.preview.view.kind).toBe('failed'))

    act(() => result.current.preview.reload())

    expect(result.current.preview.view).toEqual({ kind: 'loading' })
    await act(async () => {
      retry.settle(preview)
      await retry.promise
    })
    expect(result.current.preview.view).toEqual({ kind: 'ready', preview })
  })

  it('shows the wait, not the previous link’s invitation, when the link changes', async () => {
    const first = anInvitationPreview({ targetName: 'Camille et Sacha' })
    const second = deferred<InvitationPreviewDto>()
    const api = fakeApi({
      invitation: vi
        .fn<Api['invitation']>()
        .mockResolvedValueOnce(first)
        .mockReturnValueOnce(second.promise),
    })
    const { result, rerender } = mount(api, 'lien-1')
    await waitFor(() => expect(result.current.preview.view.kind).toBe('ready'))

    rerender({ token: 'lien-2' })

    expect(result.current.preview.view).toEqual({ kind: 'loading' })
    await act(async () => {
      second.settle(anInvitationPreview({ targetName: 'Studio Lune' }))
      await second.promise
    })
    expect(result.current.preview.view).toMatchObject({
      kind: 'ready',
      preview: { targetName: 'Studio Lune' },
    })
  })

  it('does not let the answer for a link the reader has left replace the current one', async () => {
    const stale = deferred<InvitationPreviewDto>()
    const fresh = deferred<InvitationPreviewDto>()
    const answers = [stale, fresh]
    const api = fakeApi({
      invitation: vi.fn(() => (answers.shift() ?? fresh).promise),
    })
    const { result, rerender } = mount(api, 'lien-1')

    rerender({ token: 'lien-2' })
    await act(async () => {
      fresh.settle(anInvitationPreview({ targetName: 'Studio Lune' }))
      await fresh.promise
    })
    await act(async () => {
      stale.settle(anInvitationPreview({ targetName: 'Camille et Sacha' }))
      await stale.promise
    })

    expect(result.current.preview.view).toMatchObject({
      kind: 'ready',
      preview: { targetName: 'Studio Lune' },
    })
  })

  it('gives up its read when the reader leaves the page', async () => {
    const signals: AbortSignal[] = []
    const api = fakeApi({
      invitation: vi.fn((_token: string, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal)
        return new Promise<InvitationPreviewDto>(() => {})
      }),
    })
    const { unmount } = mount(api)
    await waitFor(() => expect(signals).toHaveLength(1))

    unmount()

    expect(signals[0]?.aborted).toBe(true)
  })
})
