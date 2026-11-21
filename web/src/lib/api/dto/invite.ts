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
  readonly logoUrl?: string
  readonly joinUrl?: string
}
