import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * The scale that fits something drawn at a true `width` (pixels) into the room its frame has:
 * what is shown is the real thing shrunk, never a redrawn copy. Follows the frame as it is resized.
 */
export const useFitScale = (width: number): readonly [RefObject<HTMLDivElement | null>, number] => {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  useLayoutEffect(() => {
    const element = frame.current
    if (element === null) return
    const measure = () => {
      const room = element.getBoundingClientRect().width
      if (room > 0) setScale(Math.min(1, room / width))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [width])
  return [frame, scale]
}
