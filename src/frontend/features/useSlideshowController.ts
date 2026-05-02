import { useCallback, useEffect, useMemo, useState } from 'react'
import { Picture } from '../types'
import { useSessionIndex } from '../hooks/useSessionIndex'

const storageKey = 'EventSlide_currentIndex'

export const useSlideshowController = (pictures: Picture[]) => {
  const { index, updateIndex, resetIndex } = useSessionIndex(storageKey)
  const [intervalMs, setIntervalMs] = useState(10000)

  const currentImageUrl = useMemo(() => {
    if (pictures.length === 0) return '/default.jpg'
    const safeIndex = index % pictures.length
    return `/api/admin/getpic/${encodeURIComponent(pictures[safeIndex].fileName)}`
  }, [index, pictures])

  const nextImage = useCallback(() => {
    if (pictures.length === 0) return
    updateIndex((prev) => (prev + 1) % pictures.length)
  }, [pictures.length, updateIndex])

  useEffect(() => {
    const interval = window.setInterval(nextImage, intervalMs)
    return () => window.clearInterval(interval)
  }, [intervalMs, nextImage])

  return { currentImageUrl, nextImage, intervalMs, setIntervalMs, resetIndex }
}
