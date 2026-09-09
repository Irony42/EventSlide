/**
 * `npm run db:migrate` and `npm run db:status`.
 *
 * Kept as a script rather than folded into server startup so that applying a schema
 * change to a database holding someone's wedding album is a deliberate act with
 * readable output, not a side effect of a restart.
 */
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate, status } from '../src/infrastructure/db/migrator'
import { loadConfig } from '../src/infrastructure/config/env'

const main = (): void => {
  const wantsStatus = process.argv.includes('--status')
  const config = loadConfig()
  const path = process.env['DATABASE_PATH'] ?? config.storage.databasePath

  const db = openDatabase({ path })
  try {
    if (wantsStatus) {
      const report = status(db, migrations)
      console.log(`Database: ${path}`)
      console.log(`Applied (${report.applied.length}):`)
      for (const row of report.applied) {
        console.log(`  ${String(row.id).padStart(3, '0')}  ${row.name}  ${row.appliedAt}`)
      }
      console.log(`Pending (${report.pending.length}):`)
      for (const row of report.pending) {
        console.log(`  ${String(row.id).padStart(3, '0')}  ${row.name}`)
      }
      return
    }

    const applied = migrate(db, migrations)
    if (applied.length === 0) {
      console.log(`Database is up to date: ${path}`)
      return
    }
    console.log(`Applied ${applied.length} migration(s) to ${path}: ${applied.join(', ')}`)
  } finally {
    closeDatabase(db)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
