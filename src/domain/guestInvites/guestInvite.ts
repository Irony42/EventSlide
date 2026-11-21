import type { EventLanguage } from '../events/eventLanguage'
import { DomainError } from '../shared/errors'
import type { EventId } from '../shared/ids'
import { err, flatMap, ok, type Result } from '../shared/result'
import {
  applyContentPatch,
  type GuestInviteContent,
  type GuestInviteContentPatch,
} from './guestInviteContent'
import type { GuestInviteToken } from './guestInviteToken'

/**
 * The invitation a host sends to an event's guests (spec 29): a title, a moment, a place and a
 * word, behind a link that stays valid until the host changes it.
 *
 * One per event. It is a plain record plus the rules of its own edits; every edit returns a new
 * invitation. Whether its page is readable **now** is not stored: `inviteStateOf` derives it
 * from the event.
 */

export interface GuestInviteProps {
  readonly eventId: EventId
  readonly token: GuestInviteToken
  /** Off until the host turns it on; turning it off keeps the token (the same link comes back). */
  readonly enabled: boolean
  readonly content: GuestInviteContent
  readonly updatedAt: Date
}

export class GuestInvite {
  private constructor(private readonly props: GuestInviteProps) {}

  /** A blank, disabled invitation: what the first save or the first activation starts from. */
  static blank(
    eventId: EventId,
    token: GuestInviteToken,
    language: EventLanguage,
    now: Date,
  ): GuestInvite {
    return new GuestInvite({
      eventId,
      token,
      enabled: false,
      content: {
        title: null,
        startsAt: null,
        endsAt: null,
        timeZone: null,
        venueName: null,
        address: null,
        message: null,
        language,
      },
      updatedAt: now,
    })
  }

  /** Rebuilds one a store holds, without re-judging it (the adapter read it leniently). */
  static restore(props: GuestInviteProps): GuestInvite {
    return new GuestInvite(props)
  }

  get eventId(): EventId {
    return this.props.eventId
  }
  get token(): GuestInviteToken {
    return this.props.token
  }
  get enabled(): boolean {
    return this.props.enabled
  }
  get content(): GuestInviteContent {
    return this.props.content
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  toProps(): GuestInviteProps {
    return this.props
  }

  /** Applies a save. An absent field is left as it was; `null` clears it. */
  withContent(patch: GuestInviteContentPatch, now: Date): Result<GuestInvite, DomainError> {
    return flatMap(applyContentPatch(this.props.content, patch), (content) =>
      ok(new GuestInvite({ ...this.props, content, updatedAt: now })),
    )
  }

  /** Turns the link on. It needs a date to announce: an invitation without one says nothing. */
  enable(now: Date): Result<GuestInvite, DomainError> {
    if (this.props.content.startsAt === null)
      return err(DomainError.invalid('guestInvite.needsDate'))
    return ok(new GuestInvite({ ...this.props, enabled: true, updatedAt: now }))
  }

  /** Turns the link off. The text and the token stay. */
  disable(now: Date): GuestInvite {
    return new GuestInvite({ ...this.props, enabled: false, updatedAt: now })
  }

  /** A new link: the previous one, and every card printed with it, stops working at once. */
  rotate(token: GuestInviteToken, now: Date): GuestInvite {
    return new GuestInvite({ ...this.props, token, updatedAt: now })
  }
}
