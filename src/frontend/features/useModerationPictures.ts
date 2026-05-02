import { useEffect, useState } from 'react'
import { changePictureStatus, deletePicture, getPictures } from '../api/pictures'
import { Picture, PictureStatus } from '../types'

export const useModerationPictures = () => {
  const [pictures, setPictures] = useState<Picture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPictures = async () => {
    try {
      const response = await getPictures(false)
      setPictures(response.pictures)
      setError(null)
    } catch {
      setError('Impossible de charger les photos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPictures()

    // Assuming moderation is for the user's party, we just subscribe without partyname
    // which will default to their session partyId in the backend.
    const eventSource = new EventSource('/api/stream')
    eventSource.onmessage = (event) => {
      if (event.data === 'update') {
        loadPictures()
      }
    }

    eventSource.onerror = () => {
      console.error('SSE connection lost, reconnecting...')
    }

    return () => {
      eventSource.close()
    }
  }, [])

  const toggleStatus = async (fileName: string, currentStatus: PictureStatus) => {
    const nextStatus: PictureStatus = currentStatus === 'accepted' ? 'rejected' : 'accepted'
    try {
      await changePictureStatus(fileName, nextStatus)
      // The SSE will trigger a reload, but we can do it optimistically as well:
      setPictures((prev) =>
        prev.map((picture) =>
          picture.fileName === fileName ? { ...picture, status: nextStatus } : picture
        )
      )
      setError(null)
    } catch {
      setError("Impossible de mettre à jour le statut de l'image.")
    }
  }

  const removePicture = async (fileName: string) => {
    try {
      await deletePicture(fileName)
      setPictures((prev) => prev.filter((picture) => picture.fileName !== fileName))
      setError(null)
    } catch {
      setError("Impossible de supprimer l'image.")
    }
  }

  return { pictures, loading, error, toggleStatus, removePicture, reload: loadPictures }
}
