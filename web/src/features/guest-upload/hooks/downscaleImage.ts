/**
 * Shrinking a phone photo before it is uploaded.
 *
 * A photo off a current phone is 4-12 MB, and the largest variant the server keeps is
 * 2560 px on its longest edge, so sending the original spends most of a guest's upload
 * time on bytes that are thrown away on arrival. On a congested venue Wi-Fi that is
 * the difference between a photo that arrives and a guest who gives up.
 *
 * Every failure path returns the original file. Losing a photo to a codec quirk would
 * be a far worse outcome than a slow upload, and the server re-encodes anyway.
 */

/** The display variant's longest edge, from docs/API.md section 4. */
const MAX_EDGE = 2560

/**
 * JPEG quality. High enough that a re-encode is invisible on a projector, low enough
 * that the file is a fraction of the original.
 */
const QUALITY = 0.85

/**
 * Below this, re-encoding costs more than it saves and can make the file larger.
 * A 1.5 MB photo already uploads in a couple of seconds on a bad connection.
 */
const SKIP_BELOW_BYTES = 1_500_000

const toJpegBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  })

const jpegName = (name: string): string => {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return `${stem}.jpg`
}

export const downscaleImage = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/') || file.size <= SKIP_BELOW_BYTES) return file

  // `createImageBitmap` decodes off the main thread and, unlike an <img>, reports a
  // decode failure instead of hanging on a photo the browser cannot read. Without it
  // there is no safe way to decode here, so the original goes up as it is.
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  try {
    const scale = MAX_EDGE / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)

    const context = canvas.getContext('2d')
    if (context === null) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await toJpegBlob(canvas)
    // A re-encode that came out larger is a re-encode worth discarding.
    if (blob === null || blob.size >= file.size) return file

    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    // The decoded bitmap is a full-resolution surface — 48 MB for a 12 MP photo — and
    // a guest sending thirty of them would hold all thirty until GC noticed.
    bitmap.close()
  }
}
