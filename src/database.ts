import sqlite3 from 'sqlite3'
import { open, Database } from 'sqlite'

export let db: Database<sqlite3.Database, sqlite3.Statement>

export const initDatabase = async () => {
  db = await open({
    filename: 'database/database.sqlite',
    driver: sqlite3.Database
  })

  // Activer le mode WAL pour de meilleures performances en écriture
  await db.exec('PRAGMA journal_mode = WAL;')

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      partyId TEXT NOT NULL
    )
  `)
  console.log('Users table created successfully.')

  const defaultUsername = 'admin'
  const defaultPasswordHash = '$2b$10$aRdMnDQSg/DeFoJNHj7HoupkHwQw8OE5WcxVONnICyy9FBK0eMcfe' // Hashed password for "password"
  const defaultPartyId = 'myParty'

  try {
    await db.run(
      'INSERT INTO users (username, password, partyId) VALUES (?, ?, ?)',
      [defaultUsername, defaultPasswordHash, defaultPartyId]
    )
    console.log('Default user added successfully.')
  } catch (err: any) {
    if (err && err.code === 'SQLITE_CONSTRAINT') {
      console.log('Default user already exist.')
    } else {
      console.error('Error inserting default user:', err)
    }
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileName TEXT NOT NULL,
      status TEXT NOT NULL,
      partyId TEXT NOT NULL
    )
  `)
  console.log('Photos table created successfully.')
}

process.on('exit', () => {
  if (db) {
    db.close()
  }
})
