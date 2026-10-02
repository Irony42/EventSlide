import { describe, expect, it, vi } from 'vitest'
import { rememberSupportCardDismissal, wasSupportCardDismissed } from './supportCardDismissal'

/**
 * The memory behind "close the support card" (roadmap G4-02): per event, on this device,
 * and never an error. The component's own tests cover what a host sees; these pin the
 * storage contract it rests on.
 */
describe('the support card’s memory', () => {
  it('has not been closed for an event nobody closed it for', () => {
    expect(wasSupportCardDismissed('event-1')).toBe(false)
  })

  it('remembers a closure for that event and for no other', () => {
    rememberSupportCardDismissal('event-1')

    expect(wasSupportCardDismissed('event-1')).toBe(true)
    expect(wasSupportCardDismissed('event-2')).toBe(false)
  })

  it('keeps its answer out of the server’s reach: one local key per event, nothing else written', () => {
    rememberSupportCardDismissal('event-1')

    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem('eventslide.support.dismissed.event-1')).toBe('1')
  })

  it('answers "not closed" when reading throws, rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(wasSupportCardDismissed('event-1')).toBe(false)
  })

  it('does not throw when writing throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    expect(() => rememberSupportCardDismissal('event-1')).not.toThrow()
  })
})
