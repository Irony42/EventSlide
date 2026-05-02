import { useEffect, useState } from 'react'
import { getPictures } from '../api/pictures'
import { Picture } from '../types'
import { useQueryParam } from './useQueryParam'

export const useAcceptedPictures = () => {
  const [pictures, setPictures] = useState<Picture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const partyParam = useQueryParam('partyname') || 'myParty'

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

    // Connect to Server-Sent Events for real-time updates
    const eventSource = new EventSource(`/api/stream?partyname=${partyParam}`)
    eventSource.onmessage = (event) => {
      if (event.data === 'update') {
        load()
      }
    }

    eventSource.onerror = () => {
      console.error('SSE connection lost, reconnecting...')
    }

    return () => {
      mounted = false
      eventSource.close()
    }
  }, [partyParam])

  return { pictures, loading, error }
}
