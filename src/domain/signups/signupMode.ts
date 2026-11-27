/**
 * What a box does with the public signup form (spec 31, ADR 0018).
 *
 * - `off`: no form, no route; every box that does not set `SIGNUP` (a self-hoster's default).
 * - `review`: a confirmed request waits for an operator, who approves or refuses it.
 * - `open`: confirming the address opens the account, unless the disk guard holds the request
 *   back for the operator, in which case it waits exactly as in `review`.
 *
 * The two modes that take requests need the site role and a mailer that delivers: with no relay
 * there is no proof of address, and a signup without proof is the abuse inbox ROADMAP §10 warns of.
 */
export const SIGNUP_MODES = ['off', 'review', 'open'] as const

export type SignupMode = (typeof SIGNUP_MODES)[number]

export const DEFAULT_SIGNUP_MODE: SignupMode = 'off'

export const isSignupMode = (value: unknown): value is SignupMode =>
  typeof value === 'string' && (SIGNUP_MODES as readonly string[]).includes(value)

/** Whether the form exists at all. */
export const signupEnabled = (mode: SignupMode): boolean => mode !== 'off'

/** Whether a confirmed address may open its account without an operator (still subject to the disk guard). */
export const signupOpensAccounts = (mode: SignupMode): boolean => mode === 'open'

/** What a box has around the mode, as the boot check reads it. */
export interface SignupPrerequisites {
  readonly siteAdmin: boolean
  readonly mailDelivers: boolean
}

export type MissingSignupPrerequisite = 'siteAdmin' | 'mail'

/**
 * The prerequisites a mode is missing, in a fixed order, or an empty list when it may start.
 * `off` needs nothing. The names are what the boot message says.
 */
export const missingSignupPrerequisites = (
  mode: SignupMode,
  have: SignupPrerequisites,
): readonly MissingSignupPrerequisite[] => {
  if (!signupEnabled(mode)) return []
  const missing: MissingSignupPrerequisite[] = []
  if (!have.siteAdmin) missing.push('siteAdmin')
  if (!have.mailDelivers) missing.push('mail')
  return missing
}
