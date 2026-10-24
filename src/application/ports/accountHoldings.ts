import type { UserId } from '../../domain/shared/ids'

/**
 * What an account holds that its deletion would destroy or leave behind (G2-14 part 3).
 *
 * Counts and nothing else: the one reader of this port decides whether an account may go, and it
 * never needs to see a photograph, an event or a name. They are read together because the three
 * answers are what one decision is made of.
 */
export interface AccountHoldingsCount {
  /** Events the account **owns**. The foreign key refuses to delete an owner, and so does the rule. */
  readonly events: number
  /**
   * Photographs and clips the account **wrote** (a moderator or host uploading from the console).
   * Deleting the account cascades through their rows and leaves their files on disk, so an account
   * that wrote media is not deleted.
   */
  readonly media: number
  /** Events the account moderates or owns: its part in somebody's event, removed with it. */
  readonly eventMemberships: number
}

export interface AccountHoldings {
  /** Zeros for an account that holds nothing and for one that does not exist. */
  countFor(userId: UserId): Promise<AccountHoldingsCount>
}
