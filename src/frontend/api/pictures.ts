import { apiClient } from './client'
import { PicturesResponse, PictureStatus } from '../types'

export const getPictures = (acceptedOnly = false) =>
  apiClient.get<PicturesResponse>(`/api/admin/getpics${acceptedOnly ? '?acceptedonly=true' : ''}`)

export const changePictureStatus = (filename: string, status: PictureStatus) =>
  apiClient.get<{ success: boolean }>(
    `/api/admin/changepicstatus?filename=${encodeURIComponent(filename)}&status=${status}`
  )

export const deletePicture = (filename: string) =>
  apiClient.del<{ success: boolean }>(`/api/admin/deletepic/${encodeURIComponent(filename)}`)
