import { useRef, type PointerEvent } from 'react'

interface Drag {
  readonly pointer: number
  readonly element: Element
  readonly x: number
  readonly y: number
  readonly focusX: number
  readonly focusY: number
  readonly overflowX: number
  readonly overflowY: number
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

/**
 * Where a photograph is anchored after the host dragged it by (`dx`, `dy`) screen pixels.
 *
 * A picture drawn `object-fit: cover` only has room to move along the axis it overflows, by
 * `overflow` pixels, and `object-position: p%` moves it by p % of that room: so dragging the
 * picture one way reads as lowering the anchor the other way, by dx over the room. An axis with
 * no room (the picture exactly fills the box there) does not move.
 */
export const framingAfterDrag = (
  start: { readonly focusX: number; readonly focusY: number },
  drag: { readonly dx: number; readonly dy: number },
  overflow: { readonly x: number; readonly y: number },
): { readonly focusX: number; readonly focusY: number } => ({
  focusX: overflow.x > 1 ? clampPercent(start.focusX - (drag.dx / overflow.x) * 100) : start.focusX,
  focusY: overflow.y > 1 ? clampPercent(start.focusY - (drag.dy / overflow.y) * 100) : start.focusY,
})

/**
 * Drag the photograph on the card to frame it. A convenience over the two sliders, which stay the
 * keyboard path (and the one a screen reader uses): the handlers sit on the preview, not on the
 * photograph, because the card is redrawn from the host's choices and its parts come and go.
 */
export function usePhotoFraming({
  focusX,
  focusY,
  onFrame,
}: {
  readonly focusX: number
  readonly focusY: number
  readonly onFrame: (focusX: number, focusY: number) => void
}) {
  const drag = useRef<Drag | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const photo = event.target.closest('[data-print-photo]')
    const image = photo?.querySelector('img')
    if (photo === null || photo === undefined || !image) return
    const box = photo.getBoundingClientRect()
    if (image.naturalWidth === 0 || image.naturalHeight === 0) return
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight)
    drag.current = {
      pointer: event.pointerId,
      element: photo,
      x: event.clientX,
      y: event.clientY,
      focusX,
      focusY,
      overflowX: image.naturalWidth * scale - box.width,
      overflowY: image.naturalHeight * scale - box.height,
    }
    photo.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointer) return
    const next = framingAfterDrag(
      current,
      { dx: event.clientX - current.x, dy: event.clientY - current.y },
      { x: current.overflowX, y: current.overflowY },
    )
    if (next.focusX !== focusX || next.focusY !== focusY) onFrame(next.focusX, next.focusY)
  }

  const end = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointer) return
    current.element.releasePointerCapture?.(event.pointerId)
    drag.current = null
  }

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end }
}
