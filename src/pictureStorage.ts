import fs from 'fs'
import multer, { Multer } from 'multer'

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const partyName = req.query.partyname
    if (!partyName) cb(Error('No partyname provided'), '')

    const photoFolder = `photos/${partyName}`
    if (!fs.existsSync(photoFolder)) fs.mkdirSync(photoFolder, { recursive: true })

    const thumbnailsFolder = `thumbnails/${partyName}`
    if (!fs.existsSync(thumbnailsFolder)) fs.mkdirSync(thumbnailsFolder, { recursive: true })

    cb(null, photoFolder)
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}_${file.originalname}`)
  }
})

const maxSize = 50 * 1024 * 1024 // 50 MB (in bytes)

const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error('Unsupported file type! Only images are allowed.'))
  }
}

export const upload: Multer = multer({
  storage: storage,
  fileFilter,
  limits: {
    fileSize: maxSize
  }
})
