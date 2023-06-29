export interface User {
  username: string
  password: string
  partyId: string
}

export interface ModeratedPicture {
  fileName: string
  status: string
}

export interface ModeratedPictures {
  pictures: ModeratedPicture[]
}