import { DomainError } from '../../../domain/shared/errors'
import type { GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { SiteGuestbookState } from './takedownState'

/**
 * Where a guestbook message is and whether it is down, by its id alone: the operator's look
 * before acting (`GET /api/site/guestbook-entries/:entryId`). Ids and an instant, never the text.
 */
export interface GetSiteGuestbookStateDeps {
  readonly guestbook: Pick<GuestbookRepository, 'locate'>
}

export type GetSiteGuestbookState = (input: {
  readonly entryId: GuestbookEntryId
}) => Promise<Result<SiteGuestbookState, DomainError>>

export const makeGetSiteGuestbookState =
  ({ guestbook }: GetSiteGuestbookStateDeps): GetSiteGuestbookState =>
  async ({ entryId }) => {
    const located = await guestbook.locate(entryId)
    if (located === null) return err(DomainError.notFound('guestbook.notFound'))
    return ok({ id: entryId, eventId: located.eventId, takenDownAt: located.takenDownAt })
  }
