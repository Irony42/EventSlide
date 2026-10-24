import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { AT, aPhoto, anEvent, aUser } from '../../application/testing/builders'
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

    const nothing = { events: 0, media: 0, eventMemberships: 0 }
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
      eventMemberships: 1,
    })
    expect(await new SqliteAccountHoldings(db).countFor(asUserId('user-other'))).toEqual({
      events: 1,
      media: 0,
      eventMemberships: 0,
    })
  })
})
