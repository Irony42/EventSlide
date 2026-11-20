import { useLayoutEffect, type RefObject } from 'react'

/** Shrink factor per step, and the most steps taken: 0.94^40 is a twelfth of the size. */
const STEP = 0.94
const MAX_STEPS = 40

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
 * Script faces draw past their line box, so an overflow of under 14 % of the size is tolerated.
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
  return (
    text.scrollHeight > limit + Math.max(1, size * 0.14) || text.scrollWidth > text.clientWidth + 1
  )
}

const shrink = (text: HTMLElement, cardWidth: number): number => {
  let size = parseFloat(getComputedStyle(text).fontSize)
  for (let step = 0; step < MAX_STEPS && overflows(text, size); step++) {
    size *= STEP
    text.style.fontSize = `${((size / cardWidth) * 100).toFixed(3)}cqw`
  }
  return (size / cardWidth) * 100
}

const fit = (text: HTMLElement, cardWidth: number): void => {
  text.style.fontSize = ''
  text.style.whiteSpace = ''
  const found = shrink(text, cardWidth)
  const floor = Number(text.dataset['fitMin'])
  if (Number.isFinite(floor) && floor > 0 && found < floor) {
    text.style.fontSize = ''
    text.style.whiteSpace = 'normal'
    shrink(text, cardWidth)
  }
}
