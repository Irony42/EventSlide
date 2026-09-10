import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteReactionRepository } from './sqliteReactionRepository'
import { AT, aReaction } from '../../application/testing/builders'
import {
  REACTION_CONTRACT_FIXTURES,
  reactionRepositoryContract,
} from '../../application/testing/contracts/reactionRepositoryContract'
import { asEventId, asGuestId, asPhotoId } from '../../domain/shared/ids'

const WEDDING = asEventId('evt-wedding')
const P1 = asPhotoId('p1')
const P2 = asPhotoId('p2')
const LEA = asGuestId('guest-lea')

const OWNER_ID = 'user-owner'

/** The layout the contract documents: the wedding holds `p1`, `p2`, Léa and Nils. */
const GUEST_EVENTS: Readonly<Record<string, string>> = {
  'guest-lea': 'evt-wedding',
  'guest-nils': 'evt-wedding',
  'guest-sam': 'evt-gala',
}

interface PhotoFixture {
  readonly eventId: string
  readonly guestId: string
}

const PHOTO_AUTHORS: Readonly<Record<string, PhotoFixture>> = {
  p1: { eventId: 'evt-wedding', guestId: 'guest-lea' },
  p2: { eventId: 'evt-wedding', guestId: 'guest-lea' },
  p9: { eventId: 'evt-gala', guestId: 'guest-sam' },
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/**
 * `reactions` references `events`, `photos` and `guests`, and `photos` references all
 * three of those in turn, so the whole chain is seeded with raw SQL before the
 * repository is handed over. Deliberately not through a sibling adapter: a failure in
 * this file must have a cause in this file.
 */
const seedEvents = (db: Db, eventIds: readonly string[]): void => {
  db.prepare<[string, string, string]>(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:seed', ?)`,
  ).run(OWNER_ID, 'proprietaire@example.test', AT.toISOString())

  const insert = db.prepare<[string, string, string, string, string, string]>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (?, ?, ?, ?, ?, 'live', '{}', 1000000000, ?)`,
  )
  eventIds.forEach((eventId, index) => {
    insert.run(eventId, OWNER_ID, eventId, eventId, `CODE${index}`, AT.toISOString())
  })
}

const seedGuests = (db: Db): void => {
  const insert = db.prepare<[string, string, string, string]>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (?, ?, NULL, ?, ?)`,
  )
  for (const [guestId, eventId] of Object.entries(GUEST_EVENTS)) {
    insert.run(guestId, eventId, AT.toISOString(), AT.toISOString())
  }
}

/** `(event_id, content_hash)` is unique, so each digest comes from the row's position. */
const seedPhotos = (db: Db): void => {
  const insert = db.prepare<[string, string, string, string, string]>(
    `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash, width, height,
                         byte_size, created_at)
          VALUES (?, ?, ?, 'pending', ?, 4032, 3024, 2400000, ?)`,
  )
  Object.entries(PHOTO_AUTHORS).forEach(([photoId, author], index) => {
    insert.run(
      photoId,
      author.eventId,
      author.guestId,
      String(index).padStart(64, '0'),
      AT.toISOString(),
    )
  })
}

const seedAll = (db: Db): void => {
  seedEvents(db, REACTION_CONTRACT_FIXTURES.eventIds)
  seedGuests(db)
  seedPhotos(db)
}

interface QueryLog {
  readonly db: Db
  readonly prepared: string[]
}

/**
 * Records the SQL the adapter prepares while forwarding every call to the real
 * database. Not a stub — the tally below is computed from real rows. It exists so
 * "one grouped query" can be asserted at all: an N+1 returns exactly the same numbers
 * as the grouped query does, and would be invisible to every other test here.
 */
/** The thrown value itself, so an assertion can read a machine code off it. */
const refusalOf = (write: () => void): unknown => {
  try {
    write()
  } catch (thrown) {
    return thrown
  }
  throw new Error('expected the write to be refused')
}

const withQueryLog = (db: Db): QueryLog => {
  const prepared: string[] = []
  const proxied = new Proxy(db, {
    get: (target, property, receiver) =>
      property === 'prepare'
        ? (source: string) => {
            prepared.push(source)
            return target.prepare(source)
          }
        : Reflect.get(target, property, receiver),
  })

  return { db: proxied, prepared }
}

reactionRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  seedAll(db)

  return {
    repo: new SqliteReactionRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteReactionRepository', () => {
  let db: Db
  let repo: SqliteReactionRepository

  beforeEach(() => {
    db = migratedDatabase()
    seedAll(db)
    repo = new SqliteReactionRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // ------------------------------------------------------- the unique index --

  it('lets the unique index refuse a second reaction of the same kind by the same guest', async () => {
    // Asserted on the SQLite constraint code, not on a message, and not on the use
    // case's own check: the database is the enforcement, so a double tap that races
    // past the read is still refused.
    await repo.save(aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA }))

    const second = repo.save(
      aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
    )

    await expect(second).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' })
  })

  it('lets the same guest send a second kind on the same photo', async () => {
    await repo.save(
      aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
    )

    await repo.save(
      aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'clap' }),
    )

    expect(await repo.countsFor(WEDDING, P1)).toMatchObject({ love: 1, clap: 1 })
  })

  it('refuses a kind the schema does not know, which is what makes the row type safe', async () => {
    // `ReactionRow.kind` is typed as the closed set because of this CHECK constraint.
    // If the constraint ever goes missing, `Reaction.restore` starts trusting a value
    // nobody parsed — so the constraint is asserted rather than assumed.
    const insert = (): void => {
      db.prepare<[string]>(
        `INSERT INTO reactions (id, event_id, photo_id, guest_id, kind, created_at)
              VALUES ('r1', 'evt-wedding', 'p1', 'guest-lea', 'shrug', ?)`,
      ).run(AT.toISOString())
    }

    expect(refusalOf(insert)).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' })
  })

  // ---------------------------------------------------------- access shape --

  it('tallies a whole event in one grouped query, never one query per photo', async () => {
    await repo.save(
      aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
    )
    await repo.save(
      aReaction({ id: 'r2', eventId: WEDDING, photoId: P2, guestId: LEA, kind: 'clap' }),
    )
    const log = withQueryLog(db)

    await new SqliteReactionRepository(log.db).countsForEvent(WEDDING)

    expect(log.prepared).toHaveLength(1)
  })

  // -------------------------------------------------------------- ordering --

  it('breaks a tie in a guest reaction list by id, so two devices agree', async () => {
    await repo.save(
      aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
    )
    await repo.save(
      aReaction({ id: 'r2', eventId: WEDDING, photoId: P2, guestId: LEA, kind: 'clap' }),
    )

    const entries = await repo.listByGuest(WEDDING, LEA)

    expect(entries.map((entry) => entry.kind)).toEqual(['love', 'clap'])
  })
})
