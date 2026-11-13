import { describe, expect, it } from 'vitest'
import { GUIDED_TOURS, isGuidedTour } from './guidedTour'

describe('guided tours', () => {
  it('knows the event page tour', () => {
    expect(GUIDED_TOURS).toContain('eventPage')
    expect(isGuidedTour('eventPage')).toBe(true)
  })

  it('refuses a tour nobody wrote, whatever its type', () => {
    expect(isGuidedTour('dashboard')).toBe(false)
    expect(isGuidedTour('EventPage')).toBe(false)
    expect(isGuidedTour('')).toBe(false)
    expect(isGuidedTour(undefined)).toBe(false)
    expect(isGuidedTour(1)).toBe(false)
  })
})
