import type { SiteWorld } from '../../../application/testing/fakeSiteOverview'
import { openDatabase, type Db } from '../connection'
import { migrations } from '../migrations'
import { migrate } from '../migrator'
import { SqliteClientRepository } from '../sqliteClientRepository'
import { SqliteClipJobRepository } from '../sqliteClipJobRepository'
import { SqliteEventRepository } from '../sqliteEventRepository'
import { SqliteGuestRepository } from '../sqliteGuestRepository'
import { SqliteMissionRepository } from '../sqliteMissionRepository'
import { SqlitePhotoRepository } from '../sqlitePhotoRepository'
import { SqliteUserRepository } from '../sqliteUserRepository'

/** A migrated in-memory database. */
export const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/**
 * A world over `db`, written through the repositories the product itself uses.
 *
 * Not hand-written `INSERT`s: the operator's overview must read what the product actually
 * writes, and a fixture that bypassed the repositories could plant a row the product can
 * never produce. What the contract plants is everything a client and a guest write — names,
 * slugs, join codes, captions, guests, prompts, display names, hashes.
 */
export const sqliteWorld = (db: Db): SiteWorld => {
  const users = new SqliteUserRepository(db)
  const clients = new SqliteClientRepository(db)
  const events = new SqliteEventRepository(db)
  const guests = new SqliteGuestRepository(db)
  const missions = new SqliteMissionRepository(db)
  const photos = new SqlitePhotoRepository(db)
  const clipJobs = new SqliteClipJobRepository(db)

  return {
    addAccount: (user) => users.save(user),
    addClient: (client) => clients.save(client),
    addClientMember: (membership) => clients.grantMember(membership),
    addEvent: (event) => events.save(event),
    addGuest: (guest) => guests.save(guest),
    addMission: (mission) => missions.save(mission),
    addPhoto: (photo) => photos.save(photo),
    // `save` is update-only; a row comes into being through `stage`, with limits nothing in
    // a fixture world should trip, so the status the fixture states is the status stored.
    addClipJob: async (job) => {
      await clipJobs.stage(job, {
        quotaBytes: Number.MAX_SAFE_INTEGER,
        maxQueuedClips: Number.MAX_SAFE_INTEGER,
        maxQueuedClipsPerEvent: Number.MAX_SAFE_INTEGER,
      })
    },
  }
}
