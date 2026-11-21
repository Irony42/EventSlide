import type { EventDto, GuestInviteDto } from '../../../../lib/api/dto'

/**
 * What a format tab is given (spec 29): the event, and the invitation **once it is switched on
 * and dated**, which is the only time a tab is shown. `url` is the link every format carries.
 *
 * One file of its own, and one file per tab beside it: the print, image and e-mail tabs are three
 * pull requests that touch disjoint files.
 */
export interface InvitationTabProps {
  readonly event: EventDto
  readonly invite: GuestInviteDto & { readonly url: string; readonly startsAt: string }
}
