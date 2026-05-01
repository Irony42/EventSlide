import { useEffect, useState } from 'react'
import { getPictures } from '../api/pictures'
import { Picture } from '../types'

export const useAcceptedPicturesPolling = (refreshMs: number) => {
  const [pictures, setPictures] = useState<Picture[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        const response = await getPictures(true)
        if (mounted) setPictures(response.pictures)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    const interval = window.setInterval(load, refreshMs)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [refreshMs])

  return { pictures, loading }
}
