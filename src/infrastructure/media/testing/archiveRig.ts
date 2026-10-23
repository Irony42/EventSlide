import { Readable } from 'node:stream'
import { AT } from '../../../application/testing/builders'
import type { MediaStore } from '../../../application/ports/mediaStore'
import type { Db } from '../../db/connection'

/**
 * What the two album ZIPs' ring-3 tests share: the rows the real database needs under a
 * photograph, and a media store that counts the files it hands out.
 *
 * Both downloads — the host's own and the shared gallery's — run the real `archiver`, the
 * real filesystem store and real SQLite here, because each of the failures these tests
 * guard was green against the fakes: the recording archive writer pulls one entry at a
 * time and `archiver` did not, and a fake photo repository hands back arrays where
 * better-sqlite3 refuses writes while a statement is iterating.
 */

const ISO_AT = AT.toISOString()

/** The owner, two events and one guest in each, which the photographs' foreign keys need. */
export const seedAlbumRows = (db: Db): void => {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-owner', 'hote@example.test', 'hash:x', '${ISO_AT}')`,
  ).run()
  for (const id of ['evt-wedding', 'evt-gala']) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES ('${id}', 'user-owner', '${id}', '${id}', '${id}', 'closed', '{}',
                    100000000000, '${ISO_AT}')`,
    ).run()
  }
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES ('guest-1', 'evt-wedding', NULL, '${ISO_AT}', '${ISO_AT}'),
                 ('guest-gala', 'evt-gala', NULL, '${ISO_AT}', '${ISO_AT}')`,
  ).run()
}

/** How many files the store opened for reading and how many of those have been closed. */
export interface OpenFiles {
  /** Streams handed out by `openRead`: each holds a file descriptor until it closes. */
  opened: number
  closed: number
}

/**
 * The same store, counting every stream `openRead` hands out and every one that closes.
 *
 * It counts the filesystem's own `ReadStream`s, so "closed" is the descriptor being
 * released rather than a generator somebody wrote having finished. A store that stops
 * returning streams makes this throw instead of counting nothing, which would pass.
 */
export const countingOpenFiles = (store: MediaStore): { store: MediaStore; files: OpenFiles } => {
  const files: OpenFiles = { opened: 0, closed: 0 }
  return {
    files,
    store: {
      ...store,
      openRead: async (...args) => {
        const stream = await store.openRead(...args)
        if (stream === null) return null
        if (!(stream instanceof Readable)) throw new Error('the store no longer returns streams')
        files.opened += 1
        stream.once('close', () => {
          files.closed += 1
        })
        return stream
      },
    },
  }
}
