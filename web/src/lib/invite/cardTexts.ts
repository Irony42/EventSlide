/**
 * The two small texts a printed invitation card needs (spec 29), pure so each is tested without a
 * screen: the short word printed from the host's long one, and the link as it is read under the QR.
 */

/** What the card holds of the host's word: 140 characters, as a reader sees them. */
export const SHORT_MESSAGE_MAX = 140

const ELLIPSIS = '…'

/**
 * The start of the host's word, **cut at a whole word** to fit the card, with an ellipsis when it
 * was cut. Line breaks become spaces (the card sets it as one paragraph), and a word that is
 * short enough is returned as it is. Counted in code points, so an emoji is never cut in half.
 * `null` for no word.
 */
export const shortMessageOf = (message: string | null, max = SHORT_MESSAGE_MAX): string | null => {
  if (message === null) return null
  const flat = message.replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  const points = [...flat]
  if (points.length <= max) return flat

  // Room for the ellipsis, then back to the last space: the word that would be cut in two is dropped.
  const head = points.slice(0, max - 1)
  // The cut falls on a space already (the last word is complete), or inside a word, which is dropped.
  const space = points[max - 1] === ' ' ? head.length : head.lastIndexOf(' ')
  const whole = space > 0 ? head.slice(0, space) : head
  return `${whole.join('').replace(/[\s,;:.\-–—]+$/u, '')}${ELLIPSIS}`
}

/**
 * The link as a person reads it under the QR: host and path, with no scheme and no trailing slash
 * (`app.eventslide.fr/i/7QX0M4TZ2KD9WB3H`). A value that is not a URL is returned as it came.
 */
export const readableLink = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return url
  }
}
