/**
 * The photograph a host puts on the printed card (spec 28). It never leaves the browser.
 *
 * A card is printed before the evening as often as during it, when the event has no photograph
 * yet, so the host brings one of their own. Sending it to the server would make it a stored
 * upload with everything that comes with one (quota, export, erasure), for an image only this
 * printer needs. So it is decoded here, scaled down and re-encoded through a canvas, which also
 * drops its EXIF (place, device), and kept in this browser's storage beside the other print
 * preferences. A moderator on another machine does not see it; the help text says so.
 */

/**
 * Long side of the stored image: about 230 dpi on the 13 cm of an A4 card's largest frame, and a
 * copy of 200 to 400 kB, so a few events' photographs stay well inside the browser's storage.
 */
export const PRINT_PHOTO_MAX_SIDE = 1200
/** JPEG quality of the stored copy. */
const QUALITY = 0.82

const keyFor = (slug: string): string => `eventslide.printPhoto.${slug}`

/** A `data:` URL as {@link preparePrintPhoto} writes it, and nothing else. */
export const isPrintPhotoUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)

/** The side lengths of the stored copy: the long side capped, the ratio kept, never enlarged. */
export const scaledSize = (width: number, height: number): { width: number; height: number } => {
  const ratio = Math.min(1, PRINT_PHOTO_MAX_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/**
 * Decodes the file (its orientation applied by `createImageBitmap`), draws it at
 * {@link scaledSize} and returns the JPEG. `null` when the browser cannot read it as an image.
 */
export const preparePrintPhoto = async (file: Blob): Promise<string | null> => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = scaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return null
    // JPEG has no transparency: what a PNG leaves see-through would turn black on paper.
    context.fillStyle = PAPER
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const url = canvas.toDataURL('image/jpeg', QUALITY)
    return isPrintPhotoUrl(url) ? url : null
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

/** The paper behind a transparent image: white, as the card. A canvas takes no CSS token. */
const PAPER = 'white'

export const readPrintPhoto = (slug: string): string | null => {
  try {
    const stored = window.localStorage.getItem(keyFor(slug))
    return isPrintPhotoUrl(stored) ? stored : null
  } catch {
    return null
  }
}

/**
 * Keeps the photograph for next time; when storage refuses (full, private), it lives for this
 * visit. `false` says it was **not** kept, so the page can tell the host.
 */
export const writePrintPhoto = (slug: string, url: string | null): boolean => {
  try {
    if (url === null) window.localStorage.removeItem(keyFor(slug))
    else window.localStorage.setItem(keyFor(slug), url)
    return true
  } catch {
    // Storage is a convenience; the page keeps the photograph in memory. What it held before must
    // not come back at the next visit in place of the one the host just chose.
    try {
      window.localStorage.removeItem(keyFor(slug))
    } catch {
      // Blocked storage holds nothing to come back.
    }
    return url === null
  }
}
