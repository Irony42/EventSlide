import { describe, expect, it } from 'vitest'
import { commitDistance, decisionOnRelease, readSwipe } from './swipeGesture'

/**
 * The rules of the gesture, stated without a browser.
 *
 * Everything a swipe promises a host is a number: it has to be far enough to be
 * deliberate, it has to say which way it is going before they let go, and it has to be
 * cancellable by dragging back. Asserting that here rather than on a rendered
 * `transform` is what keeps those promises checkable when the card is restyled.
 */

/** A phone held in one hand. 360 px of card: a quarter of it is 90 px. */
const CARD = 360

describe('readSwipe', () => {
  it('reads a drag to the right as publishing and one to the left as refusing', () => {
    expect(readSwipe({ dx: 40, dy: 0, width: CARD }).intent).toBe('publish')
    expect(readSwipe({ dx: -40, dy: 0, width: CARD }).intent).toBe('reject')
  })

  it('says which way the card is going long before it decides', () => {
    // The safety of a swipe is the chance to change your mind, and a host can only take
    // one back if they were told it had started.
    const reading = readSwipe({ dx: 20, dy: 0, width: CARD })

    expect(reading.intent).toBe('publish')
    expect(reading.committed).toBe(false)
  })

  it('announces nothing for a thumb that only trembled', () => {
    const reading = readSwipe({ dx: 6, dy: 0, width: CARD })

    expect(reading.intent).toBeNull()
    expect(reading.committed).toBe(false)
  })

  it('commits once the card has travelled a quarter of its own width', () => {
    // 90 px on a 360 px card. One below is still undecided, which is the boundary a
    // host feels as "not yet".
    expect(readSwipe({ dx: 89, dy: 0, width: CARD }).committed).toBe(false)
    expect(readSwipe({ dx: 90, dy: 0, width: CARD }).committed).toBe(true)
  })

  it('takes the swipe back when the host drags it under the threshold again', () => {
    // The reading is derived from where the thumb is now, never accumulated — so
    // returning is not an undo, it is simply a smaller number.
    const committed = readSwipe({ dx: 140, dy: 0, width: CARD })
    const returned = readSwipe({ dx: 30, dy: 0, width: CARD })

    expect(committed.committed).toBe(true)
    expect(returned.committed).toBe(false)
    expect(returned.intent).toBe('publish')
  })

  it('leaves the card where it is while the host is scrolling the page', () => {
    // A thumb travelling down a list drifts sideways. Moving the card then — or worse,
    // publishing on release — is how a scroll becomes a decision nobody took.
    const reading = readSwipe({ dx: 30, dy: 80, width: CARD })

    expect(reading.offset).toBe(0)
    expect(reading.intent).toBeNull()
    expect(reading.committed).toBe(false)
  })

  it('moves the card with the thumb', () => {
    expect(readSwipe({ dx: 48, dy: 4, width: CARD }).offset).toBe(48)
  })

  it('keeps a gesture it has already claimed when the thumb drifts down', () => {
    // A hand pivots from the wrist, so a deliberate sideways swipe is an arc. A touch
    // screen resolves this itself — `touch-action: pan-y` hands the gesture over the
    // moment it goes sideways and does not take it back — and a mouse does not, so the
    // latch says the same thing in one place for both.
    const drifted = { dx: 120, dy: 300, width: CARD }

    expect(readSwipe({ ...drifted, locked: true }).committed).toBe(true)
    expect(readSwipe(drifted).committed).toBe(false)
  })

  it('never claims a gesture that started out vertical', () => {
    // The latch is only ever set by a reading that was already horizontal, so the first
    // reading of a scroll cannot arrive latched. Stated here because the safety of the
    // whole gesture rests on it: a page scroll must not be able to publish.
    expect(readSwipe({ dx: 10, dy: 200, width: CARD }).intent).toBeNull()
  })

  it('reports how close the gesture is, and never claims more than all of it', () => {
    // The hint strengthens as the card travels, so "almost" is visible rather than a
    // state that appears from nothing at the threshold.
    expect(readSwipe({ dx: 45, dy: 0, width: CARD }).progress).toBeCloseTo(0.5)
    expect(readSwipe({ dx: 900, dy: 0, width: CARD }).progress).toBe(1)
  })
})

describe('commitDistance', () => {
  it('scales with the card, so the gesture feels the same on every phone', () => {
    expect(commitDistance(400)).toBe(100)
    expect(commitDistance(480)).toBe(120)
  })

  it('keeps a floor, so a card that has not been measured cannot decide instantly', () => {
    // A first paint reports a width of zero. Without the floor the commit distance
    // would be zero too, and the first stray pointer movement would publish a photo.
    expect(commitDistance(0)).toBe(56)
  })

  it('keeps a ceiling, so a wide screen does not ask for a forearm-length drag', () => {
    expect(commitDistance(1_600)).toBe(144)
  })
})

describe('decisionOnRelease', () => {
  it('decides the direction the gesture committed to', () => {
    expect(decisionOnRelease(readSwipe({ dx: 200, dy: 0, width: CARD }))).toBe('publish')
    expect(decisionOnRelease(readSwipe({ dx: -200, dy: 0, width: CARD }))).toBe('reject')
  })

  it('decides nothing when the host let go short of the threshold', () => {
    expect(decisionOnRelease(readSwipe({ dx: 60, dy: 0, width: CARD }))).toBeNull()
  })

  it('decides nothing when the finger never really moved', () => {
    // A tap on the photo is not a decision. It has to stay one of the ways a host can
    // do nothing at all.
    expect(decisionOnRelease(readSwipe({ dx: 0, dy: 0, width: CARD }))).toBeNull()
  })
})
