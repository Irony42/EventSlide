import {
  ANNOUNCEMENT_DELIVERIES_KEPT_DAYS,
  ANNOUNCEMENT_KEPT_DAYS,
} from '../../../domain/hostAnnouncements/hostAnnouncement'
import { addDays } from '../../../domain/shared/time'
import type { Clock } from '../../ports/clock'
import type { HostAnnouncementRepository } from '../../ports/hostAnnouncementRepository'

export interface PruneHostAnnouncementsDeps {
  readonly announcements: Pick<
    HostAnnouncementRepository,
    'deleteDeliveriesFinishedBefore' | 'deleteCreatedBefore'
  >
  readonly clock: Clock
}

export interface PruneHostAnnouncementsReport {
  /** Rows of "who was reached" erased: those of announcements that finished more than 30 days ago. */
  readonly deliveries: number
  /** Announcements erased: those written more than 365 days ago. */
  readonly announcements: number
}

export type PruneHostAnnouncements = () => Promise<PruneHostAnnouncementsReport>

/**
 * The retention of the announcements (spec 32, lot 2, A8): **the record of who was reached is erased 30 days after the
 * announcement finished** (it holds an account id and nothing needs it once the sending is over), **the announcement itself,
 * the operator's text, is kept 365 days** as proof that hosts were told, then erased with whatever delivery it still has.
 * Run by the retention sweep, and by `npm run purge` for a box whose timer is off.
 */
export const makePruneHostAnnouncements =
  ({ announcements, clock }: PruneHostAnnouncementsDeps): PruneHostAnnouncements =>
  async () => {
    const now = clock.now()
    return {
      deliveries: await announcements.deleteDeliveriesFinishedBefore(
        addDays(now, -ANNOUNCEMENT_DELIVERIES_KEPT_DAYS),
      ),
      announcements: await announcements.deleteCreatedBefore(addDays(now, -ANNOUNCEMENT_KEPT_DAYS)),
    }
  }
