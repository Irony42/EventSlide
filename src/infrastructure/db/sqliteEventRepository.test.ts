import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventSummary } from '../../application/ports/eventRepository'
import {
  AT,
  aClient,
  aClientCeilings,
  anEvent,
  anEventSettings,
} from '../../application/testing/builders'
import {
  EVENT_CONTRACT_FIXTURES,
  PURGE_POLICY,
  eventRepositoryContract,
} from '../../application/testing/contracts/eventRepositoryContract'
import { DEFAULT_EVENT_THEME } from '../../domain/events/eventTheme'
import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteClientRepository } from './sqliteClientRepository'
import { SqliteEventRepository } from './sqliteEventRepository'
import { SqliteMembershipRepository } from './sqliteMembershipRepository'

/**
 * The shared contract, plus what only the adapter can be asked: the cascade, the unique
 * indexes, the dashboard join, and what happens when a row no longer parses.
 */

const HOST = asUserId('user-host')
const MOD = asUserId('user-mod')

/**
 * `events.owner_id` is a foreign key, so every host a fixture names must exist first.
 * The builder's own default owner is read off the builder rather than retyped, because
 * the contract's unscoped fixtures rely on it.
 */
const FIXTURE_USER_IDS: readonly string[] = [
  ...EVENT_CONTRACT_FIXTURES.userIds,
  anEvent().ownerId,
  HOST,
  MOD,
]

const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

const seedUsers = (db: Db, ids: readonly string[]): void => {
  const insert = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
  )
  for (const id of new Set(ids)) {
    insert.run(id, `${id}@example.test`, 'hash:un-mot-de-passe-solide', AT.toISOString())
  }
}

/** `length(content_hash) = 64` is a schema CHECK; only distinctness matters here. */
const hashFor = (photoId: string): string =>
  Buffer.from(photoId).toString('hex').padEnd(64, '0').slice(0, 64)

const insertGuest = (db: Db, guestId: string, eventId: string): void => {
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
     VALUES (?, ?, 'Léa', ?, ?)`,
  ).run(guestId, eventId, AT.toISOString(), AT.toISOString())
}

interface PhotoSeed {
  readonly id: string
  readonly eventId: string
  readonly guestId: string
  readonly status: string
  readonly byteSize: number
}

const insertPhoto = (db: Db, seed: PhotoSeed): void => {
  db.prepare(
    `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                         width, height, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, 4032, 3024, ?, ?)`,
  ).run(
    seed.id,
    seed.eventId,
    seed.guestId,
    seed.status,
    hashFor(seed.id),
    seed.byteSize,
    AT.toISOString(),
  )
}

const insertReaction = (db: Db, id: string, eventId: string, photoId: string, guestId: string) => {
  db.prepare(
    `INSERT INTO reactions (id, event_id, photo_id, guest_id, kind, created_at)
     VALUES (?, ?, ?, ?, 'love', ?)`,
  ).run(id, eventId, photoId, guestId, AT.toISOString())
}

const insertMembership = (db: Db, eventId: string, userId: string, role: string): void => {
  db.prepare(
    `INSERT INTO event_memberships (event_id, user_id, role, granted_at) VALUES (?, ?, ?, ?)`,
  ).run(eventId, userId, role, AT.toISOString())
}

interface EventRowCounts {
  readonly photos: number
  readonly guests: number
  readonly reactions: number
  readonly memberships: number
}

const countIn = (db: Db, table: string, eventId: string): number => {
  const row = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE event_id = ?`,
    )
    .get(eventId)
  // -1 rather than 0: an unreadable count must fail the assertion, not satisfy it.
  return row?.count ?? -1
}

const rowCountsFor = (db: Db, eventId: string): EventRowCounts => ({
  photos: countIn(db, 'photos', eventId),
  guests: countIn(db, 'guests', eventId),
  reactions: countIn(db, 'reactions', eventId),
  memberships: countIn(db, 'event_memberships', eventId),
})

/** better-sqlite3 exposes a stable `code`; the message is not part of the contract. */
const sqliteCodeOf = (thrown: unknown): string =>
  thrown instanceof Error && 'code' in thrown && typeof thrown.code === 'string'
    ? thrown.code
    : `not a SqliteError: ${String(thrown)}`

const rejectionOf = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (thrown) {
    return thrown
  }
  return new Error('the action resolved instead of rejecting')
}

eventRepositoryContract('sqlite', async () => {
  const db = migratedDb()
  seedUsers(db, FIXTURE_USER_IDS)

  return {
    repo: new SqliteEventRepository(db),
    memberships: new SqliteMembershipRepository(db),
    clients: new SqliteClientRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteEventRepository', () => {
  let db: Db
  let repo: SqliteEventRepository

  beforeEach(() => {
    db = migratedDb()
    seedUsers(db, FIXTURE_USER_IDS)
    repo = new SqliteEventRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // ------------------------------------------------------------- uniqueness --

  it.each([
    {
      index: 'slug',
      second: anEvent({ id: 'evt-2', slug: 'camille-et-sacha', joinCode: 'ZZZZZZ' }),
    },
    {
      index: 'join code',
      second: anEvent({ id: 'evt-2', slug: 'gala-annuel', joinCode: 'H7K2QM' }),
    },
  ])('refuses at the unique index a second event holding the same $index', async ({ second }) => {
    await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha', joinCode: 'H7K2QM' }))

    const thrown = await rejectionOf(() => repo.save(second))

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_UNIQUE')
  })

  // ------------------------------------------------ the folded name (migration 016) --

  describe("the name lookup's index column", () => {
    const foldOf = (id: string): string | null =>
      (
        db.prepare('SELECT name_fold FROM events WHERE id = ?').get(id) as {
          name_fold: string | null
        }
      ).name_fold

    it('is written with the event, and follows a rename', async () => {
      await repo.save(anEvent({ id: 'evt-1', name: 'Fête de Noël' }))
      expect(foldOf('evt-1')).toBe('fete de noel')

      await repo.save(anEvent({ id: 'evt-1', name: 'Mariage Léa' }))

      expect(foldOf('evt-1')).toBe('mariage lea')
      expect(await repo.listByName('fete de noel', 5)).toEqual([])
      expect((await repo.listByName('MARIAGE LÉA', 5)).map((event) => event.id)).toEqual(['evt-1'])
    })

    it('is filled for a row that predates it, when the repository is constructed', async () => {
      await repo.save(anEvent({ id: 'evt-1', name: 'Fête de Noël' }))
      db.prepare('UPDATE events SET name_fold = NULL').run()
      expect(await repo.listByName('fete de noel', 5)).toEqual([])

      const reopened = new SqliteEventRepository(db)

      expect(foldOf('evt-1')).toBe('fete de noel')
      expect((await reopened.listByName('FÊTE DE NOËL', 5)).map((event) => event.id)).toEqual([
        'evt-1',
      ])
    })

    it('is looked up by its index, not by scanning the table', () => {
      const plan = db
        .prepare("EXPLAIN QUERY PLAN SELECT id FROM events WHERE name_fold = 'x'")
        .all() as { detail: string }[]

      expect(plan.map((row) => row.detail).join(' ')).toContain('idx_events_name_fold')
    })
  })

  it('refuses an event whose owner is not an account', async () => {
    const thrown = await rejectionOf(() => repo.save(anEvent({ id: 'evt-1', ownerId: 'ghost' })))

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })

  // ------------------------------------------------------- createWithOwner --

  /**
   * The contract proves what `createWithOwner` leaves behind when it refuses. These prove
   * what only this adapter can be asked: that the three writes are **one transaction**, by
   * breaking the middle one and reading the rows left behind. A `save` followed by a
   * `grant` — what `createEvent` did — passes every case in the contract and fails here.
   */
  describe('createWithOwner as one transaction', () => {
    const CLIENT = asClientId('client-1')

    const rowsOf = (table: string): number =>
      db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? -1

    it('leaves no event and no count behind when the owner’s membership cannot be written', async () => {
      await new SqliteClientRepository(db).save(aClient({ id: CLIENT }))
      const ceilings = aClientCeilings()

      // The event insert succeeds — HOST exists — and the membership insert after it
      // fails its foreign key: the creator named for the membership is not an account.
      const thrown = await rejectionOf(() =>
        repo.createWithOwner(
          anEvent({ id: 'evt-1', ownerId: HOST, clientId: CLIENT }),
          { userId: asUserId('ghost'), grantedAt: AT },
          ceilings,
        ),
      )

      expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
      expect(rowsOf('events')).toBe(0)
      expect(rowsOf('event_memberships')).toBe(0)
      expect((await new SqliteClientRepository(db).findById(CLIENT))?.eventsCreatedInPeriod).toBe(0)
    })

    it('leaves no event and no owner behind when the client’s counter cannot be written', async () => {
      await new SqliteClientRepository(db).save(aClient({ id: CLIENT }))
      // A counter that cannot move: the schema's own CHECK is `>= 0`, so a trigger that
      // refuses the update stands in for any failure of the last statement.
      db.exec(
        `CREATE TRIGGER no_counter BEFORE UPDATE OF events_created_in_period ON clients
         BEGIN SELECT RAISE(ABORT, 'counter is read-only'); END`,
      )

      const thrown = await rejectionOf(() =>
        repo.createWithOwner(
          anEvent({ id: 'evt-1', ownerId: HOST, clientId: CLIENT }),
          { userId: HOST, grantedAt: AT },
          aClientCeilings(),
        ),
      )

      expect(thrown).toBeInstanceOf(Error)
      expect(rowsOf('events')).toBe(0)
      expect(rowsOf('event_memberships')).toBe(0)
    })

    it('holds the write lock from the first read, so a second writer cannot slip between check and insert', async () => {
      // The ceiling is a count compared against rows, and two creations that both read a
      // count under it would both write. That interleaving needs two connections, so this
      // one runs on a file: the second connection tries to create an event for the same
      // client at the instant between the first one's read and its write, which is exactly
      // where the rule is called from. A deferred transaction holds no write lock yet, lets
      // the intruder in, and then fails its own write against a stale snapshot instead.
      const directory = mkdtempSync(join(tmpdir(), 'eventslide-create-'))
      const path = join(directory, 'eventslide.sqlite')
      const first = openDatabase({ path })
      const second = openDatabase({ path })

      try {
        migrate(first, migrations)
        seedUsers(first, FIXTURE_USER_IDS)
        // No waiting: the intruder must be refused on the spot, not queued behind the lock.
        second.pragma('busy_timeout = 0')
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await new SqliteClientRepository(first).save(aClient({ id: CLIENT, ceilings }))

        const intruder = new SqliteEventRepository(second)
        let intrusion: Promise<unknown> | null = null
        const original = ceilings.creationRefusal.bind(ceilings)
        vi.spyOn(ceilings, 'creationRefusal').mockImplementation((total, createdInPeriod) => {
          intrusion = intruder.createWithOwner(
            anEvent({
              id: 'evt-2',
              slug: 'evt-2',
              joinCode: 'BBBBBB',
              ownerId: HOST,
              clientId: CLIENT,
            }),
            { userId: HOST, grantedAt: AT },
            ceilings,
          )
          return original(total, createdInPeriod)
        })

        const created = await new SqliteEventRepository(first).createWithOwner(
          anEvent({
            id: 'evt-1',
            slug: 'evt-1',
            joinCode: 'AAAAAA',
            ownerId: HOST,
            clientId: CLIENT,
          }),
          { userId: HOST, grantedAt: AT },
          ceilings,
        )

        expect(created.ok).toBe(true)
        expect(sqliteCodeOf(await rejectionOf(() => intrusion ?? Promise.resolve()))).toBe(
          'SQLITE_BUSY',
        )
        expect(first.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(
          1,
        )
      } finally {
        vi.restoreAllMocks()
        closeDatabase(first)
        closeDatabase(second)
        rmSync(directory, { recursive: true, force: true })
      }
    })
  })

  // -------------------------------------------------------------- dashboard --

  describe('dashboard row', () => {
    /**
     * Two events, each with its own guest, photos and bytes. Every count below is
     * therefore also a tenant-isolation assertion: a missing `event_id` in any of the
     * four subqueries changes the number.
     */
    beforeEach(async () => {
      await repo.save(anEvent({ id: 'evt-mine', ownerId: HOST }))
      await repo.save(
        anEvent({ id: 'evt-other', ownerId: HOST, slug: 'gala-annuel', joinCode: 'ZZZZZZ' }),
      )

      insertGuest(db, 'guest-mine', 'evt-mine')
      insertPhoto(db, {
        id: 'photo-mine-1',
        eventId: 'evt-mine',
        guestId: 'guest-mine',
        status: 'published',
        byteSize: 2_000,
      })
      insertPhoto(db, {
        id: 'photo-mine-2',
        eventId: 'evt-mine',
        guestId: 'guest-mine',
        status: 'pending',
        byteSize: 1_000,
      })

      insertGuest(db, 'guest-other-1', 'evt-other')
      insertGuest(db, 'guest-other-2', 'evt-other')
      insertPhoto(db, {
        id: 'photo-other-1',
        eventId: 'evt-other',
        guestId: 'guest-other-1',
        status: 'pending',
        byteSize: 9_000,
      })
    })

    const counts: readonly { field: keyof EventSummary; expected: number }[] = [
      { field: 'photoCount', expected: 2 },
      { field: 'pendingCount', expected: 1 },
      { field: 'guestCount', expected: 1 },
      { field: 'usedBytes', expected: 3_000 },
    ]

    it.each(counts)('reports $field for that event alone', async ({ field, expected }) => {
      const summaries = await repo.listForUser(HOST)

      expect(summaries.find((summary) => summary.id === 'evt-mine')?.[field]).toBe(expected)
    })

    // The answer about a single event reads the same four columns, so the same four numbers.
    it.each(counts)('countsOf reports $field for that event alone', async ({ field, expected }) => {
      const mine = await repo.countsOf(asEventId('evt-mine'))

      expect(mine[field as keyof typeof mine]).toBe(expected)
    })

    it('countsOf counts the other event for the other event', async () => {
      expect(await repo.countsOf(asEventId('evt-other'))).toEqual({
        photoCount: 1,
        pendingCount: 1,
        guestCount: 2,
        usedBytes: 9_000,
      })
    })
  })

  it('lists an event the user only moderates, because a moderator needs it too', async () => {
    await repo.save(anEvent({ id: 'evt-1', ownerId: HOST }))
    insertMembership(db, 'evt-1', MOD, 'moderator')

    const summaries = await repo.listForUser(MOD)

    expect(summaries.map((summary) => summary.id)).toEqual(['evt-1'])
  })

  // ---------------------------------------------------------------- cascade --

  describe('deleting an event', () => {
    beforeEach(async () => {
      await repo.save(anEvent({ id: 'evt-1', ownerId: HOST }))
      await repo.save(
        anEvent({ id: 'evt-2', ownerId: HOST, slug: 'gala-annuel', joinCode: 'ZZZZZZ' }),
      )

      for (const eventId of ['evt-1', 'evt-2']) {
        insertGuest(db, `guest-${eventId}`, eventId)
        insertPhoto(db, {
          id: `photo-${eventId}`,
          eventId,
          guestId: `guest-${eventId}`,
          status: 'published',
          byteSize: 1_000,
        })
        insertReaction(db, `reaction-${eventId}`, eventId, `photo-${eventId}`, `guest-${eventId}`)
        insertMembership(db, eventId, MOD, 'moderator')
      }
    })

    it('cascades to its photos, guests, reactions and memberships', async () => {
      await repo.delete(asEventId('evt-1'))

      expect(rowCountsFor(db, 'evt-1')).toEqual({
        photos: 0,
        guests: 0,
        reactions: 0,
        memberships: 0,
      })
    })

    it('leaves another event rows untouched', async () => {
      await repo.delete(asEventId('evt-1'))

      expect(rowCountsFor(db, 'evt-2')).toEqual({
        photos: 1,
        guests: 1,
        reactions: 1,
        memberships: 1,
      })
    })
  })

  // -------------------------------------------------------------- retention --

  /**
   * The deadline is computed in SQL — `closed_at + retentionDays`, with `retentionDays`
   * read out of the JSON column — so these two cases hold that arithmetic to what
   * `purgeDeadline` decides. The contract cannot: it only ever sees a repository
   * that agrees with itself.
   */
  describe('the purge deadline computed in SQL', () => {
    const DAY = 86_400_000

    it('treats the deadline instant itself as due, to the millisecond', async () => {
      // `purgeDeadline` is due at `now >= deadline`, and `closed_at` carries
      // milliseconds. A deadline formatted to whole seconds compares as later than the
      // instant it should match, and the last album of the night is never collected.
      await repo.save(
        anEvent({
          id: 'evt-1',
          ownerId: HOST,
          status: 'closed',
          closedAt: new Date('2026-06-20T21:00:00.500Z'),
          settings: { retentionDays: 1 },
        }),
      )

      const due = await repo.listDueForPurge(new Date('2026-06-21T21:00:00.500Z'), PURGE_POLICY)

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('is not due a millisecond before its deadline', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          ownerId: HOST,
          status: 'closed',
          closedAt: new Date('2026-06-20T21:00:00.500Z'),
          settings: { retentionDays: 1 },
        }),
      )

      const due = await repo.listDueForPurge(new Date('2026-06-21T21:00:00.499Z'), PURGE_POLICY)

      expect(due).toEqual([])
    })

    it('collects an archived event too, because retention applies to both end states', async () => {
      // `retentionApplies` covers closed and archived. An archived album is the one a
      // host expects to be gone once the window passes, so a status list that forgot it
      // would keep every archive on the disk for ever.
      await repo.save(
        anEvent({
          id: 'evt-1',
          ownerId: HOST,
          status: 'archived',
          closedAt: AT,
          settings: { retentionDays: 1 },
        }),
      )

      const due = await repo.listDueForPurge(new Date(AT.getTime() + DAY * 3), PURGE_POLICY)

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })
  })

  // ------------------------------------------------------------ corrupt rows --

  describe('a row the domain refuses', () => {
    it.each([
      { column: 'name', value: '' },
      { column: 'slug', value: 'Not A Slug' },
      { column: 'join_code', value: 'nope' },
      { column: 'created_at', value: 'samedi soir' },
    ])('refuses to hydrate an event whose $column no longer parses', async ({ column, value }) => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET ${column} = ? WHERE id = ?`).run(value, 'evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })

    const valid = anEventSettings().toProps()

    /** A settings blob a host really chose, with one field as a corrupt row holds it. */
    const json = (patch: Record<string, unknown>): string => JSON.stringify({ ...valid, ...patch })

    it.each([
      { holds: 'not JSON at all', stored: 'samedi soir' },
      { holds: 'a JSON value that is not an object', stored: 'null' },
      { holds: 'a JSON array', stored: '[]' },
      { holds: 'an unknown moderation mode', stored: json({ moderation: 'ai' }) },
      { holds: 'a non-boolean flag', stored: json({ allowCaptions: 'oui' }) },
      { holds: 'a missing flag', stored: json({ allowGuestSelfDelete: undefined }) },
      { holds: 'a non-numeric window', stored: json({ guestSelfDeleteGraceSeconds: '900' }) },
      { holds: 'a retention the domain refuses', stored: json({ retentionDays: 0 }) },
      { holds: 'a theme that is not an object', stored: json({ theme: 'rose' }) },
      {
        holds: 'an unknown font pairing',
        stored: json({
          theme: {
            accentHue: 305,
            fonts: 'comic',
            frame: 'soft',
            ambiance: 'guinguette',
          },
        }),
      },
      {
        holds: 'an unknown frame style',
        stored: json({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'oval',
            ambiance: 'guinguette',
          },
        }),
      },
      {
        holds: 'a hue that is not a number',
        stored: json({
          theme: {
            accentHue: 'rose',
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'guinguette',
          },
        }),
      },
      {
        // ADR 0010: present and unknown is corruption.
        holds: 'an unknown ambiance',
        stored: json({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'disco',
          },
        }),
      },
    ])('refuses to hydrate an event whose stored settings hold $holds', async ({ stored }) => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(stored, 'evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })

    it('renders a hue off the circle as the default rather than failing the event', async () => {
      // The one stored value in this block that does **not** make a row corrupt, and the
      // asymmetry is deliberate: a theme is cosmetic, and refusing here would fail
      // `findById` — taking the wall, the join page and the settings page down for that
      // event over a colour, including the page its host would use to pick another one.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 400,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'guinguette',
          },
        }),
        'evt-1',
      )

      const event = await repo.findById(asEventId('evt-1'))

      expect(event?.settings.theme).toEqual(DEFAULT_EVENT_THEME)
    })

    it('leaves clips off on an event created before clips existed', async () => {
      // The upgrade path, and the one field whose absence is **not** read as its default.
      // A settings blob with no `allowClips` was written by a host who was never asked,
      // and the deploy that adds video must not start accepting 80 MB uploads on an event
      // that may be live at that moment. A host who wants it turns it on, once.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ allowClips: undefined }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.allowClips).toBe(false)
    })

    it('keeps the choice of a host who did answer the question', async () => {
      // The other half: the absent key is the only thing that means "off by default".
      // A stored `true` is a decision, and a fallback that overrode it would be the
      // failure the strict reading of every other field exists to prevent.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ allowClips: true }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.allowClips).toBe(true)
    })

    it('reads an event written before the guestbook as closed to messages, and shown on the wall', async () => {
      // The 3.4.0 -> 3.5.0 upgrade (spec 01). `settingsOf` throws `Corrupt events.settings` on an
      // absent key unless the field goes through `settingsBooleanAddedLater`, so without it the
      // first read of every existing event 500s. The two answers are opposite on purpose: no
      // messages for a host never asked, and the wall shows them once the host has said yes.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ allowGuestbook: undefined, guestbookOnWall: undefined }),
        'evt-1',
      )

      const settings = (await repo.findById(asEventId('evt-1')))?.settings

      expect(settings?.allowGuestbook).toBe(false)
      expect(settings?.guestbookOnWall).toBe(true)
    })

    it('keeps the guestbook choices of a host who made them', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ allowGuestbook: true, guestbookOnWall: false }),
        'evt-1',
      )

      const settings = (await repo.findById(asEventId('evt-1')))?.settings

      expect(settings?.allowGuestbook).toBe(true)
      expect(settings?.guestbookOnWall).toBe(false)
    })

    it('reads an event written before the wall had a language as French', async () => {
      // The upgrade path for roadmap 1.5, and the **opposite** answer to `allowClips`
      // above: French is what such an event's projector has been rendering since the day
      // it was created, because the whole interface was French then. Filling it in changes
      // nothing a host would notice, and there is nothing they consented to that it
      // switches on.
      //
      // Refusing the row instead is the mutation that found this test missing, and it is
      // not a quiet failure: `corrupt` throws out of `settingsOf`, so the wall, the join
      // page, the settings page and the dashboard row of **every event on the box** all
      // 500 on the first request after the deploy.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ wallLanguage: undefined }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.wallLanguage).toBe('fr')
    })

    it('reads an event that never uploaded a venue photograph as having none', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ venuePhoto: undefined }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.venuePhoto).toBeNull()
    })

    it.each([[42], ['../../etc/passwd'], ['AB'.repeat(5)], [{ value: 'x' }]])(
      'reads a venue photograph that is not a digest (%o) as none, and does not take the event down',
      async (stored) => {
        // A cosmetic field: the theme's own rule one field over. A hand-edited column loses a
        // decoration; it must never fail findById and with it the wall and the settings page.
        await repo.save(anEvent({ id: 'evt-1' }))
        db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
          json({ venuePhoto: stored }),
          'evt-1',
        )

        expect((await repo.findById(asEventId('evt-1')))?.settings.venuePhoto).toBeNull()
      },
    )

    it('keeps a wall language the host did choose', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ wallLanguage: 'de' }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.wallLanguage).toBe('de')
    })

    it('refuses a stored wall language this build has no words for', async () => {
      // Present but outside the vocabulary is corruption, exactly as an unknown moderation
      // mode is. The tempting simplification — fall back to French here too, and drop the
      // branch — is the one outcome worse than naming the column: the projector runs in
      // the wrong language for eight hours while the host's settings page shows the tag
      // they chose, and nothing anywhere says why.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ wallLanguage: 'pt' }),
        'evt-1',
      )

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow(/unknown wall language/)
    })

    it('still serves an event whose stored hue the legibility rule would now refuse', async () => {
      // The one field hydration judges differently, and the reason is a deploy that
      // nobody would connect to the outage. `MIN_STATUS_SEPARATION` and the accent tones
      // are numbers somebody will one day tighten, and every stored theme was chosen
      // under the old ones. Re-running the rule on read would make that edit throw here —
      // taking the wall, the join and the settings page down for the event, including the
      // page its host would have used to pick another colour.
      //
      // 160 degrees is inside `--success`: a hue `EventSettings.create` refuses outright.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 160,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'guinguette',
          },
        }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme.accentHue).toBe(160)
    })

    it('renders an event created before theming exactly as it rendered then', async () => {
      // The other shape of "the key is absent", and deliberately not the one above.
      // A theme consents to nothing and costs nothing, so the fallback is the product's
      // own look — which is what that event has been showing all along. If this ever
      // returned anything else, every wall that predates this deploy would change colour
      // on restart.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ theme: undefined }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme).toEqual({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
      })
    })

    it.each([
      { holds: 'a custom object that is not an object', custom: 'sombre' },
      { holds: 'an unknown polarity', custom: { ground: 'grey', groundHue: 1, faces: 'noces' } },
      { holds: 'unknown faces', custom: { ground: 'dark', groundHue: 1, faces: 'disco' } },
      {
        holds: 'a hue that is not a number',
        custom: { ground: 'dark', groundHue: 'x', faces: 'noces' },
      },
    ])('refuses a theme whose custom ambiance holds $holds', async ({ custom }) => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'custom',
            custom,
          },
        }),
        'evt-1',
      )

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })

    it('renders an event themed before ambiances existed in the product’s own look', async () => {
      // ADR 0010: no migration. A theme with four keys has been
      // rendering the root look since it was written, and that is what `darkroom` is.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ theme: { accentHue: 250, fonts: 'sans', frame: 'square' } }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme).toEqual({
        accentHue: 250,
        fonts: 'sans',
        frame: 'square',
        ambiance: 'eventslide',
      })
    })

    it('reads a theme stored as darkroom, the retired Chambre noire, as EventSlide, the slate it was', async () => {
      // Pierre's local database holds events themed while the Chambre noire existed. Refusing
      // them would be reporting corruption that is not there, and the old dark default is the
      // violet again (ADR 0010, amendment of 29/10).
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 345,
            fonts: 'serif',
            frame: 'round',
            ambiance: 'darkroom',
          },
        }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme).toEqual({
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        ambiance: 'eventslide',
      })
    })

    it('keeps an event that stored the Guinguette explicitly on the Guinguette', async () => {
      // The default moved on 29/10; a host who has the Guinguette written in their theme did not
      // ask for the violet, and only an *absent* ambiance reads as the new default.
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'soft',
            ambiance: 'guinguette',
          },
        }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme.ambiance).toBe('guinguette')
    })

    it('keeps a chosen ambiance across a save and a read', async () => {
      const event = anEvent({ id: 'evt-1' })
      await repo.save(event)
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'round',
            ambiance: 'riviera',
          },
        }),
        'evt-1',
      )

      expect((await repo.findById(asEventId('evt-1')))?.settings.theme.ambiance).toBe('riviera')
    })

    it.each([['glass'], ['plain'], ['opaque'], [42], [null]])(
      'ignores a stored theme.material of %j: the key is dead (ADR 0012)',
      async (material) => {
        // Glass was retired. Rows written before still carry the key, and a garbage value must
        // not be corruption: nothing reads it, so nothing can be wrong with it.
        await repo.save(anEvent({ id: 'evt-1' }))
        db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
          json({
            theme: {
              accentHue: 345,
              fonts: 'serif',
              frame: 'round',
              material,
              ambiance: 'guinguette',
            },
          }),
          'evt-1',
        )

        expect((await repo.findById(asEventId('evt-1')))?.settings.theme).toEqual({
          accentHue: 345,
          fonts: 'serif',
          frame: 'round',
          ambiance: 'guinguette',
        })
      },
    )

    it('does not write the material key back when settings are saved', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(
        json({ theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'glass' } }),
        'evt-1',
      )
      const event = await repo.findById(asEventId('evt-1'))
      if (event === null) throw new Error('event missing')
      await repo.save(event)

      const row = db.prepare(`SELECT settings FROM events WHERE id = ?`).get('evt-1') as {
        settings: string
      }
      expect(row.settings).not.toContain('material')
    })

    it('refuses to hydrate an event whose status is outside the lifecycle', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      // The column carries a CHECK, so only a hand-edited database reaches this state —
      // which is what the pragma reproduces.
      db.pragma('ignore_check_constraints = ON')
      db.prepare(`UPDATE events SET status = 'cancelled' WHERE id = ?`).run('evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })
  })
})
