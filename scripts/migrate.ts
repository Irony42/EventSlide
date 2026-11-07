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
import { existsSync } from 'node:fs'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate, status } from '../src/infrastructure/db/migrator'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'

const execute = (argv: readonly string[], env: NodeJS.ProcessEnv | undefined): number => {
  const wantsStatus = argv.includes('--status')
  const config = loadMaintenanceConfig(env)
  // Only the config module reads the environment; it has already resolved this.
  const path = config.storage.databasePath

  // `--status` only reads: it opens the database read-only, and a path that does not exist is
  // an error to report rather than an empty database to create (a typo would otherwise leave
  // one behind and report every migration as pending). Applying migrations is the command
  // that makes a fresh database, so it is the one that may create the file.
  if (wantsStatus && !existsSync(path)) {
    console.error(`There is no database at ${path}. Check DATABASE_PATH.`)
    return 1
  }

  const db = openDatabase({ path, readonly: wantsStatus })
  try {
    if (wantsStatus) {
      // A database with no ledger table yet (restored or pre-ledger) has applied nothing: the
      // ledger reader would try to create the table, which a read-only handle refuses.
      const hasLedger =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
          )
          .get() !== undefined
      const report = hasLedger
        ? status(db, migrations)
        : {
            applied: [],
            pending: [...migrations]
              .sort((a, b) => a.id - b.id)
              .map((migration) => ({ id: migration.id, name: migration.name })),
          }
      console.log(`Database: ${path}`)
      console.log(`Applied (${report.applied.length}):`)
      for (const row of report.applied) {
        console.log(`  ${String(row.id).padStart(3, '0')}  ${row.name}  ${row.appliedAt}`)
      }
      console.log(`Pending (${report.pending.length}):`)
      for (const row of report.pending) {
        console.log(`  ${String(row.id).padStart(3, '0')}  ${row.name}`)
      }
      return 0
    }

    const applied = migrate(db, migrations)
    if (applied.length === 0) {
      console.log(`Database is up to date: ${path}`)
      return 0
    }
    console.log(`Applied ${applied.length} migration(s) to ${path}: ${applied.join(', ')}`)
    return 0
  } finally {
    closeDatabase(db)
  }
}

/**
 * The whole command, as a function of its arguments and environment: exported and returning an
 * exit code (see `backup.ts`) so a test can drive it. The handle is closed on every path.
 */
export const run = (argv: readonly string[], env?: NodeJS.ProcessEnv): number => {
  try {
    return execute(argv, env)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** Run as a program, and not when a test imports `run`. */
if (require.main === module) {
  process.exitCode = run(process.argv.slice(2))
}
