import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type Db = Database.Database

export interface ConnectionOptions {
  /** A filesystem path, or `:memory:` for a test database. */
  readonly path: string
  readonly readonly?: boolean
}

/**
 * Opens the one database connection the process uses, applies the pragmas, and hands
 * it back. Constructing it is the composition root's job — nothing else opens a
 * connection, and nothing imports a module-level handle.
 *
 * That last point is the whole reason this file exists: 1.0 exported
 * `export let db` from `src/database.ts` and assigned it inside `initDatabase()`, so
 * import order decided whether the handle was defined and no test could substitute a
 * database.
 */
export const openDatabase = ({ path, readonly = false }: ConnectionOptions): Db => {
  if (path !== ':memory:') {
    // A first run on a fresh box has no ./data directory, and better-sqlite3 will not
    // create one.
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path, { readonly })

  applyPragmas(db, { readonly })
  return db
}

/**
 * Pragmas are **per connection**, not per database file. Setting them anywhere other
 * than here means they silently do not apply.
 */
export const applyPragmas = (db: Db, { readonly = false }: { readonly?: boolean } = {}): void => {
  // Without this, every `REFERENCES` and every `ON DELETE CASCADE` in the schema is
  // decorative. The cascade is what makes "purge this event" atomic and complete, so
  // this line is load-bearing rather than a tuning knob.
  db.pragma('foreign_keys = ON')

  if (!readonly) {
    // Readers do not block the writer. During an event, the projector polls the
    // playlist while guests upload; without WAL the wall stutters on every insert.
    db.pragma('journal_mode = WAL')

    // NORMAL fsyncs on checkpoint rather than on every commit. The risk it accepts is
    // losing the last few transactions if the machine loses power mid-write — for a
    // photo wall that means a guest re-sends a photo, which is the right trade against
    // a per-commit fsync on the upload path.
    db.pragma('synchronous = NORMAL')

    // A single writer plus WAL readers should never actually contend, but a checkpoint
    // can hold the file briefly. Waiting five seconds beats surfacing SQLITE_BUSY to a
    // guest whose upload otherwise succeeded.
    db.pragma('busy_timeout = 5000')
  }

  // Keeps temporary B-trees for ORDER BY off the disk.
  db.pragma('temp_store = MEMORY')

  // 64 MiB of page cache (negative means kibibytes). The hot working set is the photos
  // index for one event.
  db.pragma('cache_size = -64000')
}

/**
 * Closes cleanly, checkpointing the WAL so the `.sqlite` file is self-contained.
 *
 * A host who copies `data/eventslide.sqlite` to a USB stick after the party should get
 * the whole album, not a file missing everything still in `-wal`. 1.0 registered
 * `process.on('exit')` with an async `db.close()`, which never completed.
 */
export const closeDatabase = (db: Db): void => {
  if (!db.open) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A checkpoint can fail if another connection holds a read lock. Closing is still
    // correct and the WAL stays valid, so this is not worth failing shutdown over.
  }
  db.close()
}
