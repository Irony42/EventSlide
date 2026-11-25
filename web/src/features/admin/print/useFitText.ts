import { useLayoutEffect, type RefObject } from 'react'

/** Shrink factor per step, and the most steps taken: 0.94^40 is a twelfth of the size. */
const STEP = 0.94
const MAX_STEPS = 40
/** The most a text may spill out of its box, in pixels, whatever its size. */
const MAX_TOLERANCE_PX = 1.5

/**
 * Shrinks every `[data-fit]` text inside each printed card until it fits its box (spec 28).
 *
 * A host's title can be "Camille & Sacha" or seventy characters; the designs give each text a
 * box (`max-block-size`, a width) and this brings the type down until it stays inside, so a long
 * name never pushes the QR off the card. The size found is written in `cqw` of the card, so it
 * holds when the preview is resized and when the browser lays the sheet out again for paper.
 *
 * A text written on one line (`white-space: nowrap`) that would fall under `data-fit-min` (in
 * `cqw`) is allowed to wrap instead, and fitted again: a masthead stays one line when it can.
 * Script faces draw past their line box, so an overflow of under 14 % of the size is tolerated, up
 * to a pixel and a half: a card drawn big must not cut a line of its text.
 *
 * Measured, so it does nothing where nothing is laid out (jsdom), and runs again when the fonts
 * arrive (a fallback face measures differently) and when the sheet is resized.
 */
export function useFitText(root: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    const run = () => fitAll(element)
    run()
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) run()
    })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run)
    observer?.observe(element)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [root, key])
}

const fitAll = (root: HTMLElement): void => {
  for (const card of root.querySelectorAll<HTMLElement>('[data-print-card]')) {
    const width = card.getBoundingClientRect().width
    if (width === 0) continue
    for (const text of card.querySelectorAll<HTMLElement>('[data-fit]')) fit(text, width)
  }
}

/**
 * A text overflows when its content is taller than its box allows or wider than its box. The box
 * is the `max-block-size` the design gives it: a text of automatic height is as tall as its lines,
 * and comparing it with itself would read the ink of a tall face (Anton, a script) as overflow.
 */
const overflows = (text: HTMLElement, size: number): boolean => {
  const ceiling = parseFloat(getComputedStyle(text).maxHeight)
  const limit = Number.isFinite(ceiling) ? ceiling : text.clientHeight
  // 14 % of the size, but never more than a pixel and a half: on a card drawn big (the invitation's
  // own screen) 14 % is several pixels of a last line cut by the box, which is not ink but text.
  const tolerance = Math.max(1, Math.min(size * 0.14, MAX_TOLERANCE_PX))
  return text.scrollHeight > limit + tolerance || text.scrollWidth > text.clientWidth + 1
}

const shrink = (text: HTMLElement, cardWidth: number, floor: number): number => {
  let size = parseFloat(getComputedStyle(text).fontSize)
  for (let step = 0; step < MAX_STEPS && overflows(text, size); step++) {
    // A text with a legibility floor never goes under it: what does not fit is clipped below.
    if (floor > 0 && ((size * STEP) / cardWidth) * 100 < floor) break
    size *= STEP
    text.style.fontSize = `${((size / cardWidth) * 100).toFixed(3)}cqw`
  }
  return (size / cardWidth) * 100
}

/**
 * Keeps the first lines that fit the box and ends them with an ellipsis, for a text that is still
 * too long at its legibility floor: the reader sees a shortened text, never a smaller one.
 */
const clamp = (text: HTMLElement): void => {
  // Lines are only counted in a text of its own: a block of several paragraphs is sized, not clamped.
  if (text.children.length > 0) return
  const style = getComputedStyle(text)
  const ceiling = parseFloat(style.maxHeight)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
  if (!Number.isFinite(ceiling) || lineHeight <= 0) return
  const lines = Math.max(1, Math.floor(ceiling / lineHeight))
  text.style.display = '-webkit-box'
  text.style.setProperty('-webkit-box-orient', 'vertical')
  text.style.setProperty('-webkit-line-clamp', String(lines))
  text.style.overflow = 'hidden'
  text.dataset['clamped'] = ''
}

const fit = (text: HTMLElement, cardWidth: number): void => {
  text.style.fontSize = ''
  text.style.whiteSpace = ''
  text.style.display = ''
  text.style.overflow = ''
  delete text.dataset['clamped']
  text.style.removeProperty('-webkit-box-orient')
  text.style.removeProperty('-webkit-line-clamp')
  const legible = Number(text.dataset['fitFloor'])
  const floorCqw = Number.isFinite(legible) && legible > 0 ? legible : 0
  const found = shrink(text, cardWidth, floorCqw)
  const floor = Number(text.dataset['fitMin'])
  if (Number.isFinite(floor) && floor > 0 && found < floor) {
    text.style.fontSize = ''
    text.style.whiteSpace = 'normal'
    shrink(text, cardWidth, floorCqw)
  }
  if (floorCqw > 0 && overflows(text, parseFloat(getComputedStyle(text).fontSize))) clamp(text)
}
