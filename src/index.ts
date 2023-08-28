import express, { NextFunction, Request, Response } from 'express'
import passport from 'passport'
import bcrypt from 'bcrypt'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { AddressInfo } from 'net'
import multer, { Multer } from 'multer'
import { User, ModeratedPictures, ModeratedPicture } from './models'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { db, initDatabase } from './database'
import { initPassport } from './passport'

// Initialization
const app = express()

app.use(bodyParser.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(
  session({
    secret: 'your-secret-key',
    resave: true,
    saveUninitialized: true
  })
)
app.use(passport.initialize())
app.use(passport.session())

app.use(express.static('public'))

initDatabase()
initPassport(passport)

const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) return next()
  res.redirect('/login.html')
}

const maxSize = 50 * 1024 * 1024 // 50 MB (in bytes)

const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error('Unsupported file type! Only images are allowed.'))
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const partyName = req.query.partyname
    if (!partyName) cb(Error('No partyname provided'), '')

    const photoFolder = `photos/${partyName}`
    if (!fs.existsSync(photoFolder)) fs.mkdirSync(photoFolder, { recursive: true })

    cb(null, photoFolder)
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}_${file.originalname}`)
  }
})

const upload: Multer = multer({
  storage: storage,
  fileFilter,
  limits: {
    fileSize: maxSize
  }
})

// Photo upload route
app.post('/upload', upload.array('photos', 50), (req: Request, res: Response) => {
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
})

// Login route
app.post(
  '/login',
  passport.authenticate('local', {
    failureRedirect: '/login.html?authenticationfailed=true'
  }),
  (req: Request, res: Response) => {
    res.redirect('/administration.html')
  }
)

// Get ONE photo route
app.get('/admin/getpic/:filename', isAuthenticated, (req: Request, res: Response) => {
  const fileName = req.params.filename
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', `photos/${partyId}/${fileName}`)

  res.sendFile(imagePath)
})

// Get photo list
app.get('/admin/getpics', isAuthenticated, (req: Request, res: Response) => {
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
})

app.get('/admin/changepicstatus', isAuthenticated, (req: Request, res: Response) => {
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
})

// Delete photo
app.delete('/admin/deletepic/:filename', isAuthenticated, (req: Request, res: Response) => {
  const fileName = req.params.filename
  const { partyId } = req.user as any
  const imagePath = path.resolve(__dirname, '..', `photos/${partyId}/${fileName}`)

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
})

// Create new user
app.post('/register', isAuthenticated, (req: Request, res: Response) => {
  const { username, password } = req.body
  const { partyId } = req.user as any

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      console.error('Error while registering new user :', err)
      return res.status(500).send('Error while hashing the password.')
    }
    const query = 'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)'
    db.run(query, [username, hash, partyId], (err) => {
      if (err) {
        console.log('Error while registering new user (database) : ', err)
        return res.redirect('/newUser.html?userCreationFailed=true')
      }
      console.log('Registered new user : ', username)
      res.redirect('/newUser.html?userCreationFailed=false')
    })
  })
})

// Change user password
app.post('/passwordChange', isAuthenticated, (req: Request, res: Response) => {
  const { password, newPassword, newPassword2 } = req.body
  const { username } = req.user as any

  if (newPassword !== newPassword2) {
    console.log('Password not changed, different new passwords.')
    return res.redirect('/passwordChange.html?passwordChange=true')
  }

  const query = 'SELECT * FROM users WHERE username = ?'
  db.get(query, [username], (err, user: User) => {
    if (err) {
      console.error('Error while fetching user data:', err)
      return res.redirect('/passwordChange.html?passwordChange=true')
    }

    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        console.error('Error while comparing passwords:', err)
        return res.redirect('/passwordChange.html?passwordChange=true')
      }

      if (!result) {
        console.log('Incorrect current password.')
        return res.redirect('/passwordChange.html?passwordChange=true')
      }

      bcrypt.hash(newPassword, 10, (err, hash) => {
        if (err) {
          console.error('Error while hashing new password:', err)
          return res.redirect('/passwordChange.html?passwordChange=true')
        }

        const updateQuery = 'UPDATE users SET password = ? WHERE username = ?'
        db.run(updateQuery, [hash, username], (err) => {
          if (err) {
            console.error('Error while updating password in the database:', err)
            return res.redirect('/passwordChange.html?passwordChange=true')
          }

          return res.redirect('/passwordChange.html?passwordChange=false')
        })
      })
    })
  })
})

// Uncomment for production
const options = {
  key: fs.readFileSync('ssl/key.pem'),
  cert: fs.readFileSync('ssl/cert.pem')
}
const server = https.createServer(options, app)
server.listen(443, () => {
  console.log('HTTPS server online.')
})

// Uncomment for dev
// const server = app.listen(4300, () => console.debug(`Listening on port ${(server.address() as AddressInfo).port}`))
