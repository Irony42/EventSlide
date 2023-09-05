import express, { NextFunction, Request, Response } from 'express'
import passport from 'passport'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { AddressInfo } from 'net'
import * as fs from 'fs'
import * as https from 'https'
import { initDatabase } from './database'
import { initPassport } from './passport'
import { changePicsStatus, deletePic, downloadArchive, getPic, getPics, getThumbnail, uploadPic } from './routes/pictures'
import { changerUserPassword, registerUser } from './routes/user'
import { upload } from './pictureStorage'

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

// Pictures routes (public)
app.post('/upload', upload.array('photos', 50), uploadPic)

// Pictures routes (private)
app.get('/admin/getpic/:filename', isAuthenticated, getPic)
app.get('/admin/getthumbnail/:filename', isAuthenticated, getThumbnail)
app.get('/admin/getpics', isAuthenticated, getPics)
app.get('/admin/changepicstatus', isAuthenticated, changePicsStatus)
app.get('/admin/downloadzip', isAuthenticated, downloadArchive)
app.delete('/admin/deletepic/:filename', isAuthenticated, deletePic)

// User routes
app.post('/register', isAuthenticated, registerUser)
app.post('/passwordChange', isAuthenticated, changerUserPassword)

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
