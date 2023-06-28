import express, { NextFunction, Request, Response } from 'express'
import passport from 'passport'
import LocalStrategy from 'passport-local'
import bcrypt from 'bcrypt'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { log } from './log'
import { AddressInfo } from 'net'
import multer, { Multer } from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'

interface User {
  username: string
  password: string
}

const app = express()

app.use(bodyParser.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(
  session({
    secret: 'your-secret-key',
    resave: true,
    saveUninitialized: true,
  })
)
app.use(passport.initialize())
app.use(passport.session())

app.use(express.static('public'))

const users: User[] = [
  {
    username: 'admin',
    password: '$2b$10$aRdMnDQSg/DeFoJNHj7HoupkHwQw8OE5WcxVONnICyy9FBK0eMcfe', // Hashed password: "password"
  },
]

// Passport configuration
passport.use(
  new LocalStrategy.Strategy(
    (username: string, password: string, done: any) => {
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
    }
  )
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
    cb(null, 'photos/')
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  },
})

const upload: Multer = multer({ storage: storage })

// Photo upload route
app.post(
  '/upload',
  upload.array('photos', 20),
  (req: Request, res: Response) => {
    if (!req.files) {
      res.status(400).send('No photo sent !')
      return
    }
    const photosDatas: any = {}
    const partyName = req.hostname.substring(0, req.hostname.indexOf('.'))
    log.debug(
      'Files : ' + (req.files as any).map((f: { filename: any }) => f.filename)
    )

    photosDatas[partyName] = (req.files as any).map((f: { filename: any }) => ({ picPath: f.filename, status: "accepted" }))

    fs.appendFile(`${partyName}.json`, JSON.stringify(photosDatas), (err) => {
      if (err) {
        console.error(err)
        return
      }
    })
    res.redirect('uploadConfirmation.html')
  }
)

// Login route
app.post(
  '/login',
  passport.authenticate('local', {
    failureRedirect: '/login.html?authenticationfailed=true',
  }),
  (req: Request, res: Response) => {
    res.redirect('/administration.html')
  }
)

// Get ONE photo route
app.get(
  '/admin/getpic/:filename',
  isAuthenticated,
  (req: Request, res: Response) => {
    const fileName = req.params.filename
    const imagePath = path.resolve(__dirname, '..', `photos/${fileName}`)

    res.sendFile(imagePath)
  }
)

// Get photo list
app.get('/admin/getpics', isAuthenticated, (req: Request, res: Response) => {
  const uploadsPath = path.resolve(__dirname, '..', 'photos')

  fs.readdir(uploadsPath, (err, files) => {
    if (err) {
      console.error(err)
      res
        .status(500)
        .json({ error: 'Erreur lors de la lecture du dossier des images' })
      return
    }

    const imageList = files.map((file) => {
      return { filePath: file }
    })

    res.json({ images: imageList })
  })
})

app.get(
  'admin/changepicsstatus',
  isAuthenticated,
  (req: Request, res: Response) => {
    const targetFileName = req.params.filename
    const newStatus = req.params.status

    if (!targetFileName || !newStatus) {
      res.status(500).send('Missing filename or status query param')
      return
    }

    const partyName = req.hostname.substring(0, req.hostname.indexOf('.'))

    fs.readFile(`${partyName}.json`, (err, data) => {
      if (err) {
        console.error('Error while reading party file :', err)
        res.status(500).send('Error while trying to retrieve your party.')
        return
      }
      const photosDatas = JSON.parse(data.toString())
      photosDatas[targetFileName].fileData.status = newStatus

      const updatedData = JSON.stringify(photosDatas)
      
      fs.writeFile(`${partyName}.json`, updatedData, (err) => {
        if (err) {
          console.error('Error while saving party :', err)
          res.status(500).send('Error while saving the pictures status.')
          return
        }
      })
    })
  }
)

// Uncomment for production
const options = {
  key: fs.readFileSync('ssl/key.pem'),
  cert: fs.readFileSync('ssl/cert.pem')
};
const server = https.createServer(options, app)
server.listen(443, () => { console.log("HTTPS server online.")})

// Uncomment for dev
// const server = app.listen(4300, () =>
//   log.debug(`Listening on port ${(server.address() as AddressInfo).port}`)
// )
