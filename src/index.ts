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

// Login route
app.post(
  '/login',
  passport.authenticate('local', {
    failureRedirect: '/login.html?authenticationfailed=true',
  }),
  (req: Request, res: Response) => {
    res.redirect('/index.html') //TODO Administration page after login
  }
)

app.post(
  '/upload',
  upload.array('photos', 20),
  (req: Request, res: Response) => {
    if (!req.files) {
      res.status(400).send('No photo sent !')
      return
    }
    log.debug(
      'Files : ' + (req.files as any).map((f: { filename: any }) => f.filename)
    )
    res.redirect('uploadConfirmation.html')
  }
)

const server = app.listen(4300, () =>
  log.debug(`Listening on port ${(server.address() as AddressInfo).port}`)
)
