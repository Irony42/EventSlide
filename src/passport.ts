import { PassportStatic } from 'passport'
import { db } from './database'
import LocalStrategy from 'passport-local'
import { User } from './models'
import bcrypt from 'bcrypt'

export const initPassport = (passport: PassportStatic) => {
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
        })
      })
    })
  )

  passport.serializeUser((user: any, done) => done(null, user.id))

  passport.deserializeUser((id, done) => {
    const query = 'SELECT * FROM users WHERE id = ?'
    db.get(query, [id], (err, row) => {
      done(err, row as String)
    })
  })
}
