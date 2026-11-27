/**
 * How many mails the box sends in a day (spec 32, section 5): the ceiling `MAIL_FOLLOWUP_MAX_PER_DAY`
 * set against what a mail relay's free quota allows.
 *
 * **Every mail counts, only some can be refused.** The follow-up mails of the families and the operator's
 * announcements go through {@link MailBudget.take}, which refuses them past the ceiling (they wait for
 * the next pass while they are still fresh); every other mail (the account's security notices, R1, an
 * operator's decision, the signup's, an invitation, a purge warning) is only {@link MailBudget.count}ed,
 * because refusing a password-change notice for want of budget would be worse than going over it.
 *
 * A day is a UTC calendar day, `YYYY-MM-DD`. The rows hold a day and a number: no address, no event.
 */
export interface MailBudget {
  /**
   * Takes `n` mails of the day **all or nothing, atomically**: `true` and the count moved by `n` when
   * they fit under the ceiling, `false` and nothing moved when they do not. With no ceiling it is always
   * `true` (and still counts). Two callers racing for the last places cannot both get them.
   */
  take(day: string, n: number): Promise<boolean>

  /** Counts `n` mails with no condition. */
  count(day: string, n: number): Promise<void>

  /** The mails counted on that day. */
  used(day: string): Promise<number>

  /** Erases the days before `day` (the sweeper keeps a week). Returns how many days were erased. */
  deleteBefore(day: string): Promise<number>
}
