import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRootGroundHue } from './useRootGroundHue'

const rootHue = () => document.documentElement.style.getPropertyValue('--ground-hue')

describe('useRootGroundHue', () => {
  afterEach(() => document.documentElement.style.removeProperty('--ground-hue'))

  it('gives the page around a custom event the host’s ground hue, and takes it back when it goes', () => {
    const { rerender, unmount } = renderHook(
      ({ hue }) => useRootGroundHue('custom', { ground: 'light', groundHue: hue, faces: 'noces' }),
      {
        initialProps: { hue: 140 },
      },
    )
    expect(rootHue()).toBe('140deg')

    rerender({ hue: 20 })
    expect(rootHue()).toBe('20deg')

    unmount()
    expect(rootHue()).toBe('')
  })

  it('hands the root back to a writer still mounted when another one leaves', () => {
    const custom = (groundHue: number) => ({ ground: 'dark', groundHue, faces: 'cabaret' }) as const
    const marker = renderHook(() => useRootGroundHue('custom', custom(60)))
    const surface = renderHook(() => useRootGroundHue('custom', custom(60)))
    surface.unmount()
    expect(rootHue()).toBe('60deg')
    marker.unmount()
    expect(rootHue()).toBe('')
  })

  it('leaves the root alone for a designed ambiance, even one that still carries a stray object', () => {
    renderHook(() => useRootGroundHue('noces', { ground: 'dark', groundHue: 90, faces: 'cabaret' }))
    expect(rootHue()).toBe('')
  })
})
