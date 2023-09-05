import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { db } from '../database'
import { User } from '../models'

export const registerUser = (req: Request, res: Response) => {
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
}

export const changerUserPassword = (req: Request, res: Response) => {
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
}