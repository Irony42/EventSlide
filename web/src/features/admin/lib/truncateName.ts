/**
 * A guest's first name, cut for display.
 *
 * The write path keeps 40 characters, but the boundary accepts up to 120, so a page that names
 * guests cannot trust the length. Cut on code points, not UTF-16 units, so an emoji is never
 * sliced in half; the full name stays in the element's `title`.
 */
export const DISPLAY_NAME_LIMIT = 40

export const truncateName = (name: string, limit: number = DISPLAY_NAME_LIMIT): string => {
  const points = [...name]
  return points.length <= limit ? name : `${points.slice(0, limit).join('')}…`
}
