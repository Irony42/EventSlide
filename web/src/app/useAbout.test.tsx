import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AboutProvider } from './AboutProvider'
import { ApiProvider } from './ApiProvider'
import { useAbout } from './useAbout'
import { anAbout, fakeApi } from '../testing/renderWithProviders'
import type { About } from '../lib/api/dto'

const aboutAnswering = (answer: unknown) => {
  const api = fakeApi({ about: async () => answer as About })
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>
      <AboutProvider>{children}</AboutProvider>
    </ApiProvider>
  )
  return renderHook(() => useAbout(), { wrapper })
}

/**
 * `features.forgotPassword` decides whether the sign-in page offers a link to a page that
 * can work (G2-10 / P3-11). The one reading that matters is the negative: every answer that is
 * not exactly `true` must leave the link off, because on a box with no mail relay the link
 * leads to a form the server then refuses.
 */
describe('useAbout: features.forgotPassword', () => {
  it('is off until the server has answered', () => {
    const { result } = aboutAnswering(anAbout())

    expect(result.current.features.forgotPassword).toBe(false)
  })

  it('is on when the server says it can send mail', async () => {
    const { result } = aboutAnswering(
      anAbout({ features: { siteAdmin: false, forgotPassword: true } }),
    )

    await waitFor(() => expect(result.current.features.forgotPassword).toBe(true))
  })

  it.each([
    ['a server older than the flag', { features: { siteAdmin: true } }],
    ['no features at all', {}],
    ['a string', { features: { forgotPassword: 'true' } }],
    ['a number', { features: { forgotPassword: 1 } }],
    ['null', { features: { forgotPassword: null } }],
    ['features that are not an object', { features: 'on' }],
  ])('stays off for %s', async (_name, answer) => {
    const { result } = aboutAnswering({ ...anAbout(), ...answer })

    // The version of the answer is the proof the answer was read at all.
    await waitFor(() => expect(result.current.version).toBe('9.9.9-server'))
    expect(result.current.features.forgotPassword).toBe(false)
  })

  it('does not let one flag carry the other', async () => {
    const { result } = aboutAnswering(
      anAbout({ features: { siteAdmin: true, forgotPassword: false } }),
    )

    await waitFor(() => expect(result.current.features.siteAdmin).toBe(true))
    expect(result.current.features.forgotPassword).toBe(false)
  })
})

describe('AboutProvider', () => {
  const wrapperFor = (api: ReturnType<typeof fakeApi>) =>
    function Wrapper({ children }: { readonly children: ReactNode }) {
      return (
        <ApiProvider api={api}>
          <AboutProvider>{children}</AboutProvider>
        </ApiProvider>
      )
    }

  it('asks the server once however many readers there are', async () => {
    // The router, the footer and the page each read it. They used to ask for themselves.
    const api = fakeApi({ about: vi.fn(async () => anAbout({ version: '7.7.7' })) })

    const { result } = renderHook(() => [useAbout(), useAbout(), useAbout()], {
      wrapper: wrapperFor(api),
    })

    await waitFor(() =>
      expect(result.current.map((about) => about.version)).toEqual(Array(3).fill('7.7.7')),
    )
    expect(api.about).toHaveBeenCalledTimes(1)
  })

  it('keeps the build’s own answer, without a word, when the server cannot be asked', async () => {
    const api = fakeApi({ about: vi.fn(() => Promise.reject(new Error('offline'))) })

    const { result } = renderHook(() => useAbout(), { wrapper: wrapperFor(api) })

    await waitFor(() => expect(api.about).toHaveBeenCalled())
    expect(result.current.name).toBe('EventSlide')
    expect(result.current.sourceUrl).not.toBe('')
  })

  it('answers with the build’s own answer where no provider is mounted', () => {
    // A component under test with nothing above it renders what the footer renders before
    // the server has spoken: complete, never `undefined`.
    const { result } = renderHook(() => useAbout())

    expect(result.current.features).toEqual({ siteAdmin: false, forgotPassword: false })
    expect(result.current.links).toEqual({})
  })
})
