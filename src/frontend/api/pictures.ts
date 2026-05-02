import { apiClient } from './client'
import { PicturesResponse, PictureStatus } from '../types'

export const getPictures = (acceptedOnly = false) =>
  apiClient.get<PicturesResponse>(`/api/admin/getpics${acceptedOnly ? '?acceptedonly=true' : ''}`)

export const changePictureStatus = (filename: string, status: PictureStatus) =>
  apiClient.patch<{ success: boolean }>('/api/admin/changepicstatus', {
    filename,
    status
  })

export const uploadPictures = (partyName: string, files: FileList, onProgress?: (percent: number) => void) => {
  return new Promise<{ success: boolean }>((resolve, reject) => {
    const formData = new FormData()
    Array.from(files).forEach((file) => formData.append('photos', file))

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/upload?partyname=${encodeURIComponent(partyName)}`)
    xhr.withCredentials = true

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100)
          onProgress(percentComplete)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response)
        } catch {
          resolve({ success: true })
        }
      } else {
        reject(new Error(xhr.responseText || 'Upload failed'))
      }
    }

    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(formData)
  })
}

export const deletePicture = (filename: string) =>
  apiClient.del<{ success: boolean }>(`/api/admin/deletepic/${encodeURIComponent(filename)}`)
