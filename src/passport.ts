import { PassportStatic } from 'passport'
import { db } from './database'
import LocalStrategy from 'passport-local'
import { User } from './models'
import bcrypt from 'bcrypt'

export const initPassport = (passport: PassportStatic) => {
  passport.use(
    new LocalStrategy.Strategy(async (username: string, password: string, done: any) => {
      try {
        const query = 'SELECT * FROM users WHERE username = ?'
        const row = await db.get<User>(query, [username])
        
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
      } catch (err) {
        return done(err)
      }
    })
  )

  passport.serializeUser((user: any, done) => done(null, user.id))

  passport.deserializeUser(async (id, done) => {
    try {
      const query = 'SELECT * FROM users WHERE id = ?'
      const row = await db.get(query, [id])
      done(null, row as any)
    } catch (err) {
      done(err, null)
    }
  })
}
