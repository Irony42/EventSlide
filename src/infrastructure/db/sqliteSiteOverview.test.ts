import { siteOverviewContract } from '../../application/testing/contracts/siteOverviewContract'
import { closeDatabase } from './connection'
import { SqliteSiteOverview } from './sqliteSiteOverview'
import { migratedDb, sqliteWorld } from './testing/sqliteSiteWorld'

/**
 * The shared contract over a real, migrated database, its world written through the real
 * repositories (`testing/sqliteSiteWorld.ts`). What the contract plants is everything a
 * client and a guest write; what it sweeps for is every trace of it in the overview.
 */
siteOverviewContract('sqlite', async () => {
  const db = migratedDb()
  return {
    overview: new SqliteSiteOverview(db),
    world: sqliteWorld(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})
