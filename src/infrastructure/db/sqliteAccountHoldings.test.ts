import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { AT, aClipJob, aPhoto, anEvent, aUser } from '../../application/testing/builders'
import { closeDatabase, type Db } from './connection'
import { SqliteAccountHoldings } from './sqliteAccountHoldings'
import { migratedDb, sqliteWorld } from './testing/sqliteSiteWorld'

const PERSON = asUserId('user-person')

describe('SqliteAccountHoldings', () => {
  let db: Db

  beforeEach(() => {
    db = migratedDb()
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('counts nothing for an account that holds nothing, and for one that does not exist', async () => {
    await sqliteWorld(db).addAccount(aUser({ id: 'user-person' }))
    const holdings = new SqliteAccountHoldings(db)

    const nothing = { events: 0, media: 0, reviews: 0, eventMemberships: 0 }
    expect(await holdings.countFor(PERSON)).toEqual(nothing)
    expect(await holdings.countFor(asUserId('ghost'))).toEqual(nothing)
  })

  it('counts the events an account owns, the media it wrote and the events it has a part in, and of nobody else', async () => {
    const world = sqliteWorld(db)
    await world.addAccount(aUser({ id: 'user-person' }))
    await world.addAccount(aUser({ id: 'user-other', email: 'autre@example.test' }))
    await world.addEvent(anEvent({ id: 'event-1', ownerId: 'user-person' }))
    await world.addEvent(
      anEvent({
        id: 'event-2',
        ownerId: 'user-other',
        slug: 'autre-fete',
        joinCode: 'B4N9PT',
      }),
    )
    await world.addPhoto(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-2',
        author: { kind: 'host', id: 'user-person' },
      }),
    )
    db.prepare(
      `INSERT INTO event_memberships (event_id, user_id, role, granted_at) VALUES (?, ?, 'moderator', ?)`,
    ).run('event-2', 'user-person', AT.toISOString())

    expect(await new SqliteAccountHoldings(db).countFor(PERSON)).toEqual({
      events: 1,
      media: 1,
      reviews: 0,
      eventMemberships: 1,
    })
    expect(await new SqliteAccountHoldings(db).countFor(asUserId('user-other'))).toEqual({
      events: 1,
      media: 0,
      reviews: 0,
      eventMemberships: 0,
    })
  })

  it('counts a clip the account wrote as media, which a photograph-only count would miss', async () => {
    const world = sqliteWorld(db)
    await world.addAccount(aUser({ id: 'user-person' }))
    await world.addAccount(aUser({ id: 'user-other', email: 'autre@example.test' }))
    await world.addEvent(anEvent({ id: 'event-1', ownerId: 'user-other' }))
    await world.addPhoto(
      aPhoto({ id: 'photo-1', eventId: 'event-1', author: { kind: 'host', id: 'user-other' } }),
    )
    await world.addClipJob(
      aClipJob({
        id: 'clip-1',
        eventId: 'event-1',
        photoId: 'photo-1',
        author: { kind: 'host', id: 'user-person' },
      }),
    )

    expect((await new SqliteAccountHoldings(db).countFor(PERSON)).media).toBe(1)
  })

  it('counts the photographs the account reviewed, because the schema will not let it be deleted while it has', async () => {
    const world = sqliteWorld(db)
    await world.addAccount(aUser({ id: 'user-person' }))
    await world.addAccount(aUser({ id: 'user-other', email: 'autre@example.test' }))
    await world.addEvent(anEvent({ id: 'event-1', ownerId: 'user-other' }))
    await world.addPhoto(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'host', id: 'user-other' },
        review: { kind: 'host', userId: 'user-person' },
      }),
    )

    expect((await new SqliteAccountHoldings(db).countFor(PERSON)).reviews).toBe(1)
    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run('user-person')).toThrow(
      /photos_host_review_has_user|CHECK/,
    )
  })

  it('lets the delete through for an account that approved and wrote invitations: their pointers go to null and the tokens stay', async () => {
    await sqliteWorld(db).addAccount(aUser({ id: 'user-person' }))
    const at = AT.toISOString()
    db.prepare(
      `INSERT INTO account_tokens
         (id, purpose, token_digest, email, delivery, requires_approval, approved_by, approved_at,
          created_by, created_at, expires_at)
       VALUES ('token-1', 'invitation', ?, 'invite@example.test', 'mail', 1, 'user-person', ?,
               'user-person', ?, ?)`,
    ).run('a'.repeat(64), at, at, new Date(AT.getTime() + 86_400_000).toISOString())

    expect(await new SqliteAccountHoldings(db).countFor(PERSON)).toEqual({
      events: 0,
      media: 0,
      reviews: 0,
      eventMemberships: 0,
    })
    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run('user-person')).not.toThrow()
    expect(
      db.prepare('SELECT approved_by, created_by FROM account_tokens WHERE id = ?').get('token-1'),
    ).toEqual({ approved_by: null, created_by: null })
  })
})
