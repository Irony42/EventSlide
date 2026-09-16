/**
 * How long a recording runs, read from the container's header by the browser itself.
 *
 * The one thing on the guest surface that genuinely needs a `<video>` element, which is
 * why it is a module of its own and injected into the hook: jsdom has no media pipeline,
 * so a hook that constructed this inline could not be tested at ring 5 at all. The same
 * arrangement `downscaleImage` has, for the same reason.
 *
 * It **never rejects**. Every failure — an unreadable container, a codec this platform
 * does not have, a browser that simply never fires the event — resolves to `null`, which
 * the caller reads as "this phone cannot tell" and not as a refusal. Losing a guest's
 * clip because our own metadata read failed would be the worst possible trade for a check
 * whose entire purpose is to save them an upload.
 */

/**
 * How long to wait for the metadata before giving up on it.
 *
 * Short on purpose. The guest has just tapped a control and is waiting to press
 * "Envoyer"; a browser that has not answered in this long is one that is not going to,
 * and the cost of moving on is a round trip the server was going to make anyway.
 */
const PROBE_TIMEOUT_MS = 4_000

export const probeClipDuration = (file: File): Promise<number | null> =>
  new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (durationMs: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Revoked on every exit path. Thirty recordings picked over an evening is thirty
      // object URLs pinned for the life of the tab otherwise, each one holding the whole
      // file — which on this surface is measured in tens of megabytes.
      URL.revokeObjectURL(url)
      // Dropped as well as revoked: a `<video>` still pointing at a source keeps the
      // platform's decoder attached to it.
      video.removeAttribute('src')
      video.load()
      resolve(durationMs)
    }

    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)

    video.addEventListener(
      'loadedmetadata',
      () => {
        const seconds = video.duration
        // `Infinity` is what a browser reports for a stream whose header was never
        // finalised — a phone that ran out of battery mid-record — and `NaN` for one it
        // opened but could not measure. Both are "cannot tell", and the server says so
        // properly with `clip.durationUnknown`.
        finish(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null)
      },
      { once: true },
    )
    video.addEventListener('error', () => finish(null), { once: true })

    // `metadata` rather than `auto`: the header is all this needs, and asking for the
    // whole file would decode eighty megabytes on a phone to answer a question about its
    // first few hundred bytes.
    video.preload = 'metadata'
    video.src = url
  })
