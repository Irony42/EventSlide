import { useEffect, useState } from 'react'

export type ImageState = 'none' | 'loading' | 'ready' | 'failed'

/**
 * Whether the image at `url` is in the browser's cache, decoded or failed. The sheet draws the
 * logo inside an SVG, where nothing tells the page it arrived; printing before it did would put
 * an empty centre in a code encoded for a logo. `null` is "no image wanted".
 */
export function useImageReady(url: string | null): ImageState {
  const [settled, setSettled] = useState<{ url: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (url === null) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setSettled({ url, ok: true })
    }
    image.onerror = () => {
      if (!cancelled) setSettled({ url, ok: false })
    }
    image.src = url
    return () => {
      cancelled = true
    }
  }, [url])

  if (url === null) return 'none'
  if (settled === null || settled.url !== url) return 'loading'
  return settled.ok ? 'ready' : 'failed'
}
