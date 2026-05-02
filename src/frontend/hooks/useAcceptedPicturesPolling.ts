import { useEffect, useState } from 'react'
import { getPictures } from '../api/pictures'
import { Picture } from '../types'

export const useAcceptedPicturesPolling = (refreshMs: number) => {
  const [pictures, setPictures] = useState<Picture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        const response = await getPictures(true)
        if (mounted) {
          setPictures(response.pictures)
          setError(null)
        }
      } catch {
        if (mounted) setError('Impossible de récupérer les images pour le diaporama.')
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

  return { pictures, loading, error }
}
