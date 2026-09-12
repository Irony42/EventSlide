import { useEffect, useRef } from 'react'
import styles from './PhotoPreload.module.css'

export interface PhotoPreloadProps {
  /** The photo that comes next, or `null` when there is nothing to prepare. */
  readonly url: string | null
}

/**
 * The next photo, fetched and decoded while the current one is still on screen.
 *
 * A crossfade that starts before the incoming bytes have arrived shows a blank frame,
 * and on congested venue Wi-Fi that is most of them. A hidden `<img>` rather than a
 * bare `new Image()` so the element participates in the document's normal loading
 * priority, plus `decode()` so the paint work is done off the transition too.
 */
export function PhotoPreload({ url }: PhotoPreloadProps) {
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const image = ref.current
    if (image === null || url === null) return
    // Absent in jsdom, and it rejects when the fetch fails. Neither is fatal: the
    // slide then simply fades in as soon as the browser has the bytes.
    if (typeof image.decode !== 'function') return
    void image.decode().catch(() => undefined)
  }, [url])

  if (url === null) return null

  return (
    <img
      ref={ref}
      className={styles['preload']}
      src={url}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  )
}
