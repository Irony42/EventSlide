import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useTimingOverrides } from './useTimingOverrides'

const overridesFor = (query: string) =>
  renderHook(() => useTimingOverrides(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/e/mariage/display?${query}`]}>{children}</MemoryRouter>
    ),
  }).result.current

/**
 * SEC-07: the hooks the e2e suites use are read in production too, so a link sent to a host
 * must not be able to put the projector in a 1 ms slide loop, nor past the 32-bit limit of
 * `setTimeout` (which fires at once). The bounds are the ones the server's `wallQuery` states.
 * `0` is the suites' "mount no clock / cut" value and keeps its meaning.
 */
describe('the e2e timing overrides on the display address (SEC-07)', () => {
  it.each(['250', '50', '600000', '0'])('keeps an interval of %s', (ms) => {
    expect(overridesFor(`e2e_interval=${ms}`).intervalMs).toBe(Number(ms))
  })

  it.each(['1', '49', '600001', '2147483648', '99999999999'])(
    'treats an interval of %s as absent',
    (ms) => {
      expect(overridesFor(`e2e_interval=${ms}`).intervalMs).toBeNull()
    },
  )

  it.each(['0', '200', '10000'])('keeps a transition of %s', (ms) => {
    expect(overridesFor(`e2e_transition=${ms}`).transitionMs).toBe(Number(ms))
  })

  it.each(['10001', '2147483648'])('treats a transition of %s as absent', (ms) => {
    expect(overridesFor(`e2e_transition=${ms}`).transitionMs).toBeNull()
  })
})
