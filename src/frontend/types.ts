export type PictureStatus = 'accepted' | 'rejected'

export interface Picture {
  fileName: string
  status: PictureStatus
}

export interface PicturesResponse {
  pictures: Picture[]
}
