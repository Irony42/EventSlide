import express, { Request, Response } from 'express'
import passport from 'passport'
import LocalStrategy from 'passport-local'
import bcrypt from 'bcrypt'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { log } from './log'
import { AddressInfo } from 'net'

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

const users: User[] = [
  {
    username: 'admin',
    password: '$2b$10$aRdMnDQSg/DeFoJNHj7HoupkHwQw8OE5WcxVONnICyy9FBK0eMcfe', // Hashed password: "password"
  },
]

// Passport configuration
passport.use(
  new LocalStrategy.Strategy((username: string, password: string, done: any) => {
    const user = users.find(user => user.username === username)
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
// TODO need check
passport.serializeUser((user, done) => done(null, user))

passport.deserializeUser((user: User, done) => {
  const loggedUser = users.find(usr => usr.username === user.username)
  done(null, loggedUser)
})

// Login route
app.post('/login', passport.authenticate('local', { failureRedirect: '/login-failure' }), (req: Request, res: Response) => {
  res.redirect('/protected-route')
})

app.get('/protected-route', (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    res.send('You are authenticated!')
  } else {
    res.redirect('/login')
  }
})

const server = app.listen(4300, () => log.debug(`Listening on port ${(server.address() as AddressInfo).port}`))
