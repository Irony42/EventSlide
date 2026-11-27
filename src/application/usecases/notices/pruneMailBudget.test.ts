import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailBudget } from '../../testing/fakeMailBudget'
import { makePruneMailBudget } from './pruneMailBudget'

describe('pruneMailBudget', () => {
  it('erases the days more than seven days old, and keeps the seventh day back and the recent ones', async () => {
    const budget = new FakeMailBudget()
    await budget.count('2026-12-04', 4)
    await budget.count('2026-12-05', 5)
    await budget.count('2026-12-06', 6)
    await budget.count('2026-12-13', 7)
    const prune = makePruneMailBudget({
      budget,
      clock: new FakeClock(new Date('2026-12-13T09:00:00.000Z')),
    })

    const report = await prune()

    expect(report).toEqual({ erased: 2 })
    expect(await budget.used('2026-12-04')).toBe(0)
    expect(await budget.used('2026-12-05')).toBe(0)
    expect(await budget.used('2026-12-06')).toBe(6)
    expect(await budget.used('2026-12-13')).toBe(7)
  })

  it('keeps the count of the day exactly seven days back', async () => {
    const budget = new FakeMailBudget()
    await budget.count('2026-12-06', 5)
    await budget.count('2026-12-05', 5)
    const prune = makePruneMailBudget({
      budget,
      clock: new FakeClock(new Date('2026-12-13T00:00:00.000Z')),
    })

    expect(await prune()).toEqual({ erased: 1 })
    expect(await budget.used('2026-12-06')).toBe(5)
  })

  it('has nothing to erase on a box that never counted', async () => {
    const prune = makePruneMailBudget({
      budget: new FakeMailBudget(),
      clock: new FakeClock(new Date('2026-12-13T00:00:00.000Z')),
    })

    expect(await prune()).toEqual({ erased: 0 })
  })
})
