// The guest invitation a guest opens by its link (spec 29).

/**
 * What the invitation's public page shows. The state is the server's and the page never
 * recomputes it. `address` and `message` are **absent** once the event is `over`; `joinUrl` (a
 * path, `/join/<code>`) is present **only** while `joinable`; `logoUrl` (a path) only when the
 * event has a logo.
 */
export interface GuestInvitePageDto {
  readonly state: 'upcoming' | 'joinable' | 'over'
  readonly title: string
  readonly when: {
    readonly startsAt: string
    readonly endsAt: string | null
    readonly timeZone: string
  }
  readonly venueName: string | null
  readonly address?: string | null
  readonly message?: string | null
  readonly language: string
  /** The event's accent hue, 0 to 359: the one field of its look the page wears. */
  readonly accentHue: number
  readonly logoUrl?: string
  readonly joinUrl?: string
}

/**
 * The host's reading of the event's guest invitation. `configured` is `false` until the host first
 * saves: the content is then all `null`, there is no link yet, and `defaultTitle` and
 * `defaultStartsAt` (the event's own name and date) are what the form starts from. `url` is the
 * absolute link, present as soon as a row exists, switched on or not.
 */
export interface GuestInviteDto {
  readonly configured: boolean
  readonly enabled: boolean
  readonly url: string | null
  readonly title: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly timeZone: string | null
  readonly venueName: string | null
  readonly address: string | null
  readonly message: string | null
  readonly language: string
  readonly defaultTitle: string
  readonly defaultStartsAt: string | null
}

/** What every host route of the guest invitation answers. */
export interface GuestInviteResponse {
  readonly guestInvite: GuestInviteDto
}
