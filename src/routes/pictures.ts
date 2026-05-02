import { Request, Response } from 'express'
import { ModeratedPicture, ModeratedPictures } from '../models'
import { db } from '../database'
import path from 'path'
import fs from 'fs'
import archiver from 'archiver'
import sharp from 'sharp'
import { parsePartyName } from '../pictureStorage'
import { EventEmitter } from 'events'

// EventEmitter for Server-Sent Events (SSE)
export const picturesEmitter = new EventEmitter()

const isApiRequest = (req: Request) => req.path.startsWith('/api/')
const pictureStatusValues = new Set(['accepted', 'rejected', 'pending'])
const fileNamePattern = /^[a-zA-Z0-9._-]{1,255}$/

const sendError = (req: Request, res: Response, status: number, message: string) => {
  if (isApiRequest(req)) return res.status(status).json({ success: false, message })
  return res.status(status).send(message)
}

const parsePictureStatus = (rawStatus: unknown): ModeratedPicture['status'] | null => {
  if (typeof rawStatus !== 'string' || !pictureStatusValues.has(rawStatus)) return null
  return rawStatus as ModeratedPicture['status']
}

const parseFileName = (rawFileName: unknown): string | null => {
  if (typeof rawFileName !== 'string') return null
  if (!fileNamePattern.test(rawFileName)) return null
  return rawFileName
}

export const uploadPic = async (req: Request, res: Response) => {
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return sendError(req, res, 400, 'No photo sent!')
  }

  const partyName = parsePartyName(req.query.partyname)
  if (!partyName) return sendError(req, res, 400, 'Invalid partyname query param.')

  const photosDatas: ModeratedPicture[] = (req.files as any).map((f: { filename: any }) => ({
    fileName: f.filename,
    status: 'pending' // Default to pending
  }))

  try {
    const query = 'INSERT INTO photos (fileName, status, partyId) VALUES (?, ?, ?)'
    await Promise.all(
      photosDatas.map(async (photoData) => {
        await db.run(query, [photoData.fileName, photoData.status, partyName])

        const originalPath = path.resolve(__dirname, '..', '..', `photos/${partyName}/${photoData.fileName}`)
        const tempPath = path.resolve(__dirname, '..', '..', `photos/${partyName}/temp_${photoData.fileName}`)
        const thumbnailPath = path.resolve(__dirname, '..', '..', `thumbnails/${partyName}/${photoData.fileName}`)
        
        // Compress the original image
        if (fs.existsSync(originalPath)) {
          await sharp(originalPath)
            .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 }) // Compress
            .toFile(tempPath)
          
          // Replace original with compressed version
          fs.renameSync(tempPath, originalPath)

          // Generate thumbnail
          if (!fs.existsSync(thumbnailPath)) {
            await sharp(originalPath)
              .resize({ width: 500, height: 500, fit: 'inside', withoutEnlargement: true })
              .toFile(thumbnailPath)
          }
        }
      })
    )
    picturesEmitter.emit('update', partyName)
  } catch (error) {
    console.error('Error while uploading picture:', error)
    return sendError(req, res, 500, 'Error while uploading picture.')
  }

  if (isApiRequest(req)) return res.json({ success: true })
  res.redirect('/upload/confirmation')
}

const getPicture = (req: Request, res: Response, folderName: string) => {
  const fileName = parseFileName(req.params.filename)
  if (!fileName) {
    return sendError(req, res, 400, 'Invalid filename parameter.')
  }
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', '..', `${folderName}/${partyId}/${fileName}`)
  if (!fs.existsSync(imagePath)) {
    return sendError(req, res, 404, 'Photo not found.')
  }

  res.sendFile(imagePath)
}

export const getPic = (req: Request, res: Response) => {
  getPicture(req, res, 'photos')
}

export const getThumbnail = (req: Request, res: Response) => {
  getPicture(req, res, 'thumbnails')
}

export const getPics = async (req: Request, res: Response) => {
  const { partyId } = req.user as any
  const acceptedOnly = req.query.acceptedonly

  const query = acceptedOnly
    ? 'SELECT * FROM photos WHERE partyId = ? AND status = "accepted"'
    : 'SELECT * FROM photos WHERE partyId = ?'

  try {
    const rows = await db.all<ModeratedPicture[]>(query, [partyId])
    const partyPics: ModeratedPictures = { pictures: rows }
    res.json(partyPics)
  } catch (err) {
    console.error('Error while retrieving photo statuses:', err)
    return res.status(500).send('Error while retrieving photo statuses.')
  }
}

export const changePicsStatus = async (req: Request, res: Response) => {
  const targetFileName = parseFileName(req.body.filename ?? req.query.filename)
  const newStatus = parsePictureStatus(req.body.status ?? req.query.status)
  const { partyId } = req.user as any

  if (!targetFileName || !newStatus) {
    return sendError(req, res, 400, 'Invalid filename or status.')
  }

  const query = 'UPDATE photos SET status = ? WHERE fileName = ? AND partyId = ?'
  try {
    await db.run(query, [newStatus, targetFileName, partyId])
    picturesEmitter.emit('update', partyId)
    
    if (isApiRequest(req)) return res.json({ success: true })
    res.status(200).send('ok')
  } catch (err) {
    console.error('Error while updating photo status:', err)
    return sendError(req, res, 500, 'Error while updating photo status.')
  }
}

export const deletePic = async (req: Request, res: Response) => {
  const fileName = parseFileName(req.params.filename)
  if (!fileName) return sendError(req, res, 400, 'Invalid filename parameter.')
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', '..', `photos/${partyId}/${fileName}`)
  const thumbnailPath = path.resolve(__dirname, '..', '..', `thumbnails/${partyId}/${fileName}`)

  if (!fs.existsSync(imagePath)) {
    return sendError(req, res, 404, 'Photo not found.')
  }

  try {
    await fs.promises.unlink(imagePath)
    if (fs.existsSync(thumbnailPath)) {
      await fs.promises.unlink(thumbnailPath).catch((err) => {
        console.error('Error while deleting thumbnail:', err)
      })
    }

    const deleteQuery = 'DELETE FROM photos WHERE fileName = ? AND partyId = ?'
    await db.run(deleteQuery, [fileName, partyId])
    picturesEmitter.emit('update', partyId)
    
    if (isApiRequest(req)) return res.json({ success: true })
    res.status(200).send('Photo deleted successfully.')
  } catch (err) {
    console.error('Error while deleting photo:', err)
    return sendError(req, res, 500, 'Error while deleting photo.')
  }
}

export const downloadArchive = async (req: Request, res: Response) => {
  const { partyId } = req.user as any
  const zipFileName = `${partyId}_photos.zip`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename=${zipFileName}`)

  const output = res
  const archive = archiver('zip', {
    zlib: { level: 9 }
  })

  archive.on('error', (error) => {
    console.error('Archive generation error:', error)
    if (!res.headersSent) sendError(req, res, 500, 'Error while creating the zip file.')
  })

  archive.pipe(output)

  const query = 'SELECT fileName FROM photos WHERE partyId = ?'
  try {
    const rows = await db.all<{ fileName: string }[]>(query, [partyId])
    rows.forEach((row: any) => {
      const photoPath = path.resolve(__dirname, '..', '..', `photos/${partyId}/${row.fileName}`)
      if (fs.existsSync(photoPath)) {
        archive.file(photoPath, { name: row.fileName })
      }
    })
    archive.finalize()
  } catch (err) {
    console.error('Error while retrieving photo filenames:', err)
    return res.status(500).send('Error while creating the zip file.')
  }
}
