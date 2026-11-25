import type { ReactNode } from 'react'
import type { EventDto, GuestInviteDto, GuestRsvpPageDto } from '../../../../lib/api/dto'
import type { InvitePreferences } from './invitePreferences'

/**
 * What a format is given (spec 29): the event, the invitation **as the host is writing it** once
 * it is switched on and dated (the only time a format is shown), and the look chosen on the left.
 * `url` is the link every format carries.
 */
export interface InvitationTabProps {
  readonly event: EventDto
  readonly invite: GuestInviteDto & { readonly url: string; readonly startsAt: string }
}

/** Where the page puts what a format draws: the preview in the middle, the options and the actions on the right. */
export interface OutputSlots {
  readonly preview: ReactNode
  readonly options: ReactNode
  /** The format's buttons and what they answer: they stay in reach while the options scroll. `null`: none. */
  readonly actions: ReactNode
}

/** The look every format wears, held by the page and read here. */
export interface OutputProps extends InvitationTabProps {
  readonly preferences: InvitePreferences
  readonly onPreferences: (next: InvitePreferences) => void
  readonly photoUrl: string | null
  /** What the guest's page would say of the replies' settings being chosen (spec 30), for the preview. */
  readonly rsvp?: GuestRsvpPageDto
  /**
   * The card's own screen (no panel open): the print format shows **one large card** instead of the
   * sheet, and keeps all its state (the households, the word) for when the host shares.
   */
  readonly cardOnly?: boolean
  /** A format owns its state and hands the page its two halves. */
  readonly children: (slots: OutputSlots) => ReactNode
}
