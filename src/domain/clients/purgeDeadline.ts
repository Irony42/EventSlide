import type { Event } from '../events/event'
import { retentionApplies } from '../events/eventStatus'
import type { Client } from './client'

/**
 * When an event's media may first be deleted, with its client's ceilings in the picture
 * (roadmap §10.5 / P3-06's "contrat purge"). `null` means "not on a clock": the event is
 * kept until a person deletes it.
 *
 * **One rule, spelled twice.** `SqliteEventRepository.listDueForPurge` computes the same
 * thing in SQL, because hydrating every archived event to ask would make the nightly purge
 * scale with the archive instead of with what is due; `FakeEventRepository` calls this. The
 * shared contract suite runs one table of cases through both, which is what keeps them one
 * rule — if you change a line here, change `PURGE_DEADLINE_SQL` and add the case.
 *
 * The deadline is the **earliest** of up to four, because each is a promise somebody made
 * and the purge may not be later than any of them:
 *
 * 1. **the host's own retention**, `closed_at + settings.retentionDays` — what the notice
 *    told every guest. A ceiling can only bring the purge forward from here (through 2 and
 *    3), never push it back: it is a bound, not an extension. And it is the one deadline the
 *    notice floor below does not hold back, because it was the promise before the ceiling
 *    moved;
 * 2. **the client's ceiling**, `max(closed_at + max_retention_days,
 *    retention_cap_since + noticeDays)`. The first term is the plain rule and the second is
 *    the floor under it: lowering a ceiling stamps `retention_cap_since`, and an event
 *    closed long ago must not be purged before that notice has run, whatever the new
 *    number says. It is what turns "your ceiling is now 14 days" into at least 30 days'
 *    warning instead of an album gone the same night. The old form, `max(closed_at,
 *    since) + cap`, gave only `cap` days, which is 14 for the client in the example. **The
 *    floor applies only to an album closed before `retention_cap_since`**: one closed after
 *    it was never promised the longer retention and gets `closed_at + cap`, which is what its
 *    guests were told;
 * 3. **the live-window bound**, `max(opened_at + max_live_days + max_retention_days,
 *    retention_cap_since + noticeDays)`, which makes "whatever reopenings happened" true.
 *    A reopening clears `closed_at`, so a rule that counts only from it is a rule a host can
 *    move. `opened_at` is stamped once, so this one cannot be. It needs all three of its
 *    inputs — an event that never opened, a client with no live window and a client with
 *    no retention ceiling each have nothing to add up — and it keeps the notice floor for
 *    the reason (2) does;
 * 4. **the client's `purge_after`**, which offboarding sets (roadmap §10.7).
 *
 * **No `NULL` turns the others off, and that is the point of writing it as a list.** The
 * query this replaces required `retentionDays IS NOT NULL` and took a scalar `MIN` over
 * values that can be `NULL`, which is `NULL` in SQLite — so an event kept "for ever" under a
 * client ceiling was never purged, which is the one outcome a ceiling exists to prevent.
 */
export const purgeDeadline = (
  event: Event,
  client: Client | null,
  noticeDays: number,
): Date | null => {
  // The clock starts when the event ends. A live event has no deadline however old it is;
  // the live window closes it first and then this applies.
  const closedAt = event.closedAt
  if (!retentionApplies(event.status) || closedAt === null) return null

  const candidates: Date[] = []

  const own = event.retentionDeadline()
  if (own !== null) candidates.push(own)

  if (client === null) return earliest(candidates)

  const ceilings = client.ceilings
  const cap = ceilings.maxRetentionDays
  if (cap !== null) {
    // The notice is owed to an album that was **already closed** when the ceiling was lowered:
    // it was promised the longer retention. One closed afterwards was under the lower ceiling
    // from its first day, and padding its purge with a notice would keep it past the number its
    // guests are told — the ceiling would not be a ceiling.
    const since = client.retentionCapSince
    const floor =
      since !== null && closedAt.getTime() < since.getTime() ? addDays(since, noticeDays) : null

    candidates.push(later(addDays(closedAt, cap), floor))

    const window = ceilings.maxLiveDays
    const openedAt = event.openedAt
    if (window !== null && openedAt !== null) {
      candidates.push(later(addDays(openedAt, window + cap), floor))
    }
  }

  if (client.purgeAfter !== null) candidates.push(client.purgeAfter)

  return earliest(candidates)
}

const MS_PER_DAY = 24 * 60 * 60 * 1_000

const addDays = (at: Date, days: number): Date => new Date(at.getTime() + days * MS_PER_DAY)

/** The later of an instant and one that may not exist. */
const later = (at: Date, floor: Date | null): Date =>
  floor !== null && floor.getTime() > at.getTime() ? floor : at

const earliest = (candidates: readonly Date[]): Date | null =>
  candidates.reduce<Date | null>(
    (soonest, at) => (soonest === null || at.getTime() < soonest.getTime() ? at : soonest),
    null,
  )
