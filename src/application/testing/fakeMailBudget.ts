import type { MailBudget } from '../ports/mailBudget'

/**
 * In-memory `MailBudget`. `maxPerDay` is `MAIL_FOLLOWUP_MAX_PER_DAY` (`null` for no ceiling): `take` is
 * all or nothing, like the adapter's conditional update.
 */
export class FakeMailBudget implements MailBudget {
  private readonly days = new Map<string, number>()

  constructor(private readonly maxPerDay: number | null = null) {}

  async take(day: string, n: number): Promise<boolean> {
    const used = this.days.get(day) ?? 0
    if (this.maxPerDay !== null && used + n > this.maxPerDay) return false
    this.days.set(day, used + n)
    return true
  }

  async count(day: string, n: number): Promise<void> {
    this.days.set(day, (this.days.get(day) ?? 0) + n)
  }

  async used(day: string): Promise<number> {
    return this.days.get(day) ?? 0
  }

  async deleteBefore(day: string): Promise<number> {
    let erased = 0
    for (const known of [...this.days.keys()]) {
      if (known < day) {
        this.days.delete(known)
        erased += 1
      }
    }
    return erased
  }
}
