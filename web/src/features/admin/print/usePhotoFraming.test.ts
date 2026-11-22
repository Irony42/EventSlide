import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { framingAfterDrag, usePhotoFraming } from './usePhotoFraming'

const centre = { focusX: 50, focusY: 50 }

describe('framing a photograph by dragging it', () => {
  it('moves the anchor the other way, in proportion to the room the picture has', () => {
    // A picture 100 px wider than its box: dragging it 25 px right shows 25 % more of its left side.
    expect(framingAfterDrag(centre, { dx: 25, dy: 0 }, { x: 100, y: 0 })).toEqual({
      focusX: 25,
      focusY: 50,
    })
    expect(framingAfterDrag(centre, { dx: 0, dy: -10 }, { x: 0, y: 40 })).toEqual({
      focusX: 50,
      focusY: 75,
    })
  })

  it('never leaves the picture: the anchor stays between 0 and 100', () => {
    expect(framingAfterDrag(centre, { dx: 900, dy: -900 }, { x: 100, y: 100 })).toEqual({
      focusX: 0,
      focusY: 100,
    })
  })

  it('leaves an axis alone when the picture exactly fills the box there', () => {
    expect(
      framingAfterDrag({ focusX: 30, focusY: 70 }, { dx: 80, dy: 80 }, { x: 0, y: 0 }),
    ).toEqual({
      focusX: 30,
      focusY: 70,
    })
  })

  it('keeps whole percents, as the stored preference requires', () => {
    const next = framingAfterDrag(centre, { dx: 7, dy: 0 }, { x: 90, y: 0 })
    expect(Number.isInteger(next.focusX)).toBe(true)
  })
})

describe('the drag on the card', () => {
  /** A photograph slot 100 × 100 px holding a picture twice as wide as tall: 100 px of room sideways. */
  const photoSlot = (natural = { width: 400, height: 200 }) => {
    const slot = document.createElement('div')
    slot.setAttribute('data-print-photo', '')
    const image = document.createElement('img')
    Object.defineProperty(image, 'naturalWidth', { value: natural.width })
    Object.defineProperty(image, 'naturalHeight', { value: natural.height })
    slot.append(image)
    slot.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    document.body.append(slot)
    return { slot, image }
  }

  const pointer = (
    target: Element,
    init: {
      readonly x?: number
      readonly y?: number
      readonly id?: number
      readonly button?: number
    },
  ) => {
    const preventDefault = vi.fn()
    const event = {
      target,
      button: init.button ?? 0,
      pointerId: init.id ?? 1,
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
      preventDefault,
    }
    return { event: event as unknown as PointerEvent<HTMLElement>, preventDefault }
  }

  const hook = (onFrame = vi.fn()) => {
    const { result } = renderHook(() => usePhotoFraming({ focusX: 50, focusY: 50, onFrame }))
    return { handlers: result.current, onFrame }
  }

  it('reframes the photograph as it is dragged, and stops at the release', () => {
    const { image } = photoSlot()
    const { handlers, onFrame } = hook()

    const down = pointer(image, { x: 10, y: 10 })
    handlers.onPointerDown(down.event)
    expect(down.preventDefault).toHaveBeenCalled()
    handlers.onPointerMove(pointer(image, { x: 35, y: 10 }).event)
    expect(onFrame).toHaveBeenLastCalledWith(25, 50)

    handlers.onPointerUp(pointer(image, { x: 35, y: 10 }).event)
    onFrame.mockClear()
    handlers.onPointerMove(pointer(image, { x: 60, y: 10 }).event)
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('says nothing for a move that leaves the framing as it is', () => {
    const { image } = photoSlot()
    const { handlers, onFrame } = hook()

    handlers.onPointerDown(pointer(image, { x: 10, y: 10 }).event)
    // Up and down only: the picture fills the box vertically, so nothing moves.
    handlers.onPointerMove(pointer(image, { x: 10, y: 40 }).event)

    expect(onFrame).not.toHaveBeenCalled()
  })

  it('follows only the pointer that took the photograph', () => {
    const { image } = photoSlot()
    const { handlers, onFrame } = hook()

    handlers.onPointerDown(pointer(image, { x: 10, y: 10, id: 1 }).event)
    handlers.onPointerMove(pointer(image, { x: 60, y: 10, id: 2 }).event)
    handlers.onPointerCancel(pointer(image, { id: 2 }).event)

    expect(onFrame).not.toHaveBeenCalled()
    handlers.onPointerMove(pointer(image, { x: 35, y: 10, id: 1 }).event)
    expect(onFrame).toHaveBeenCalledWith(25, 50)
  })

  it('takes nothing but a primary press on a photograph whose picture has loaded', () => {
    const { handlers, onFrame } = hook()
    const loaded = photoSlot()
    const empty = photoSlot({ width: 0, height: 0 })
    const elsewhere = document.createElement('p')
    document.body.append(elsewhere)

    for (const press of [
      pointer(loaded.image, { button: 2 }),
      pointer(elsewhere, {}),
      pointer(empty.image, {}),
    ]) {
      handlers.onPointerDown(press.event)
      expect(press.preventDefault).not.toHaveBeenCalled()
    }
    handlers.onPointerMove(pointer(loaded.image, { x: 90 }).event)
    expect(onFrame).not.toHaveBeenCalled()
  })
})
