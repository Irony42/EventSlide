import express, { NextFunction, Request, Response } from 'express'
import passport from 'passport'
import LocalStrategy from 'passport-local'
import bcrypt from 'bcrypt'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { AddressInfo } from 'net'
import multer, { Multer } from 'multer'
import { User, ModeratedPictures, ModeratedPicture } from './models'
import * as path from 'path'
import * as fs from 'fs'

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

const users: User[] = [
  {
    username: 'admin',
    password: '$2b$10$aRdMnDQSg/DeFoJNHj7HoupkHwQw8OE5WcxVONnICyy9FBK0eMcfe', // Hashed password: "password"
    partyId: 'myParty'
  }
]

// Passport configuration
passport.use(
  new LocalStrategy.Strategy((username: string, password: string, done: any) => {
    const user = users.find((user) => user.username === username)
    if (!user) {
      return done(null, false, { message: 'Incorrect username.' })
    }
    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        return done(err)
      }
      if (!result) {
        return done(null, false, { message: 'Incorrect password.' })
      }
      return done(null, user)
    })
  })
)

passport.serializeUser((user, done) => done(null, user))

passport.deserializeUser((user: User, done) => {
  const loggedUser = users.find((usr) => usr.username === user.username)
  done(null, loggedUser)
})

const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) return next()
  res.redirect('/login')
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

const upload: Multer = multer({ storage: storage })

// Photo upload route
app.post('/upload', upload.array('photos', 20), (req: Request, res: Response) => {
  if (!req.files) return res.status(400).send('No photo sent !')

  const partyName = req.query.partyname as string
  if (!partyName) return res.status(400).send('Missing partyname query param.')

  const photosDatas: ModeratedPicture[] = (req.files as any).map((f: { filename: any }) => ({
    fileName: f.filename,
    status: 'accepted' // Need to have a default value per party for status
  }))
  const statusFileName = `statusfiles/${partyName}.json`

  fs.readFile(statusFileName, (err, data) => {
    if (err) {
      if (err.code != 'ENOENT') {
        console.error('Error while reading party file :', err)
        res.status(500).send('Error while trying to retrieve your party.')
        return
      }
      fs.writeFileSync(statusFileName, '')
    }
    const existingPhotosDatas: ModeratedPictures = data ? JSON.parse(data.toString()) : { pictures: [] }
    existingPhotosDatas.pictures.push(...photosDatas)
    const datas = JSON.stringify(existingPhotosDatas)

    fs.writeFile(statusFileName, datas, (err) => {
      if (err) {
        console.error('Error while saving party :', err)
        res.status(500).send('Error while saving the pictures status.')
        return
      }
      res.redirect('../uploadConfirmation.html')
    })
  })
})

// Login route
app.post(
  '/login',
  passport.authenticate('local', {
    failureRedirect: '/login.html?authenticationfailed=true'
  }),
  (req: Request, res: Response) => {
    res.redirect(`/administration.html?partyname=${(req.user as User | undefined)?.partyId}`)
  }
)

// Get ONE photo route
app.get('/admin/getpic/:partyname/:filename', isAuthenticated, (req: Request, res: Response) => {
  const fileName = req.params.filename
  const partyName = req.params.partyname
  const imagePath = path.resolve(__dirname, '..', `photos/${partyName}/${fileName}`)

  res.sendFile(imagePath)
})

// Get photo list
app.get('/admin/getpics/:partyname', isAuthenticated, (req: Request, res: Response) => {
  const partyName = req.params.partyname
  const acceptedOnly = req.query.acceptedonly

  const partyFile = fs.readFileSync(path.resolve(__dirname, '..', 'statusfiles', `${partyName}.json`)).toString()

  const partyPics: ModeratedPictures = JSON.parse(partyFile)

  const filteredPartyPics: ModeratedPictures =
    acceptedOnly && partyPics.pictures
      ? { pictures: partyPics.pictures.filter((picture) => picture.status === 'accepted') }
      : partyPics

  res.json(filteredPartyPics)
})

app.get('/admin/changepicstatus', isAuthenticated, (req: Request, res: Response) => {
  const targetFileName = req.query.filename as string
  const newStatus = req.query.status as 'accepted' | 'rejected'
  const partyName = req.query.partyname as string

  if (!targetFileName || !newStatus) {
    res.status(500).send('Missing filename or status query param')
    return
  }

  fs.readFile(`statusfiles/${partyName}.json`, (err, data) => {
    if (err) {
      console.error('Error while reading party file :', err)
      res.status(500).send('Error while trying to retrieve your party.')
      return
    }
    
    const photosDatas = JSON.parse(data.toString())
    const pictureToChange: ModeratedPicture = photosDatas.pictures.find((p: any) => p.fileName == targetFileName)
    
    if (pictureToChange) {
      pictureToChange.status = newStatus
    }

    const updatedData = JSON.stringify(photosDatas)

    fs.writeFile(`statusfiles/${partyName}.json`, updatedData, (err) => {
      if (err) {
        console.error('Error while saving party :', err)
        res.status(500).send('Error while saving the pictures status.')
        return
      }
      res.status(200).send('ok')
    })
  })
})

// Uncomment for production
// const options = {
//   key: fs.readFileSync('ssl/key.pem'),
//   cert: fs.readFileSync('ssl/cert.pem')
// };
// const server = https.createServer(options, app)
// server.listen(443, () => { console.log("HTTPS server online.")})

// Uncomment for dev
const server = app.listen(4300, () => console.debug(`Listening on port ${(server.address() as AddressInfo).port}`))
