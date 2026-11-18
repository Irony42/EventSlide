import { describe, expect, it } from 'vitest'
import {
  GUESTBOOK_CONTRACT_FIXTURES,
  crowdGuestId,
} from '../../application/testing/contracts/guestbookRepositoryContract'
import { guestbookVoiceRepositoryContract } from '../../application/testing/contracts/guestbookVoiceRepositoryContract'
import { AT, aVoiceEntry } from '../../application/testing/builders'
import { ContentHash } from '../../domain/photos/contentHash'
import { asClientId, asEventId, asGuestbookEntryId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteGuestbookRepository } from './sqliteGuestbookRepository'
import { SqliteGuestbookVoiceRepository } from './sqliteGuestbookVoiceRepository'

const ISO_AT = AT.toISOString()
const WEDDING = asEventId('evt-wedding')

/** The parents the contract names, as sqliteGuestbookRepository.test.ts seeds them. */
const seedForeignRows = (db: Db): void => {
  const insertUser = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.userIds) insertUser.run({ id, at: ISO_AT })

  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })

  const insertGuest = db.prepare<{
    readonly id: string
    readonly eventId: string
    readonly at: string
  }>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (@id, @eventId, NULL, @at, @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.guestIds) {
    insertGuest.run({ id, eventId: 'evt-wedding', at: ISO_AT })
  }
  for (let n = 0; n < GUESTBOOK_CONTRACT_FIXTURES.crowd; n += 1) {
    insertGuest.run({ id: crowdGuestId(n), eventId: 'evt-wedding', at: ISO_AT })
  }
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

let photoSerial = 0

guestbookVoiceRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    voices: new SqliteGuestbookVoiceRepository(db),
    guestbook: new SqliteGuestbookRepository(db),
    takeDown: (eventId, entryId, at) => {
      db.prepare<[string, string, string]>(
        `UPDATE guestbook_entries SET taken_down_at = ? WHERE event_id = ? AND id = ?`,
      ).run(at.toISOString(), eventId, entryId)
    },
    chargePhotoBytes: async (eventId, bytes) => {
      photoSerial += 1
      db.prepare(
        `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                             width, height, byte_size, created_at)
         VALUES (?, ?, 'guest-lea', 'published', ?, 100, 100, ?, ?)`,
      ).run(
        `photo-${photoSerial}`,
        eventId,
        photoSerial.toString(16).padStart(64, '0'),
        bytes,
        ISO_AT,
      )
    },
    dispose: async () => closeDatabase(db),
  }
})

const limits = { quotaBytes: 1_000_000, maxQueuedVoices: 10, maxQueuedVoicesPerEvent: 10 }

const aReservation = (id: string, caption: string | null = null) =>
  aVoiceEntry({ id, state: 'reserved', eventId: 'evt-wedding', guestId: 'guest-lea', caption })

describe('SqliteGuestbookVoiceRepository schema behaviour', () => {
  it('takes the voice row with the event when the event is purged', async () => {
    const db = migratedDatabase()
    await new SqliteGuestbookVoiceRepository(db).admitVoice(aReservation('v1'), limits)

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    expect(db.prepare(`SELECT COUNT(*) AS n FROM guestbook_voices`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('takes the voice row with the guest row, through the entries', async () => {
    const db = migratedDatabase()
    await new SqliteGuestbookVoiceRepository(db).admitVoice(aReservation('v1'), limits)

    db.prepare<[string]>(`DELETE FROM guests WHERE id = ?`).run('guest-lea')

    expect(db.prepare(`SELECT COUNT(*) AS n FROM guestbook_voices`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('writes the caption, or the empty string, into the body column', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1', 'Pour vous'), limits)
    await voices.admitVoice(aReservation('v2'), limits)

    const bodies = db
      .prepare<[], { readonly id: string; readonly body: string }>(
        `SELECT id, body FROM guestbook_entries ORDER BY id`,
      )
      .all()

    expect(bodies).toEqual([
      { id: 'v1', body: 'Pour vous' },
      { id: 'v2', body: '' },
    ])
    closeDatabase(db)
  })

  it('judges the byte ceiling of the event client over all its events, voices included', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO clients (id, name, created_at, max_total_bytes)
       VALUES ('client-1', 'Atelier', ?, 1000)`,
    ).run(ISO_AT)
    db.prepare(`UPDATE events SET client_id = 'client-1'`).run()
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                           width, height, byte_size, created_at)
       VALUES ('p1', 'evt-gala', 'guest-lea', 'published', ?, 100, 100, 900, ?)`,
    ).run('c'.repeat(64), ISO_AT)
    const voices = new SqliteGuestbookVoiceRepository(db)

    const refused = await voices.admitVoice(
      aVoiceEntry({
        id: 'v1',
        state: 'reserved',
        eventId: 'evt-wedding',
        guestId: 'guest-lea',
        sourceByteSize: 200,
      }),
      { ...limits, clientBytes: { clientId: asClientId('client-1'), maxBytes: 1_000 } },
    )

    expect(refused).toEqual({
      kind: 'refused',
      refusal: { reason: 'clientStorageFull', remaining: 100 },
    })
    closeDatabase(db)
  })

  it('judges a result on the client ceiling over all its events, crediting the source it replaces', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO clients (id, name, created_at, max_total_bytes)
       VALUES ('client-1', 'Atelier', ?, 1000)`,
    ).run(ISO_AT)
    db.prepare(`UPDATE events SET client_id = 'client-1'`).run()
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                           width, height, byte_size, created_at)
       VALUES ('p1', 'evt-gala', 'guest-lea', 'published', ?, 100, 100, 900, ?)`,
    ).run('c'.repeat(64), ISO_AT)
    const voices = new SqliteGuestbookVoiceRepository(db)
    const entry = aVoiceEntry({
      id: 'v1',
      state: 'reserved',
      eventId: 'evt-wedding',
      guestId: 'guest-lea',
      sourceByteSize: 50,
    })
    await voices.admitVoice(entry, limits)
    await voices.saveVoice(WEDDING, asGuestbookEntryId('v1'), entry.voice!.queue(AT))
    const claimed = (await voices.claimNext(AT))?.voice
    if (claimed === undefined || claimed === null) throw new Error('fixture')
    const done = (output: number) => {
      const ready = claimed.finish({ hash: aHash(), byteSize: output, durationMs: 2_000 }, AT)
      if (!ready.ok) throw new Error('fixture')
      return ready.value
    }
    const ceiling = { clientId: asClientId('client-1'), maxBytes: 1_000 }

    expect(
      await voices.markReady(WEDDING, asGuestbookEntryId('v1'), done(101), {
        quotaBytes: 1_000_000,
        clientBytes: ceiling,
      }),
    ).toEqual({ kind: 'refused', refusal: { reason: 'clientStorageFull', remaining: 100 } })
    expect(
      await voices.markReady(WEDDING, asGuestbookEntryId('v1'), done(100), {
        quotaBytes: 1_000_000,
        clientBytes: ceiling,
      }),
    ).toEqual({ kind: 'saved' })
    closeDatabase(db)
  })

  it('refuses to be handed a voice that is not ready', async () => {
    const db = migratedDatabase()
    const running = aVoiceEntry({ id: 'v1', state: 'running' }).voice
    if (running === null) throw new Error('fixture')

    await expect(
      new SqliteGuestbookVoiceRepository(db).markReady(WEDDING, asGuestbookEntryId('v1'), running, {
        quotaBytes: 1_000,
      }),
    ).rejects.toThrow('ready voice')
    closeDatabase(db)
  })

  it('refuses, in the database itself, a ready voice that cannot say how long it is', () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
       VALUES ('v1', 'evt-wedding', 'guest-lea', '', 'pending', ?)`,
    ).run(ISO_AT)

    expect(() =>
      db
        .prepare(
          `INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size,
                                         audio_hash, audio_byte_size, duration_ms, queued_at)
           VALUES ('v1', 'evt-wedding', 'ready', ?, 10, ?, 10, NULL, ?)`,
        )
        .run('a'.repeat(64), 'b'.repeat(64), ISO_AT),
    ).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('refuses, in the database itself, an output on a voice that is not ready', () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
       VALUES ('v1', 'evt-wedding', 'guest-lea', '', 'pending', ?)`,
    ).run(ISO_AT)

    expect(() =>
      db
        .prepare(
          `INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size,
                                         audio_hash, audio_byte_size, duration_ms, queued_at)
           VALUES ('v1', 'evt-wedding', 'queued', ?, 10, ?, 10, 1000, ?)`,
        )
        .run('a'.repeat(64), 'b'.repeat(64), ISO_AT),
    ).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('refuses a stored source digest that is not one, rather than projecting it', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1'), limits)
    db.prepare(`UPDATE guestbook_voices SET source_hash = 'not a digest'`).run()

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /invalid source_hash/,
    )
    closeDatabase(db)
  })

  it('refuses a stored output digest that is not one', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(
      aVoiceEntry({ id: 'v1', state: 'ready', eventId: 'evt-wedding', guestId: 'guest-lea' }),
      limits,
    )
    db.prepare(`UPDATE guestbook_voices SET audio_hash = 'nope'`).run()

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /invalid audio_hash/,
    )
    closeDatabase(db)
  })

  it('refuses a stored failure code the domain does not know, rather than guessing a reason', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1'), limits)
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE guestbook_voices SET failure = 'mystery'`).run()
    db.pragma('ignore_check_constraints = OFF')

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /unknown voice failure/,
    )
    closeDatabase(db)
  })

  it('refuses a stored voice state the domain does not know', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1'), limits)
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE guestbook_voices SET state = 'lost'`).run()
    db.pragma('ignore_check_constraints = OFF')

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /unknown voice state/,
    )
    closeDatabase(db)
  })

  it('refuses a stored caption the domain does not accept', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1'), limits)
    db.prepare(`UPDATE guestbook_entries SET body = ?`).run('x'.repeat(141))

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /caption the domain refuses/,
    )
    closeDatabase(db)
  })

  it('keeps a written message a written one: an empty body is still a corrupt row for it', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
       VALUES ('w1', 'evt-wedding', 'guest-lea', '', 'pending', ?)`,
    ).run(ISO_AT)

    await expect(
      new SqliteGuestbookRepository(db).findById(WEDDING, asGuestbookEntryId('w1')),
    ).rejects.toThrow(/body the domain refuses/)
    closeDatabase(db)
  })

  it('refuses a stored status the domain does not know, on a voice as on a text', async () => {
    const db = migratedDatabase()
    const voices = new SqliteGuestbookVoiceRepository(db)
    await voices.admitVoice(aReservation('v1'), limits)
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE guestbook_entries SET status = 'weird'`).run()
    db.pragma('ignore_check_constraints = OFF')

    await expect(voices.findByEntry(WEDDING, asGuestbookEntryId('v1'))).rejects.toThrow(
      /unknown status/,
    )
    closeDatabase(db)
  })

  it('leaves the unique index the final word, and a failed voice outside it', () => {
    const db = migratedDatabase()
    const insertEntry = db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
       VALUES (?, 'evt-wedding', 'guest-lea', '', 'pending', ?)`,
    )
    const insertVoice = db.prepare(
      `INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size, queued_at)
       VALUES (?, 'evt-wedding', ?, ?, 10, ?)`,
    )
    insertEntry.run('v1', ISO_AT)
    insertEntry.run('v2', ISO_AT)
    insertVoice.run('v1', 'reserved', 'a'.repeat(64), ISO_AT)

    expect(() => insertVoice.run('v2', 'queued', 'a'.repeat(64), ISO_AT)).toThrow(
      /UNIQUE constraint failed/,
    )
    db.prepare(
      `UPDATE guestbook_voices SET state = 'failed', failure = 'corrupt' WHERE entry_id = 'v1'`,
    ).run()
    expect(() => insertVoice.run('v2', 'queued', 'a'.repeat(64), ISO_AT)).not.toThrow()
    closeDatabase(db)
  })
})

const aHash = (): ContentHash => {
  const hash = ContentHash.create('a'.repeat(64))
  if (!hash.ok) throw new Error('fixture')
  return hash.value
}
