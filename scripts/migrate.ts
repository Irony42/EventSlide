/**
 * `npm run db:migrate` and `npm run db:status`, from a source checkout.
 *
 * This used to say it was kept apart from server startup so that a schema change would
 * be a deliberate act rather than a side effect of a restart. The server does it at
 * startup anyway: `src/main/container.ts` applies pending migrations at boot, before the
 * port opens, and refuses to start on a ledger it does not recognise. What this adds is
 * the same step with readable output and without starting anything, plus `--status`.
 * That is why the image carries no migrate command (see `tsconfig.ops.json`): there it
 * would only repeat what every start already does.
 */
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate, status } from '../src/infrastructure/db/migrator'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'

const main = (): void => {
  const wantsStatus = process.argv.includes('--status')
  const config = loadMaintenanceConfig()
  // Only the config module reads the environment; it has already resolved this.
  const path = config.storage.databasePath

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
