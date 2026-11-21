export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Where a picture of the given natural size is drawn so that it **covers** a frame and keeps at
 * `focusX` / `focusY` percent of what overflows on each side: `object-fit: cover` with
 * `object-position: focusX% focusY%`, as a box in the frame's own units. For a picture an SVG has
 * to place itself (an `<image>` knows three places, start, middle and end, and no other).
 *
 * A picture with no size yet is drawn at the frame, to be cut by the clip.
 */
export const coverRect = (
  natural: { readonly width: number; readonly height: number } | null,
  frame: Box,
  focusX: number,
  focusY: number,
): Box => {
  if (natural === null || natural.width <= 0 || natural.height <= 0) return frame
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height)
  const width = natural.width * scale
  const height = natural.height * scale
  return {
    x: frame.x + ((frame.width - width) * focusX) / 100,
    y: frame.y + ((frame.height - height) * focusY) / 100,
    width,
    height,
  }
}
