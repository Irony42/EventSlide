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
import * as https from 'https'
import sqlite3 from 'sqlite3'

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

const db = new sqlite3.Database('database/database.sqlite')

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    partyId TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Error creating users table:', err)
  } else {
    console.log('Users table created successfully.')
  }
})

process.on('exit', () => {
  db.close();
});

// Passport configuration
passport.use(
  new LocalStrategy.Strategy((username: string, password: string, done: any) => {
    const query = 'SELECT * FROM users WHERE username = ?'
    db.get(query, [username], (err, row: User) => {
      if (err) {
        return done(err)
      }
      if (!row) {
        return done(null, false, { message: 'Incorrect username.' })
      }
      bcrypt.compare(password, row.password, (err, result) => {
        if (err) {
          return done(err)
        }
        if (!result) {
          return done(null, false, { message: 'Incorrect password.' })
        }
        return done(null, row)
      });
    });
  })
);

passport.serializeUser((user: any, done) => done(null, user.id))

passport.deserializeUser((id, done) => {
  const query = 'SELECT * FROM users WHERE id = ?'
  db.get(query, [id], (err, row) => {
    done(err, row as String)
  });
});

const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) return next()
  res.redirect('/login.html')
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

  const partyName = req.query.partyname as string //TODO use party from user not from request
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
  const partyName = req.params.partyname //TODO check partyName from user, not from param
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

// Create new user
app.post('/register', isAuthenticated, (req: Request, res: Response) => {
  const { username, password } = req.body
  const { partyId } = req.user as any
  
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      console.error("Error while registering new user :", err)
      return res.status(500).send('Error while hashing the password.')
    }
    const query = 'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)'
    db.run(query, [username, hash, partyId], (err) => {
      if (err) {
        console.log("Error while registering new user (database) : ", err)
        return res.redirect('/newUser.html?userCreationFailed=true')
      }
      console.log("Registered new user : ", username)
      res.redirect('/newUser.html?userCreationFailed=false')
    })
  })
})

// Uncomment for production
const options = {
  key: fs.readFileSync('ssl/key.pem'),
  cert: fs.readFileSync('ssl/cert.pem')
};
const server = https.createServer(options, app)
server.listen(443, () => { console.log("HTTPS server online.")})

// Uncomment for dev
// const server = app.listen(4300, () => console.debug(`Listening on port ${(server.address() as AddressInfo).port}`))
