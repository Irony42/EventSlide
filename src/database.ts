import sqlite3 from 'sqlite3'

export const db = new sqlite3.Database('database/database.sqlite')

process.on('exit', () => {
  db.close()
})

export const initDatabase = () => {
  db.run(
    `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    partyId TEXT NOT NULL
  )
`,
    (err) => {
      if (err) {
        console.error('Error creating users table:', err)
      } else {
        console.log('Users table created successfully.')
        const defaultUsername = 'admin'
        const defaultPasswordHash = '$2b$10$aRdMnDQSg/DeFoJNHj7HoupkHwQw8OE5WcxVONnICyy9FBK0eMcfe' // Hashed password for "password"
        const defaultPartyId = 'myParty'
        db.run(
          'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)',
          [defaultUsername, defaultPasswordHash, defaultPartyId],
          (err: { errno: number; code: string } | undefined) => {
            if (err && err.code === 'SQLITE_CONSTRAINT') {
              console.log('Default user already exist.')
            } else if (err) {
              console.error('Error inserting default user:', err)
            } else {
              console.log('Default user added successfully.')
            }
          }
        )
      }
    }
  )

  db.run(
    `
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName TEXT NOT NULL,
    status TEXT NOT NULL,
    partyId TEXT NOT NULL
  )
`,
    (err) => {
      if (err) {
        console.error('Error creating photos table:', err)
      } else {
        console.log('Photos table created successfully.')
      }
    }
  )
}
