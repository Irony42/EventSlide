import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { anEventDto } from '../testing/renderWithProviders'
import { EventChromeContext, useSharedReplace } from './eventChrome'

describe('a save made by a page under the event layout', () => {
  it('reaches the layout too, so the menu and the ambiance follow it', () => {
    const own = vi.fn()
    const adopt = vi.fn()
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <EventChromeContext.Provider value={{ inside: true, adopt }}>
        {children}
      </EventChromeContext.Provider>
    )
    const { result } = renderHook(() => useSharedReplace(own), { wrapper })
    const saved = anEventDto({ name: 'Le grand jour' })

    result.current(saved)

    expect(own).toHaveBeenCalledWith(saved)
    expect(adopt).toHaveBeenCalledWith(saved)
  })

  it('is the page’s own alone outside the layout', () => {
    const own = vi.fn()
    const { result } = renderHook(() => useSharedReplace(own))

    result.current(anEventDto())

    expect(own).toHaveBeenCalledTimes(1)
  })
})
