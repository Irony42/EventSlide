/**
 * Where a person lands once they are in (navigation pass, decisions 2 and 3, finding H12).
 *
 * Surface: **the host, the moderator and the operator**, on the way into `/admin/**`. The rules
 * are here and not in a component because three pages ask the same question (the sign-in form,
 * the page for somebody who is already signed in, the invitation that has just been accepted) and
 * must give the same answer; `LoginPage` used to decide alone, with one inline function.
 *
 * Everything in this file is pure. What it needs to know (the account's events, its role in the
 * only one, its clients) is read by `features/auth/hooks/useLanding.ts` and handed in as facts, so
 * a rule is tested with a literal and not with a server.
 */

export const ADMIN_HOME = '/admin'
export const SITE_HOME = '/admin/site'

/**
 * The page somebody was heading for, as `RequireAuth` and the expired-session banner leave it in
 * the router's navigation state (`state: { from }`): a path **with its query**, or `null`.
 *
 * It is read defensively because history state is whatever the browser kept (it survives a
 * reload and can come from an older build). Only an in-app path is accepted: an absolute URL from
 * history state would be an open redirect. The second character decides that as much as the
 * first: a browser reads a backslash in a URL as a slash, so `/\ailleurs.example` *is*
 * `//ailleurs.example` by the time it is resolved, and a check that only refused `//` let it
 * through by one character. That is the same bypass react-router closed in 7.18.0
 * (GHSA-wrjc-x8rr-h8h6); it is refused here as well rather than left to the router, because this
 * value is read before the router ever sees it.
 */
export const fromOf = (state: unknown): string | null => {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null
  const from = state.from
  const inAppPath = /^\/(?![/\\])/
  // The sign-in page is where the person is: a `from` that names it is no destination, and
  // honouring it would leave the form open under a navigation that goes nowhere.
  const signIn = /^\/login(?:[/?#]|$)/
  return typeof from === 'string' && inAppPath.test(from) && !signIn.test(from) ? from : null
}

/**
 * Whether the navigation state says the change of password was **forced** by the gate, which
 * writes it. The page reads it besides the session: choosing the password makes the session
 * forget itself, the gate shows its wait and the page is mounted again, and for that moment the
 * session no longer says the change was forced while the explanation must not vanish.
 */
export const forcedByGate = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'forced' in state && state.forced === true

/**
 * The page the person chose, if they chose one: `fromOf`, except for the dashboard itself.
 *
 * `/admin` is where the gate sends everybody who typed the console's front address, so as a
 * destination it says "somewhere in the console", not "the list of events and nothing else", and
 * a moderator of one event who typed it is better served by their queue (decision 2).
 */
export const chosenPath = (state: unknown): string | null => {
  const from = fromOf(state)
  return from === null || from === ADMIN_HOME ? null : from
}

/**
 * `from` for a link that leaves the page the person is on and expects to bring them back: the
 * path and the query, in the one format `fromOf` reads.
 */
export const hereAsFrom = (location: {
  readonly pathname: string
  readonly search: string
}): string => `${location.pathname}${location.search}`

/**
 * Whether the screen in front of the person is a phone's: narrow, or driven by a finger.
 *
 * Read once, when a landing is decided, and never subscribed to: the question is "which of the
 * two queues do I open", asked at a moment, and not a layout that follows a rotation. A browser
 * without `matchMedia` (a test harness) is a laptop.
 */
export const onPhone = (): boolean => {
  try {
    return window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
  } catch {
    return false
  }
}

/** The moderation queue of one event: the phone's screen on a phone, the console's elsewhere. */
export const moderationQueuePath = (slug: string, phone: boolean): string =>
  `/admin/events/${encodeURIComponent(slug)}/moderation${phone ? '/mobile' : ''}`

/** What the server said about the account, as far as the landing rules need it. */
export interface LandingFacts {
  /** The events the account owns or moderates (`GET /api/events`). */
  readonly eventSlugs: readonly string[]
  /**
   * The account's role in the event, **read only when there is exactly one** (`GET
   * /api/events/:slug`): with none or several the rules below never ask it.
   */
  readonly soleEventRole: 'owner' | 'moderator' | null
  /** How many clients the account belongs to (`GET /api/me/limits`), read only when it has no event. */
  readonly clientCount: number
  /** The account operates the box **and** the box has a console to open. */
  readonly operatesConsole: boolean
  readonly phone: boolean
}

/**
 * The first screen of somebody who has chosen none (decisions 2 and 3):
 *
 * - **A moderator of exactly one event** opens that event's moderation queue, and on a phone the
 *   phone's queue. They were invited to do that and nothing else; the event page is dense and is
 *   one link away.
 * - **An operator with no event and no client** opens the console. Their list of events would be
 *   empty and their client space does not exist.
 * - **Everybody else** opens the list of events, which is also where a client's owner or member
 *   starts: the list links to their client space.
 */
export const landingPath = (facts: LandingFacts): string => {
  const [only, ...others] = facts.eventSlugs
  if (only !== undefined && others.length === 0 && facts.soleEventRole === 'moderator') {
    return moderationQueuePath(only, facts.phone)
  }
  if (only === undefined && facts.clientCount === 0 && facts.operatesConsole) return SITE_HOME
  return ADMIN_HOME
}

/** The slice of `InvitationAcceptedDto` the rule reads. */
export interface AcceptedInvitation {
  readonly kind: 'event' | 'client'
  readonly role: 'moderator' | 'owner' | 'member'
  readonly eventSlug: string | null
}

/**
 * Where somebody who has just accepted an invitation starts, which is known from the answer alone:
 *
 * - **To moderate an event**: that event's queue (phone's queue on a phone).
 * - **To a client** (owner or member): the list of events, which links to the client space and
 *   offers "Nouvel évènement". The invitation carries no event, and the client space is a page
 *   about limits, not about work.
 * - Any other event role: the event's page, as before.
 */
export const afterInvitationPath = (accepted: AcceptedInvitation, phone: boolean): string => {
  if (accepted.kind === 'client' || accepted.eventSlug === null) return ADMIN_HOME
  if (accepted.role === 'moderator') return moderationQueuePath(accepted.eventSlug, phone)
  return `/admin/events/${encodeURIComponent(accepted.eventSlug)}`
}
