import { describe, expect, it } from 'vitest'
import { mailBudgetContract } from '../../application/testing/contracts/mailBudgetContract'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteMailBudget } from './sqliteMailBudget'

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

mailBudgetContract('sqlite', async (maxPerDay) => {
  const db = migratedDatabase()
  return {
    budget: new SqliteMailBudget(db, maxPerDay),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteMailBudget', () => {
  it('keeps one row per day', async () => {
    const db = migratedDatabase()
    const budget = new SqliteMailBudget(db, 10)

    await budget.take('2026-12-13', 2)
    await budget.take('2026-12-13', 3)
    await budget.count('2026-12-13', 1)

    expect(db.prepare(`SELECT day, count FROM mail_daily_counts`).all()).toEqual([
      { day: '2026-12-13', count: 6 },
    ])
    closeDatabase(db)
  })
})
