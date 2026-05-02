import { apiClient } from './client'
import { PicturesResponse, PictureStatus } from '../types'

export const getPictures = (acceptedOnly = false) =>
  apiClient.get<PicturesResponse>(`/api/admin/getpics${acceptedOnly ? '?acceptedonly=true' : ''}`)

export const changePictureStatus = (filename: string, status: PictureStatus) =>
  apiClient.patch<{ success: boolean }>('/api/admin/changepicstatus', {
    filename,
    status
  })

export const uploadPictures = (partyName: string, files: FileList) => {
  const formData = new FormData()
  Array.from(files).forEach((file) => formData.append('photos', file))
  return apiClient.postForm<{ success: boolean }>(
    `/api/upload?partyname=${encodeURIComponent(partyName)}`,
    formData
  )
}

export const deletePicture = (filename: string) =>
  apiClient.del<{ success: boolean }>(`/api/admin/deletepic/${encodeURIComponent(filename)}`)
