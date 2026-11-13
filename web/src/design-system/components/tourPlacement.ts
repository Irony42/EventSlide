/**
 * Where a guided tour's bubble goes beside the element it explains. Pure, so the geometry is
 * tested without a browser.
 */

export type TourSide = 'top' | 'bottom' | 'left' | 'right'

export interface Box {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface TourPlacement {
  readonly top: number
  readonly left: number
  readonly side: TourSide
  /** Where the bubble's pointer sits along its edge, from the bubble's own start. */
  readonly arrow: number
}

/** Room kept between the bubble and the lit element, and between the bubble and the viewport. */
export const TOUR_GAP = 14
export const TOUR_MARGIN = 12

/** The smallest box holding every one of `boxes`; `null` for none. */
export const unionOf = (boxes: readonly Box[]): Box | null => {
  if (boxes.length === 0) return null
  const top = Math.min(...boxes.map((box) => box.top))
  const left = Math.min(...boxes.map((box) => box.left))
  const bottom = Math.max(...boxes.map((box) => box.top + box.height))
  const right = Math.max(...boxes.map((box) => box.left + box.width))
  return { top, left, width: right - left, height: bottom - top }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)))

const fits = (side: TourSide, target: Box, bubble: Size, viewport: Size): boolean => {
  switch (side) {
    case 'bottom':
      return target.top + target.height + TOUR_GAP + bubble.height <= viewport.height - TOUR_MARGIN
    case 'top':
      return target.top - TOUR_GAP - bubble.height >= TOUR_MARGIN
    case 'left':
      return target.left - TOUR_GAP - bubble.width >= TOUR_MARGIN
    case 'right':
      return target.left + target.width + TOUR_GAP + bubble.width <= viewport.width - TOUR_MARGIN
  }
}

/**
 * The preferred side when the bubble fits there, else the first side it fits on, else the side
 * with the most room below or above. The bubble is then kept inside the viewport on both axes,
 * whatever that costs the pointer: a bubble whose buttons leave the screen is the one failure
 * this must not have.
 */
export const placeBubble = (
  target: Box,
  bubble: Size,
  viewport: Size,
  preferred: TourSide = 'bottom',
): TourPlacement => {
  const order: readonly TourSide[] = [preferred, 'bottom', 'top', 'right', 'left']
  const side =
    order.find((candidate) => fits(candidate, target, bubble, viewport)) ??
    (target.top > viewport.height - (target.top + target.height) ? 'top' : 'bottom')

  const maxLeft = viewport.width - bubble.width - TOUR_MARGIN
  const maxTop = viewport.height - bubble.height - TOUR_MARGIN
  let top: number
  let left: number
  if (side === 'bottom' || side === 'top') {
    top =
      side === 'bottom'
        ? target.top + target.height + TOUR_GAP
        : target.top - TOUR_GAP - bubble.height
    left = target.left
  } else {
    left =
      side === 'right'
        ? target.left + target.width + TOUR_GAP
        : target.left - TOUR_GAP - bubble.width
    top = target.top
  }
  top = clamp(top, TOUR_MARGIN, maxTop)
  left = clamp(left, TOUR_MARGIN, maxLeft)

  // The pointer aims at the start of the lit element, a little in, and stays on the bubble.
  const arrow =
    side === 'bottom' || side === 'top'
      ? clamp(target.left + 28 - left, 18, bubble.width - 36)
      : clamp(target.top + 26 - top, 18, bubble.height - 36)

  return { top, left, side, arrow }
}
