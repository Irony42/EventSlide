/**
 * How long a second-factor moment stays true (roadmap §10.1 / G2-13, paid plan P3-15).
 *
 * Three stamps live in a session, and each one is only worth something while it is recent.
 * The rule for "recent" is the same for all of them and is written once, here, so the
 * middleware and the sign-in route cannot grow two meanings of it.
 */

/**
 * How long a sign-in that has passed the password but not yet the second factor stays open.
 * Five minutes is long enough to find a phone and short enough that an abandoned half-login
 * is not a standing invitation to guess codes.
 */
export const PENDING_SECOND_FACTOR_LIFETIME_MS = 5 * 60 * 1000

/**
 * How long a step-up confirmation (password and a fresh code) keeps a sensitive action
 * available. The plan's number: offboarding a client is not something to leave unlocked for
 * a lunch break, and five minutes is enough to do the thing one has just confirmed.
 */
export const STEP_UP_LIFETIME_MS = 5 * 60 * 1000

/**
 * Wrong codes one half-finished sign-in may try before it is thrown away and the password
 * has to be typed again. Together with the per-address and per-account limiters this is what
 * makes six digits an acceptable secret: a guess costs a password verification every fifth
 * try.
 */
export const MAX_SECOND_FACTOR_ATTEMPTS = 5

/**
 * Whether a stamp written into a session at `stampedAt` still counts at `nowMs`.
 *
 * A stamp is fresh only if it is a finite number, **not in the future**, and no older than
 * `lifetimeMs`. The future case matters for the reason `enforceSessionAge` gives: the server
 * wrote the value, so a stamp later than now is a box whose clock stepped back, and treating
 * it as fresh would stretch the window by the size of the step.
 */
export const isStampFresh = (stampedAt: unknown, nowMs: number, lifetimeMs: number): boolean =>
  typeof stampedAt === 'number' &&
  Number.isFinite(stampedAt) &&
  stampedAt <= nowMs &&
  nowMs - stampedAt <= lifetimeMs
