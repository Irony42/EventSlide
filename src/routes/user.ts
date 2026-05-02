import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { db } from '../database'
import { User } from '../models'

const isApiRequest = (req: Request) => req.path.startsWith('/api/')

export const registerUser = async (req: Request, res: Response) => {
  const { username, password } = req.body
  const { partyId } = req.user as any
  if (!username || !password) {
    if (isApiRequest(req)) return res.status(400).json({ success: false, message: 'Missing credentials.' })
    return res.redirect('/admin/users/new?userCreationFailed=true')
  }

  try {
    const hash = await bcrypt.hash(password, 10)
    const query = 'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)'
    await db.run(query, [username, hash, partyId])
    console.log('Registered new user : ', username)
    if (isApiRequest(req)) return res.json({ success: true, message: 'User created.' })
    res.redirect('/admin/users/new?userCreationFailed=false')
  } catch (err) {
    console.error('Error while registering new user:', err)
    if (isApiRequest(req)) return res.status(500).json({ success: false, message: 'User creation failed.' })
    return res.redirect('/admin/users/new?userCreationFailed=true')
  }
}

export const changerUserPassword = async (req: Request, res: Response) => {
  const { password, newPassword, newPassword2 } = req.body
  const { username } = req.user as any

  if (newPassword !== newPassword2) {
    console.log('Password not changed, different new passwords.')
    if (isApiRequest(req)) return res.status(400).json({ success: false, message: 'Passwords mismatch.' })
    return res.redirect('/admin/password?passwordChange=true')
  }

  try {
    const query = 'SELECT * FROM users WHERE username = ?'
    const user = await db.get<User>(query, [username])

    if (!user) {
      if (isApiRequest(req)) return res.status(404).json({ success: false, message: 'User not found.' })
      return res.redirect('/admin/password?passwordChange=true')
    }

    const result = await bcrypt.compare(password, user.password)
    if (!result) {
      console.log('Incorrect current password.')
      if (isApiRequest(req))
        return res.status(400).json({ success: false, message: 'Current password is incorrect.' })
      return res.redirect('/admin/password?passwordChange=true')
    }

    const hash = await bcrypt.hash(newPassword, 10)
    const updateQuery = 'UPDATE users SET password = ? WHERE username = ?'
    await db.run(updateQuery, [hash, username])
    
    if (isApiRequest(req)) return res.json({ success: true, message: 'Password changed.' })
    return res.redirect('/admin/password?passwordChange=false')
  } catch (err) {
    console.error('Error during password change:', err)
    if (isApiRequest(req))
      return res.status(500).json({ success: false, message: 'Password update failed.' })
    return res.redirect('/admin/password?passwordChange=true')
  }
}