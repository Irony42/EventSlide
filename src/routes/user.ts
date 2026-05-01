import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { db } from '../database'
import { User } from '../models'

const isApiRequest = (req: Request) => req.path.startsWith('/api/')

export const registerUser = (req: Request, res: Response) => {
  const { username, password } = req.body
  const { partyId } = req.user as any

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      console.error('Error while registering new user :', err)
      if (isApiRequest(req)) return res.status(500).json({ success: false, message: 'Hashing failed.' })
      return res.status(500).send('Error while hashing the password.')
    }
    const query = 'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)'
    db.run(query, [username, hash, partyId], (err) => {
      if (err) {
        console.log('Error while registering new user (database) : ', err)
        if (isApiRequest(req))
          return res.status(400).json({ success: false, message: 'User creation failed.' })
        return res.redirect('/admin/users/new?userCreationFailed=true')
      }
      console.log('Registered new user : ', username)
      if (isApiRequest(req)) return res.json({ success: true, message: 'User created.' })
      res.redirect('/admin/users/new?userCreationFailed=false')
    })
  })
}

export const changerUserPassword = (req: Request, res: Response) => {
  const { password, newPassword, newPassword2 } = req.body
  const { username } = req.user as any

  if (newPassword !== newPassword2) {
    console.log('Password not changed, different new passwords.')
    if (isApiRequest(req)) return res.status(400).json({ success: false, message: 'Passwords mismatch.' })
    return res.redirect('/admin/password?passwordChange=true')
  }

  const query = 'SELECT * FROM users WHERE username = ?'
  db.get(query, [username], (err, user: User) => {
    if (err) {
      console.error('Error while fetching user data:', err)
      if (isApiRequest(req)) return res.status(500).json({ success: false, message: 'Fetch user failed.' })
      return res.redirect('/admin/password?passwordChange=true')
    }

    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        console.error('Error while comparing passwords:', err)
        if (isApiRequest(req))
          return res.status(500).json({ success: false, message: 'Password validation failed.' })
        return res.redirect('/admin/password?passwordChange=true')
      }

      if (!result) {
        console.log('Incorrect current password.')
        if (isApiRequest(req))
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' })
        return res.redirect('/admin/password?passwordChange=true')
      }

      bcrypt.hash(newPassword, 10, (err, hash) => {
        if (err) {
          console.error('Error while hashing new password:', err)
          if (isApiRequest(req))
            return res.status(500).json({ success: false, message: 'Hashing new password failed.' })
          return res.redirect('/admin/password?passwordChange=true')
        }

        const updateQuery = 'UPDATE users SET password = ? WHERE username = ?'
        db.run(updateQuery, [hash, username], (err) => {
          if (err) {
            console.error('Error while updating password in the database:', err)
            if (isApiRequest(req))
              return res.status(500).json({ success: false, message: 'Password update failed.' })
            return res.redirect('/admin/password?passwordChange=true')
          }

          if (isApiRequest(req)) return res.json({ success: true, message: 'Password changed.' })
          return res.redirect('/admin/password?passwordChange=false')
        })
      })
    })
  })
}