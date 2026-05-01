import { useEffect, useMemo, useState } from 'react'
import { Picture } from '../types'
import { useSessionIndex } from '../hooks/useSessionIndex'

const storageKey = 'EventSlide_currentIndex'

export const useSlideshowController = (pictures: Picture[]) => {
  const { index, updateIndex, resetIndex } = useSessionIndex(storageKey)
  const [intervalMs, setIntervalMs] = useState(10000)
  const [tick, setTick] = useState(0)

  const currentImageUrl = useMemo(() => {
    if (pictures.length === 0) return '/default.jpg'
    const safeIndex = index % pictures.length
    return `/api/admin/getpic/${encodeURIComponent(pictures[safeIndex].fileName)}`
  }, [index, pictures])

  const nextImage = () => {
    if (pictures.length === 0) return
    const nextIndex = (index + 1) % pictures.length
    updateIndex(nextIndex)
  }

  useEffect(() => {
    const interval = window.setInterval(() => setTick((prev) => prev + 1), intervalMs)
    return () => window.clearInterval(interval)
  }, [intervalMs])

  useEffect(() => {
    if (tick > 0) nextImage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { currentImageUrl, nextImage, intervalMs, setIntervalMs, resetIndex }
}
