import { Request, Response } from 'express'
import { ModeratedPicture, ModeratedPictures } from '../models'
import { db } from '../database'
import path from 'path'
import fs from 'fs'
import archiver from 'archiver'

export const uploadPic =  (req: Request, res: Response) => {
  if (!req.files) return res.status(400).send('No photo sent !')

  const partyName = req.query.partyname as string
  if (!partyName) return res.status(400).send('Missing partyname query param.')

  const photosDatas: ModeratedPicture[] = (req.files as any).map((f: { filename: any }) => ({
    fileName: f.filename,
    status: 'accepted' // Need to have a default value per party for status
  }))

  const query = 'INSERT INTO photos (fileName, status, partyId) VALUES (?, ?, ?)'
  photosDatas.forEach((photoData) => {
    db.run(query, [photoData.fileName, photoData.status, partyName], (err) => {
      if (err) {
        console.error('Error while saving photo to the database:', err)
        return res.status(500).send('Error while uploading picture.')
      }
    })
  })

  res.redirect('../uploadConfirmation.html')
}

export const getPic = (req: Request, res: Response) => {
  const fileName = req.params.filename
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', '..', `photos/${partyId}/${fileName}`)

  res.sendFile(imagePath)
}

export const getPics = (req: Request, res: Response) => {
  const { partyId } = req.user as any
  const acceptedOnly = req.query.acceptedonly

  const query = acceptedOnly
    ? 'SELECT * FROM photos WHERE partyId = ? AND status = "accepted"'
    : 'SELECT * FROM photos WHERE partyId = ?'

  db.all(query, [partyId], (err, rows: ModeratedPicture[]) => {
    if (err) {
      console.error('Error while retrieving photo statuses:', err)
      return res.status(500).send('Error while retrieving photo statuses.')
    }

    const partyPics: ModeratedPictures = { pictures: rows }
    res.json(partyPics)
  })
}

export const changePicsStatus = (req: Request, res: Response) => {
  const targetFileName = req.query.filename as string
  const newStatus = req.query.status as 'accepted' | 'rejected'
  const { partyId } = req.user as any

  if (!targetFileName || !newStatus) {
    res.status(500).send('Missing filename or status query param')
    return
  }

  const query = 'UPDATE photos SET status = ? WHERE fileName = ? AND partyId = ?'
  db.run(query, [newStatus, targetFileName, partyId], (err) => {
    if (err) {
      console.error('Error while updating photo status:', err)
      res.status(500).send('Error while updating photo status.')
      return
    }
    res.status(200).send('ok')
  })
}

export const deletePic = (req: Request, res: Response) => {
  //TODO DELETE thumbnails
  const fileName = req.params.filename
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', '..', `photos/${partyId}/${fileName}`)

  if (!fs.existsSync(imagePath)) {
    return res.status(404).send('Photo not found.')
  }

  fs.unlink(imagePath, (err) => {
    if (err) {
      console.error('Error while deleting photo:', err)
      return res.status(500).send('Error while deleting photo.')
    }

    const deleteQuery = 'DELETE FROM photos WHERE fileName = ? AND partyId = ?'
    db.run(deleteQuery, [fileName, partyId], (err) => {
      if (err) {
        console.error('Error while deleting photo from database:', err)
        return res.status(500).send('Error while deleting photo from database.')
      }
      res.status(200).send('Photo deleted successfully.')
    })
  })
}

export const downloadArchive = (req: Request, res: Response) => {
  const { partyId } = req.user as any
  const zipFileName = `${partyId}_photos.zip`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename=${zipFileName}`)

  const output = res
  const archive = archiver('zip', {
    zlib: { level: 9 }
  })

  archive.pipe(output)

  const query = 'SELECT fileName FROM photos WHERE partyId = ?'
  db.all(query, [partyId], (err, rows: { fileName: string }[]) => {
    if (err) {
      console.error('Error while retrieving photo filenames:', err)
      return res.status(500).send('Error while creating the zip file.')
    }
    rows.forEach((row) => {
      const photoPath = path.resolve(__dirname, '..', '..', `photos/${partyId}/${row.fileName}`)
      archive.file(photoPath, { name: row.fileName })
    })

    archive.finalize()
  })
}
