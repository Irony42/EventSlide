import { describe, expect, it } from 'vitest'
import type { MailBudget } from '../../ports/mailBudget'

/**
 * The shared `MailBudget` contract, run against the fake and the SQLite adapter. Each subject is built with
 * the ceiling the test asks for (`null` for none).
 */
export const mailBudgetContract = (
  name: string,
  makeSubject: (maxPerDay: number | null) => Promise<{
    budget: MailBudget
    dispose?: () => Promise<void>
  }>,
): void => {
  describe(`MailBudget contract: ${name}`, () => {
    const withBudget = async (
      maxPerDay: number | null,
      body: (budget: MailBudget) => Promise<void>,
    ): Promise<void> => {
      const { budget, dispose } = await makeSubject(maxPerDay)
      try {
        await body(budget)
      } finally {
        await dispose?.()
      }
    }

    const DAY = '2026-12-13'
    const NEXT = '2026-12-14'

    it('has counted nothing on a day nobody sent on', () =>
      withBudget(10, async (budget) => {
        expect(await budget.used(DAY)).toBe(0)
      }))

    it('takes mails that fit under the ceiling and counts them', () =>
      withBudget(10, async (budget) => {
        expect(await budget.take(DAY, 4)).toBe(true)
        expect(await budget.take(DAY, 6)).toBe(true)
        expect(await budget.used(DAY)).toBe(10)
      }))

    it('takes all of them or none: a request that does not fit moves nothing', () =>
      withBudget(10, async (budget) => {
        await budget.take(DAY, 8)

        expect(await budget.take(DAY, 3)).toBe(false)
        expect(await budget.used(DAY)).toBe(8)
        expect(await budget.take(DAY, 2)).toBe(true)
      }))

    it('refuses a first request larger than the ceiling and records nothing', () =>
      withBudget(5, async (budget) => {
        expect(await budget.take(DAY, 6)).toBe(false)
        expect(await budget.used(DAY)).toBe(0)
      }))

    it('gives the last places to one of two callers who race for them', () =>
      withBudget(3, async (budget) => {
        const results = await Promise.all([budget.take(DAY, 2), budget.take(DAY, 2)])

        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await budget.used(DAY)).toBe(2)
      }))

    it('counts per day', () =>
      withBudget(2, async (budget) => {
        await budget.take(DAY, 2)

        expect(await budget.take(NEXT, 2)).toBe(true)
        expect(await budget.used(DAY)).toBe(2)
        expect(await budget.used(NEXT)).toBe(2)
      }))

    it('takes anything when there is no ceiling, and still counts', () =>
      withBudget(null, async (budget) => {
        expect(await budget.take(DAY, 100_000)).toBe(true)
        expect(await budget.used(DAY)).toBe(100_000)
      }))

    it('counts a mail that cannot be refused with no condition, past the ceiling, and then refuses the families', () =>
      withBudget(5, async (budget) => {
        await budget.count(DAY, 4)
        await budget.count(DAY, 4)

        expect(await budget.used(DAY)).toBe(8)
        expect(await budget.take(DAY, 1)).toBe(false)
      }))

    it('erases the days before the one given, and only those', () =>
      withBudget(null, async (budget) => {
        await budget.count('2026-12-01', 1)
        await budget.count('2026-12-06', 2)
        await budget.count('2026-12-07', 3)

        expect(await budget.deleteBefore('2026-12-07')).toBe(2)
        expect(await budget.used('2026-12-01')).toBe(0)
        expect(await budget.used('2026-12-06')).toBe(0)
        expect(await budget.used('2026-12-07')).toBe(3)
        expect(await budget.deleteBefore('2026-12-07')).toBe(0)
      }))
  })
}
