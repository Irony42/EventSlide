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
  }, [])

  const toggleStatus = async (fileName: string, currentStatus: PictureStatus) => {
    const nextStatus: PictureStatus = currentStatus === 'accepted' ? 'rejected' : 'accepted'
    try {
      await changePictureStatus(fileName, nextStatus)
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
