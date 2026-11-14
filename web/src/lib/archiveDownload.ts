/**
 * Starting a host export (`album.zip`, `best-of.zip`) without ever holding the archive.
 *
 * The ZIP is streamed and can be hundreds of megabytes, so the bytes always go through the
 * browser's own download manager, never through JavaScript. What JavaScript may do is ask first,
 * with a `HEAD`: the server answers it `204` when the `GET` would start and with the `GET`'s own
 * refusal otherwise (`429 rate.limited`, `503 service.notReady`, both with `Retry-After`), taking
 * no export slot and building nothing. A refusal becomes a sentence instead of a JSON file the
 * browser would show or save.
 *
 * **Check-then-act**: a slot can be taken between the `HEAD` and the download that follows, and that
 * download is then refused as it was before this existed. The answer is a courtesy, not a promise.
 */

export type ArchiveRefusal =
  | { readonly reason: 'busy'; readonly retryAfterSeconds: number | null }
  | { readonly reason: 'notReady'; readonly retryAfterSeconds: number | null }
  | { readonly reason: 'failed'; readonly retryAfterSeconds: null }

const retryAfterOf = (response: Response): number | null => {
  const raw = response.headers.get('Retry-After')
  if (raw === null || !/^\d{1,6}$/u.test(raw.trim())) return null
  const seconds = Number(raw)
  return seconds > 0 ? seconds : null
}

/**
 * `null` when the server will send the archive (or could not be asked at all, a network error: the browser then tries
 * for itself, as it always did); a refusal otherwise.
 */
export const probeArchive = async (url: string): Promise<ArchiveRefusal | null> => {
  try {
    const response = await fetch(url, { method: 'HEAD', credentials: 'same-origin' })
    if (response.ok) return null
    if (response.status === 429)
      return { reason: 'busy', retryAfterSeconds: retryAfterOf(response) }
    if (response.status === 503) {
      return { reason: 'notReady', retryAfterSeconds: retryAfterOf(response) }
    }
    return { reason: 'failed', retryAfterSeconds: null }
  } catch {
    return null
  }
}

/** The browser's own download, as the link would have started it. */
export const startDownload = (url: string): void => {
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
