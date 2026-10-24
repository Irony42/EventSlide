import type { UserId } from '../../domain/shared/ids'
import type { AccountHoldings, AccountHoldingsCount } from '../ports/accountHoldings'

const NOTHING: AccountHoldingsCount = { events: 0, media: 0, eventMemberships: 0 }

/** What an account holds is stated by the test, because the fake has no events or photographs of its own. */
export class FakeAccountHoldings implements AccountHoldings {
  private readonly held = new Map<UserId, AccountHoldingsCount>()

  holds(userId: UserId, holdings: Partial<AccountHoldingsCount>): this {
    this.held.set(userId, { ...NOTHING, ...holdings })
    return this
  }

  async countFor(userId: UserId): Promise<AccountHoldingsCount> {
    return this.held.get(userId) ?? NOTHING
  }
}
