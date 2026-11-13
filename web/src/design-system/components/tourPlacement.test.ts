import { describe, expect, it } from 'vitest'
import { placeBubble, TOUR_GAP, TOUR_MARGIN, unionOf } from './tourPlacement'

const VIEWPORT = { width: 1280, height: 800 }
const BUBBLE = { width: 340, height: 200 }

describe('placeBubble', () => {
  it('puts the bubble on the preferred side when it fits there', () => {
    const target = { top: 100, left: 900, width: 300, height: 500 }

    const placed = placeBubble(target, BUBBLE, VIEWPORT, 'left')

    expect(placed.side).toBe('left')
    expect(placed.left).toBe(900 - TOUR_GAP - BUBBLE.width)
    expect(placed.top).toBe(100)
  })

  it('falls back to below when the preferred side has no room', () => {
    const target = { top: 100, left: 20, width: 300, height: 100 }

    const placed = placeBubble(target, BUBBLE, VIEWPORT, 'left')

    expect(placed.side).toBe('bottom')
    expect(placed.top).toBe(200 + TOUR_GAP)
  })

  it('goes above an element at the bottom of the screen', () => {
    const target = { top: 650, left: 100, width: 600, height: 120 }

    expect(placeBubble(target, BUBBLE, VIEWPORT, 'bottom').side).toBe('top')
  })

  it('keeps the whole bubble inside the viewport, even beside a wide element at its edge', () => {
    const target = { top: 100, left: 1100, width: 170, height: 40 }

    const placed = placeBubble(target, BUBBLE, VIEWPORT, 'bottom')

    expect(placed.left + BUBBLE.width).toBeLessThanOrEqual(VIEWPORT.width - TOUR_MARGIN)
    expect(placed.left).toBeGreaterThanOrEqual(TOUR_MARGIN)
  })

  it('keeps the bubble on screen when the element is taller than the screen', () => {
    const target = { top: -200, left: 100, width: 600, height: 1400 }

    const placed = placeBubble(target, BUBBLE, VIEWPORT, 'bottom')

    expect(placed.top).toBeGreaterThanOrEqual(TOUR_MARGIN)
    expect(placed.top + BUBBLE.height).toBeLessThanOrEqual(VIEWPORT.height - TOUR_MARGIN)
  })

  it('keeps the pointer on the bubble', () => {
    const target = { top: 100, left: 1200, width: 60, height: 40 }

    const placed = placeBubble(target, BUBBLE, VIEWPORT, 'bottom')

    expect(placed.arrow).toBeGreaterThanOrEqual(18)
    expect(placed.arrow).toBeLessThanOrEqual(BUBBLE.width - 36)
  })
})

describe('unionOf', () => {
  it('is the smallest box around every box', () => {
    expect(
      unionOf([
        { top: 10, left: 10, width: 100, height: 50 },
        { top: 30, left: 200, width: 100, height: 60 },
      ]),
    ).toEqual({ top: 10, left: 10, width: 290, height: 80 })
  })

  it('is nothing for no box', () => {
    expect(unionOf([])).toBeNull()
  })
})
