// The guest invitation a guest opens by its link (spec 29).

/**
 * What the invitation's public page shows. The state is the server's and the page never
 * recomputes it. `address` and `message` are **absent** once the event is `over`; `joinUrl` (a
 * path, `/join/<code>`) is present **only** while `joinable`; `logoUrl` (a path) only when the
 * event has a logo.
 */
export interface GuestInvitePageDto {
  /** Whether and how the guest may answer (spec 30); with `state: 'off'` the page shows no block. */
  readonly rsvp: GuestRsvpPageDto
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

/** What the invitation page says about answering (spec 30), as the guest reads it. */
export interface GuestRsvpPageDto {
  readonly state: 'off' | 'open' | 'closed' | 'full'
  /** A local day, read in the invitation's zone, or `null`. */
  readonly deadline: string | null
  readonly form: {
    readonly maybe: boolean
    readonly partySize: { readonly enabled: boolean; readonly max: number }
    readonly kidsSeparate: boolean
    readonly diet: boolean
    readonly companionNames: boolean
    readonly meals: { readonly enabled: boolean; readonly options: readonly string[] }
    readonly questions: readonly {
      readonly id: string
      readonly label: string
      readonly kind: 'text' | 'choice'
      readonly options?: readonly string[]
    }[]
    readonly visibility: 'off' | 'count' | 'names'
  }
  /** Only when the host chose to show who comes: the people coming, and the first names allowed. */
  readonly proof?: { readonly count: number; readonly names: readonly string[] }
}

/** A guest's own reply, as they read it back. No id, no source: nothing they could not know. */
export interface GuestOwnRsvpDto {
  readonly name: string
  readonly answer: 'yes' | 'maybe' | 'no' | 'waitlist'
  readonly adults: number
  readonly kids: number
  readonly diet: string | null
  readonly message: string | null
  readonly companions: readonly string[]
  readonly meals: readonly string[]
  readonly answers: readonly {
    readonly questionId: string
    readonly label: string
    readonly value: string
  }[]
  readonly showName: boolean
  readonly updatedAt: string
}

export interface GuestOwnRsvpResponseDto {
  readonly rsvp: GuestOwnRsvpDto
}

/** `201` of the creation: the reply, and the token to keep, shown once. */
export interface GuestRsvpCreatedDto extends GuestOwnRsvpResponseDto {
  readonly editToken: string
}

// The host's side of the guests' replies (spec 30).

/** The form a host built: what the invitation page asks guests. */
export interface RsvpFormDto {
  readonly maybe: boolean
  readonly partySize: { readonly enabled: boolean; readonly max: number }
  readonly kidsSeparate: boolean
  readonly diet: boolean
  readonly companionNames: boolean
  readonly meals: { readonly enabled: boolean; readonly options: readonly string[] }
  readonly questions: readonly {
    readonly id: string
    readonly label: string
    readonly kind: 'text' | 'choice'
    readonly options?: readonly string[]
  }[]
  readonly visibility: 'off' | 'count' | 'names'
  readonly capacity: number | null
  readonly moments: readonly { readonly id: string; readonly label: string }[]
  readonly absentNote: boolean
}

/**
 * The replies' settings, and where the window stands **now** on the server's clock. `state` and
 * `closesAt` are `null` while the event has no invitation (`invited: false`); `erasedAt` is `null`
 * while there is no reply. `deadline` is a local day, the others are ISO-8601 instants.
 */
export interface RsvpSettingsDto {
  readonly invited: boolean
  readonly enabled: boolean
  readonly deadline: string | null
  readonly closedAt: string | null
  readonly form: RsvpFormDto
  readonly state: 'off' | 'open' | 'closed' | 'full' | null
  readonly closesAt: string | null
  readonly erasedAt: string | null
}

export interface RsvpFormResponseDto {
  readonly rsvpForm: RsvpSettingsDto
}

/** What a household reads when it opens its personal link (spec 30, lot 3): no token, no id. */
export interface GuestHouseholdResponseDto {
  readonly household: {
    readonly name: string
    readonly places: number
    /** Its reply, when it gave one. */
    readonly rsvp?: GuestOwnRsvpDto
  }
}

/** One reply as the host reads it. The guest's edit token is never part of it. */
export interface RsvpDto {
  readonly id: string
  /** The household of the guest list this reply answers for (lot 3), or `null`. */
  readonly householdId: string | null
  readonly name: string
  readonly answer: 'yes' | 'maybe' | 'no' | 'waitlist'
  readonly adults: number
  readonly kids: number
  readonly diet: string | null
  readonly message: string | null
  readonly source: 'open' | 'household' | 'host'
  readonly details: {
    readonly companions: readonly string[]
    readonly meals: readonly string[]
    readonly answers: readonly {
      readonly questionId: string
      readonly label: string
      readonly value: string
    }[]
    readonly moments: readonly string[]
    readonly showName: boolean
  }
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RsvpResponseDto {
  readonly rsvp: RsvpDto
}

/** The figures of the replies: one function on the server, so the table, the tiles and the export agree. */
export interface RsvpStatsDto {
  readonly yes: {
    readonly responses: number
    readonly people: number
    readonly adults: number
    readonly kids: number
  }
  readonly maybe: { readonly responses: number; readonly people: number }
  readonly no: { readonly responses: number }
  readonly waitlist: { readonly responses: number; readonly people: number }
  readonly diets: readonly { readonly name: string; readonly diet: string }[]
  readonly meals: readonly { readonly label: string; readonly count: number }[]
  /** Households of the guest list with no reply, and the places kept for them (lot 3). */
  readonly noReply: { readonly households: number; readonly places: number }
}

/** One household of the host's guest list (spec 30, lot 3), with the secret of its personal link. */
export interface HouseholdDto {
  readonly id: string
  readonly name: string
  readonly places: number
  /** The link's secret: the page is `/i/<invitation token>#f=<this>`. */
  readonly token: string
  readonly remindedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  /** The reply filed under this household, or `null` while it has none. */
  readonly reply: {
    readonly id: string
    readonly answer: 'yes' | 'maybe' | 'no' | 'waitlist'
    readonly people: number
  } | null
}

export interface HouseholdResponseDto {
  readonly household: HouseholdDto
}

export interface HouseholdListResponseDto {
  readonly households: readonly HouseholdDto[]
}

/** What a pasted list stored, and the lines left out with the reason. */
export interface HouseholdImportResponseDto {
  readonly households: readonly HouseholdDto[]
  readonly skipped: readonly {
    readonly line: number
    readonly reason: 'name' | 'places' | 'duplicate'
  }[]
}

/** `GET /events/:slug/rsvps`: the replies page, with the settings beside it. */
export interface RsvpListResponseDto {
  readonly rsvpForm: RsvpSettingsDto
  readonly rsvps: readonly RsvpDto[]
  readonly stats: RsvpStatsDto
  /** How many replies were written or changed since the caller last looked. */
  readonly unseen: number
}
