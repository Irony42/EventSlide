import express, { NextFunction, Request, Response } from 'express'
import passport from 'passport'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { AddressInfo } from 'net'
import path from 'path'
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
app.use(express.json())
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
app.use('/assets', express.static(path.resolve(__dirname, '..', 'dist', 'client', 'assets')))

initDatabase()
initPassport(passport)

const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) return next()
  res.redirect('/login')
}

const isAuthenticatedApi = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) return next()
  res.status(401).json({ success: false, message: 'Unauthorized' })
}

// Login route
app.post(
  '/login',
  passport.authenticate('local', {
    failureRedirect: '/login?authenticationfailed=true'
  }),
  (req: Request, res: Response) => {
    res.redirect('/admin')
  }
)

app.post('/api/login', (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('local', (err: Error, user: Express.User) => {
    if (err) return next(err)
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' })
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr)
      return res.json({ success: true })
    })
  })(req, res, next)
})

app.post('/api/logout', (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err)
    res.json({ success: true })
  })
})

app.get('/api/session', (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.json({ authenticated: false })
  const user = req.user as any
  return res.json({
    authenticated: true,
    user: { username: user?.username, partyId: user?.partyId }
  })
})

// Pictures routes (public)
app.post('/upload', upload.array('photos', 50), uploadPic)
app.post('/api/upload', upload.array('photos', 50), uploadPic)

// Pictures routes (private)
app.get('/admin/getpic/:filename', isAuthenticated, getPic)
app.get('/admin/getthumbnail/:filename', isAuthenticated, getThumbnail)
app.get('/admin/getpics', isAuthenticated, getPics)
app.get('/admin/changepicstatus', isAuthenticated, changePicsStatus)
app.get('/admin/downloadzip', isAuthenticated, downloadArchive)
app.delete('/admin/deletepic/:filename', isAuthenticated, deletePic)
app.get('/api/admin/getpic/:filename', isAuthenticatedApi, getPic)
app.get('/api/admin/getthumbnail/:filename', isAuthenticatedApi, getThumbnail)
app.get('/api/admin/getpics', isAuthenticatedApi, getPics)
app.get('/api/admin/changepicstatus', isAuthenticatedApi, changePicsStatus)
app.get('/api/admin/downloadzip', isAuthenticatedApi, downloadArchive)
app.delete('/api/admin/deletepic/:filename', isAuthenticatedApi, deletePic)

// User routes
app.post('/register', isAuthenticated, registerUser)
app.post('/passwordChange', isAuthenticated, changerUserPassword)
app.post('/api/register', isAuthenticatedApi, registerUser)
app.post('/api/passwordChange', isAuthenticatedApi, changerUserPassword)

const clientDistPath = path.resolve(__dirname, '..', 'dist', 'client')
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath))
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/get') || req.path.startsWith('/admin/change') || req.path.startsWith('/admin/download') || req.path.startsWith('/admin/delete')) return next()
    return res.sendFile(path.join(clientDistPath, 'index.html'))
  })
}

// Uncomment for production
// const options = {
//   key: fs.readFileSync('ssl/key.pem'),
//   cert: fs.readFileSync('ssl/cert.pem')
// }
// const server = https.createServer(options, app)
// server.listen(443, () => {
//   console.log('HTTPS server online.')
// })

// Uncomment for dev
 const server = app.listen(4300, () => console.debug(`Listening on port ${(server.address() as AddressInfo).port}`))
