import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import type { MailPreferences } from '../../../domain/notices/mailPreferences'
import type { NoticeKind } from '../../../domain/notices/noticeKind'
import type { OutgoingMail } from '../../../domain/mail/outgoingMail'
import type { EventId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { EventMailNoticeLedger } from '../../ports/eventMailNoticeLedger'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { NoticeOwner } from '../../ports/userRepository'

/**
 * **The order every notice of an event follows** (spec 32, section 5), in one place so no notice invents its own:
 *
 * 1. a notice that is **no longer worth sending** is noted without being sent (`stale`: principle 7);
 * 2. **quiet hours**: it waits for the next pass and is not noted (`quiet`);
 * 3. the recipients are the owners (read now), **minus those who switched the notice's family off**; a notice with no
 *    family (R1) goes to every owner;
 * 4. nobody left: noted without being sent (`nobody`);
 * 5. a **family** notice takes its places in the day's budget **for all its recipients at once** (`take`, atomic): refused,
 *    it is neither noted nor sent and comes back on the next pass while it is fresh (`budget`). A notice with no family is
 *    only counted, never refused;
 * 6. **noted before sent**: `note` answers `true` to one call only, so a sweep that lost the race sends nothing (`lost`);
 * 7. one mail per recipient, a refusal counted and logged by code (never the address).
 *
 * It never throws what a mailer does (a `Result`); a failure of the ledger or the budget is the caller's catch.
 */

export type DeliveryOutcome = 'stale' | 'quiet' | 'nobody' | 'budget' | 'lost' | 'served'

export interface DeliveryDeps {
  readonly notices: EventMailNoticeLedger
  readonly budget: Pick<MailBudget, 'take' | 'count'>
  readonly mailer: Mailer
  readonly logger: Logger
}

export interface DeliveryInput {
  readonly eventId: EventId
  readonly kind: NoticeKind
  readonly key: string
  /** The family an owner's switch turns off, or `null` for a notice nothing switches off (R1). */
  readonly family: keyof MailPreferences | null
  /** The owners, read at the moment of sending. */
  readonly owners: readonly NoticeOwner[]
  readonly fresh: boolean
  readonly quiet: boolean
  readonly now: Date
  readonly build: (to: EmailAddress) => OutgoingMail
}

export interface DeliveryResult {
  readonly outcome: DeliveryOutcome
  readonly sent: number
  readonly unsent: number
}

const none = (outcome: DeliveryOutcome): DeliveryResult => ({ outcome, sent: 0, unsent: 0 })

export const deliverNotice = async (
  { notices, budget, mailer, logger }: DeliveryDeps,
  input: DeliveryInput,
): Promise<DeliveryResult> => {
  const { eventId, kind, key, family, owners, now } = input

  if (!input.fresh) {
    await notices.note(eventId, kind, key, now)
    return none('stale')
  }
  if (input.quiet) return none('quiet')

  const recipients = family === null ? owners : owners.filter((owner) => owner.mail[family])
  if (recipients.length === 0) {
    await notices.note(eventId, kind, key, now)
    return none('nobody')
  }

  const day = budgetDayOf(now)
  // A family notice takes its places before the note, and a sweep that then loses the race has counted them for nothing: an
  // over-count of at most one notice's recipients, accepted (it only ever holds follow-up mails back a little sooner).
  if (family !== null && !(await budget.take(day, recipients.length))) return none('budget')

  // Noted first, whatever follows (and whoever else is sweeping).
  if (!(await notices.note(eventId, kind, key, now))) return none('lost')
  // A notice with no family is counted only once it is really this sweep's to send.
  if (family === null) await budget.count(day, recipients.length)

  let sent = 0
  let unsent = 0
  for (const owner of recipients) {
    const to = EmailAddress.fromStored(owner.email)
    if (!to.ok) {
      unsent += 1
      continue
    }
    const result = await mailer.send(input.build(to.value))
    if (result.ok) {
      sent += 1
    } else {
      unsent += 1
      logger.warn('a host notice was not sent', { eventId, kind, code: result.error.code })
    }
  }
  return { outcome: 'served', sent, unsent }
}
